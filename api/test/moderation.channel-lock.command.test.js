const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function createSnapshotRepoMock() {
  const state = new Map();
  return {
    state,
    async getSnapshot(guildId, channelId) {
      return state.get(`${guildId}:${channelId}`) || null;
    },
    async upsertSnapshot({ guildId, channelId, everyoneRoleId, snapshot }) {
      state.set(`${guildId}:${channelId}`, {
        guildId: String(guildId),
        channelId: String(channelId),
        everyoneRoleId: String(everyoneRoleId),
        snapshot,
      });
    },
    async deleteSnapshot(guildId, channelId) {
      state.delete(`${guildId}:${channelId}`);
    },
  };
}

function loadCommands(snapshotRepoMock) {
  const repoPath = require.resolve('../src/infrastructure/repositories/channelLockSnapshotRepository');
  const helperPath = require.resolve('../src/bot/commands/channelLock.helpers');
  const lockPath = require.resolve('../src/bot/commands/lock');
  const unlockPath = require.resolve('../src/bot/commands/unlock');

  const originalRepoModule = require.cache[repoPath];
  delete require.cache[helperPath];
  delete require.cache[lockPath];
  delete require.cache[unlockPath];

  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: snapshotRepoMock,
  };

  const lockCommand = require(lockPath);
  const unlockCommand = require(unlockPath);
  const helper = require(helperPath);

  return {
    lockCommand,
    unlockCommand,
    helper,
    restore() {
      delete require.cache[helperPath];
      delete require.cache[lockPath];
      delete require.cache[unlockPath];
      if (originalRepoModule) require.cache[repoPath] = originalRepoModule;
      else delete require.cache[repoPath];
    },
  };
}

function createPermissionChecker({
  allowManageChannels = true,
  allowAdmin = false,
} = {}) {
  return {
    has: (perm) => {
      if (perm === PermissionFlagsBits.ManageChannels || perm === 'ManageChannels') return allowManageChannels;
      if (perm === PermissionFlagsBits.Administrator || perm === 'Administrator') return allowAdmin;
      return false;
    },
  };
}

function createRole(
  id,
  {
    allowManageChannels = false,
    allowAdmin = false,
  } = {}
) {
  return {
    id: String(id),
    permissions: createPermissionChecker({
      allowManageChannels,
      allowAdmin,
    }),
  };
}

function createOverwriteEntry({ targetId, type = 'role', allow = [], deny = [] } = {}) {
  const allowSet = new Set(Array.isArray(allow) ? allow.map(String) : []);
  const denySet = new Set(Array.isArray(deny) ? deny.map(String) : []);

  const hasInSet = (set, perm) => {
    if (perm === PermissionFlagsBits.SendMessages) return set.has('SendMessages');
    return set.has(String(perm));
  };

  return {
    id: String(targetId),
    type,
    allow: {
      has: (perm) => hasInSet(allowSet, perm),
    },
    deny: {
      has: (perm) => hasInSet(denySet, perm),
    },
    _allowSet: allowSet,
    _denySet: denySet,
  };
}

function createPermissionOverwrites(initialEntries = []) {
  const entries = new Map();
  for (const entry of initialEntries) {
    entries.set(String(entry.targetId), createOverwriteEntry(entry));
  }

  const calls = [];

  const ensureEntry = (target, targetId) => {
    let entry = entries.get(targetId);
    if (!entry) {
      entry = createOverwriteEntry({
        targetId,
        type: target?.permissions ? 'role' : 'member',
      });
      entries.set(targetId, entry);
    }
    return entry;
  };

  return {
    cache: {
      get: (targetId) => entries.get(String(targetId)) || null,
      values: () => entries.values(),
    },
    calls,
    stateById: entries,
    seed(entry) {
      entries.set(String(entry.targetId), createOverwriteEntry(entry));
    },
    async edit(target, patch, options = {}) {
      const targetId = String(target?.id || target);
      const entry = ensureEntry(target, targetId);

      for (const [permName, value] of Object.entries(patch || {})) {
        const normalizedPermName = String(permName);
        if (value === false) {
          entry._allowSet.delete(normalizedPermName);
          entry._denySet.add(normalizedPermName);
        } else if (value === true) {
          entry._denySet.delete(normalizedPermName);
          entry._allowSet.add(normalizedPermName);
        } else if (value === null) {
          entry._allowSet.delete(normalizedPermName);
          entry._denySet.delete(normalizedPermName);
        }
      }

      calls.push({
        targetId,
        patch,
        options,
      });

      return { targetId, patch, options };
    },
  };
}

function createChannel({
  id,
  name,
  type,
  overwriteInitial = [],
} = {}) {
  const permissionOverwrites = createPermissionOverwrites(overwriteInitial);
  return {
    id: String(id),
    name: name || String(id),
    type,
    permissionOverwrites,
    toString: () => `<#${id}>`,
    fetch: async function fetch() {
      return this;
    },
  };
}

function readSendMessagesState(channel, targetId) {
  const entry = channel.permissionOverwrites.stateById.get(String(targetId));
  if (!entry) return 'inherit';
  if (entry._allowSet.has('SendMessages')) return 'allow';
  if (entry._denySet.has('SendMessages')) return 'deny';
  return 'inherit';
}

function createContext({
  messageChannel,
  voiceChannel = null,
  roles = [],
} = {}) {
  const replies = [];
  const typingCalls = [];
  const everyoneRole = { id: 'guild-1', name: '@everyone' };

  const channelMap = new Map([[messageChannel.id, messageChannel]]);
  if (voiceChannel) channelMap.set(voiceChannel.id, voiceChannel);

  const rolesMap = new Map([[everyoneRole.id, everyoneRole]]);
  for (const role of roles) {
    rolesMap.set(String(role.id), role);
  }

  const message = {
    author: {
      id: 'mod-1',
      username: 'mod-user',
      bot: false,
    },
    member: {
      id: 'mod-1',
      permissions: createPermissionChecker({ allowManageChannels: true, allowAdmin: false }),
      voice: {
        channel: voiceChannel,
      },
    },
    guild: {
      id: 'guild-1',
      roles: {
        everyone: everyoneRole,
        cache: {
          get: (id) => rolesMap.get(String(id)) || null,
        },
        fetch: async (id) => rolesMap.get(String(id)) || null,
      },
      members: {
        me: {
          id: 'bot-1',
          permissions: createPermissionChecker({ allowManageChannels: true, allowAdmin: false }),
        },
      },
      channels: {
        cache: {
          get: (id) => channelMap.get(String(id)) || null,
        },
        fetch: async (id) => channelMap.get(String(id)) || null,
      },
    },
    channel: messageChannel,
    reply: async (payload) => {
      replies.push(payload);
      return {
        payload,
        edit: async (nextPayload) => {
          replies.push(nextPayload);
          return nextPayload;
        },
      };
    },
  };
  message.channel.sendTyping = async () => {
    typingCalls.push({ channelId: messageChannel.id });
  };

  return {
    ctx: {
      message,
      cleanArgs: [],
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => ({
          commit: async () => {},
          rollback: async () => {},
        }),
      }),
    },
    replies,
    typingCalls,
    everyoneRoleId: everyoneRole.id,
  };
}

test('.lock text -> komut kanali kilitlenir, voice etkilenmez', async () => {
  const repo = createSnapshotRepoMock();
  const loaded = loadCommands(repo);
  loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

  try {
    const textChannel = createChannel({
      id: 'text-1',
      name: 'genel',
      type: ChannelType.GuildText,
    });
    const voiceChannel = createChannel({
      id: 'voice-1',
      name: 'lobby',
      type: ChannelType.GuildVoice,
    });
    const { ctx, everyoneRoleId } = createContext({
      messageChannel: textChannel,
      voiceChannel,
    });

    await loaded.lockCommand.run(ctx);

    assert.equal(textChannel.permissionOverwrites.calls.length, 1);
    assert.deepEqual(textChannel.permissionOverwrites.calls[0].patch, { SendMessages: false });
    assert.equal(textChannel.permissionOverwrites.calls[0].targetId, everyoneRoleId);
    assert.equal(voiceChannel.permissionOverwrites.calls.length, 0);
    assert.equal(repo.state.size, 1, 'snapshot should be persisted');
  } finally {
    loaded.restore();
  }
});

test('.lock text -> role allow overwrite (muaf degil) lock sirasinda null edilir', async () => {
  const repo = createSnapshotRepoMock();
  const loaded = loadCommands(repo);
  loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

  try {
    const staffRole = createRole('role-staff', { allowManageChannels: true });
    const memberRole = createRole('role-member');
    const textChannel = createChannel({
      id: 'text-2',
      name: 'duyuru',
      type: ChannelType.GuildText,
      overwriteInitial: [
        { targetId: 'role-member', type: 'role', allow: ['SendMessages'] },
        { targetId: 'role-staff', type: 'role', allow: ['SendMessages'] },
      ],
    });
    const { ctx, everyoneRoleId } = createContext({
      messageChannel: textChannel,
      roles: [staffRole, memberRole],
    });

    await loaded.lockCommand.run(ctx);

    const memberRoleNeutralize = textChannel.permissionOverwrites.calls.find(
      (call) => call.targetId === 'role-member' && call.patch.SendMessages === null
    );
    const staffRoleNeutralize = textChannel.permissionOverwrites.calls.find(
      (call) => call.targetId === 'role-staff' && call.patch.SendMessages === null
    );

    assert.deepEqual(textChannel.permissionOverwrites.calls[0].patch, { SendMessages: false });
    assert.equal(textChannel.permissionOverwrites.calls[0].targetId, everyoneRoleId);
    assert.ok(memberRoleNeutralize, 'non-staff allow overwrite should be neutralized');
    assert.equal(staffRoleNeutralize, undefined, 'staff allow overwrite should stay untouched');
  } finally {
    loaded.restore();
  }
});

test('.lock text -> member-specific SendMessages allow overwrite da neutralize edilir', async () => {
  const repo = createSnapshotRepoMock();
  const loaded = loadCommands(repo);
  loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

  try {
    const textChannel = createChannel({
      id: 'text-member-allow',
      name: 'chat',
      type: ChannelType.GuildText,
      overwriteInitial: [
        { targetId: 'user-allow', type: 'member', allow: ['SendMessages'] },
      ],
    });
    const { ctx, everyoneRoleId } = createContext({
      messageChannel: textChannel,
    });

    await loaded.lockCommand.run(ctx);

    assert.equal(readSendMessagesState(textChannel, everyoneRoleId), 'deny');
    assert.equal(readSendMessagesState(textChannel, 'user-allow'), 'inherit');
    assert.equal(repo.state.size, 1, 'snapshot should persist member overwrite state');
  } finally {
    loaded.restore();
  }
});

test('.unlock text -> snapshottan SendMessages izinleri birebir geri yuklenir', async () => {
  const repo = createSnapshotRepoMock();
  const loaded = loadCommands(repo);
  loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

  try {
    const textChannel = createChannel({
      id: 'text-3',
      name: 'mod-chat',
      type: ChannelType.GuildText,
      overwriteInitial: [
        { targetId: 'role-member', type: 'role', allow: ['SendMessages'] },
        { targetId: 'role-muted', type: 'role', deny: ['SendMessages'] },
        { targetId: 'user-1', type: 'member', allow: ['SendMessages'] },
      ],
    });
    const { ctx, everyoneRoleId } = createContext({
      messageChannel: textChannel,
      roles: [createRole('role-member'), createRole('role-muted')],
    });

    await loaded.lockCommand.run(ctx);
    textChannel.permissionOverwrites.seed({
      targetId: 'role-extra',
      type: 'role',
      allow: ['SendMessages'],
    });

    const callCountBeforeUnlock = textChannel.permissionOverwrites.calls.length;
    await loaded.unlockCommand.run(ctx);

    const unlockCalls = textChannel.permissionOverwrites.calls.slice(callCountBeforeUnlock);
    const roleExtraTouched = unlockCalls.some((call) => call.targetId === 'role-extra');
    assert.equal(roleExtraTouched, false, 'snapshotta olmayan overwrite geri yuklemede degismemeli');

    assert.equal(readSendMessagesState(textChannel, everyoneRoleId), 'inherit');
    assert.equal(readSendMessagesState(textChannel, 'role-member'), 'allow');
    assert.equal(readSendMessagesState(textChannel, 'role-muted'), 'deny');
    assert.equal(readSendMessagesState(textChannel, 'user-1'), 'allow');
    assert.equal(repo.state.size, 0, 'snapshot should be cleared after unlock');
  } finally {
    loaded.restore();
  }
});

test('.unlock text -> restart sonrasi persisted snapshot ile restore eder', async () => {
  const repo = createSnapshotRepoMock();
  let loaded = loadCommands(repo);
  loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

  const textChannel = createChannel({
    id: 'text-4',
    name: 'kurallar',
    type: ChannelType.GuildText,
    overwriteInitial: [
      { targetId: 'role-member', type: 'role', allow: ['SendMessages'] },
      { targetId: 'user-1', type: 'member', deny: ['SendMessages'] },
    ],
  });
  const { ctx, everyoneRoleId } = createContext({
    messageChannel: textChannel,
    roles: [createRole('role-member')],
  });

  try {
    await loaded.lockCommand.run(ctx);
    loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();
    loaded.restore();

    loaded = loadCommands(repo);
    loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

    await loaded.unlockCommand.run(ctx);

    assert.equal(readSendMessagesState(textChannel, everyoneRoleId), 'inherit');
    assert.equal(readSendMessagesState(textChannel, 'role-member'), 'allow');
    assert.equal(readSendMessagesState(textChannel, 'user-1'), 'deny');
    assert.equal(repo.state.size, 0);
  } finally {
    loaded.restore();
  }
});

test('.unlock text -> snapshot yoksa fallback sadece @everyone deny temizler', async () => {
  const repo = createSnapshotRepoMock();
  const loaded = loadCommands(repo);
  loaded.helper.CHANNEL_LOCK_SNAPSHOTS.clear();

  try {
    const everyoneRoleId = 'guild-1';
    const textChannel = createChannel({
      id: 'text-5',
      name: 'genel',
      type: ChannelType.GuildText,
      overwriteInitial: [
        { targetId: everyoneRoleId, type: 'role', deny: ['SendMessages'] },
        { targetId: 'role-member', type: 'role', allow: ['SendMessages'] },
      ],
    });
    const { ctx } = createContext({
      messageChannel: textChannel,
    });

    await loaded.unlockCommand.run(ctx);

    assert.equal(textChannel.permissionOverwrites.calls.length, 1);
    assert.equal(textChannel.permissionOverwrites.calls[0].targetId, everyoneRoleId);
    assert.deepEqual(textChannel.permissionOverwrites.calls[0].patch, { SendMessages: null });
  } finally {
    loaded.restore();
  }
});
