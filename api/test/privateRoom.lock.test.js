const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

const privateVoiceRepository = require('../src/infrastructure/repositories/privateVoiceRepository');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 500, intervalMs = 5 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) return true;
    await wait(intervalMs);
  }
  return false;
}

function cloneRoom(room) {
  return {
    ...room,
    lockSnapshot: room?.lockSnapshot ? JSON.parse(JSON.stringify(room.lockSnapshot)) : null,
    visibilitySnapshot: room?.visibilitySnapshot ? JSON.parse(JSON.stringify(room.visibilitySnapshot)) : null,
    whitelistMemberIds: Array.isArray(room.whitelistMemberIds) ? [...room.whitelistMemberIds] : [],
    permitRoleIds: Array.isArray(room.permitRoleIds) ? [...room.permitRoleIds] : [],
    rejectMemberIds: Array.isArray(room.rejectMemberIds) ? [...room.rejectMemberIds] : [],
    rejectRoleIds: Array.isArray(room.rejectRoleIds) ? [...room.rejectRoleIds] : [],
  };
}

function createPrivateRepoMock({ guildId, config, initialRoom, updateDelayByCall = {} }) {
  const state = {
    room: cloneRoom(initialRoom),
    updateCallCount: 0,
    logs: [],
  };

  return {
    state,
    getGuildConfig: async (targetGuildId) => {
      if (targetGuildId !== guildId) {
        return { enabled: false, hubChannelId: null, requiredRoleId: null, categoryId: null };
      }
      return { ...config };
    },
    listAllRooms: async () => [cloneRoom(state.room)],
    getRoomByOwner: async (targetGuildId, ownerId) => {
      if (targetGuildId !== guildId) return null;
      if (String(ownerId) !== String(state.room.ownerId)) return null;
      return cloneRoom(state.room);
    },
    getRoomByChannel: async (targetGuildId, channelId) => {
      if (targetGuildId !== guildId) return null;
      if (String(channelId) !== String(state.room.voiceChannelId)) return null;
      return cloneRoom(state.room);
    },
    createRoom: async () => cloneRoom(state.room),
    updateRoom: async (_roomId, patch) => {
      state.updateCallCount += 1;
      const delay = Number(updateDelayByCall[state.updateCallCount] || 0);
      if (delay > 0) await wait(delay);

      if (Object.prototype.hasOwnProperty.call(patch, 'ownerId')) {
        state.room.ownerId = String(patch.ownerId || '').trim();
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'panelMessageId')) {
        state.room.panelMessageId = patch.panelMessageId || null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'lockSnapshot')) {
        state.room.lockSnapshot = patch.lockSnapshot
          ? JSON.parse(JSON.stringify(patch.lockSnapshot))
          : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'visibilitySnapshot')) {
        state.room.visibilitySnapshot = patch.visibilitySnapshot
          ? JSON.parse(JSON.stringify(patch.visibilitySnapshot))
          : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'whitelistMemberIds')) {
        const list = Array.isArray(patch.whitelistMemberIds) ? patch.whitelistMemberIds : [];
        state.room.whitelistMemberIds = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'permitMemberIds')) {
        const list = Array.isArray(patch.permitMemberIds) ? patch.permitMemberIds : [];
        state.room.whitelistMemberIds = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'permitRoleIds')) {
        const list = Array.isArray(patch.permitRoleIds) ? patch.permitRoleIds : [];
        state.room.permitRoleIds = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'rejectMemberIds')) {
        const list = Array.isArray(patch.rejectMemberIds) ? patch.rejectMemberIds : [];
        state.room.rejectMemberIds = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'rejectRoleIds')) {
        const list = Array.isArray(patch.rejectRoleIds) ? patch.rejectRoleIds : [];
        state.room.rejectRoleIds = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'lastActiveAt')) {
        state.room.lastActiveAt = Number(patch.lastActiveAt || Date.now());
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'locked')) {
        state.room.locked = Boolean(patch.locked);
      }

      return cloneRoom(state.room);
    },
    deleteRoomById: async () => { },
    insertRoomLog: async (entry) => {
      state.logs.push({ ...entry });
    },
  };
}

function patchPrivateRepo(mock) {
  const keys = [
    'getGuildConfig',
    'listAllRooms',
    'getRoomByOwner',
    'getRoomByChannel',
    'createRoom',
    'updateRoom',
    'deleteRoomById',
    'insertRoomLog',
  ];
  const original = {};

  for (const key of keys) {
    original[key] = privateVoiceRepository[key];
    privateVoiceRepository[key] = mock[key];
  }

  return () => {
    for (const key of keys) {
      privateVoiceRepository[key] = original[key];
    }
  };
}

function createPermissionOverwriteCache() {
  const stateById = new Map();

  function normalizeId(target) {
    return String(target?.id || target || '').trim();
  }

  function ensureEntry(id) {
    if (!stateById.has(id)) {
      stateById.set(id, {
        allow: new Set(),
        deny: new Set(),
      });
    }
    return stateById.get(id);
  }

  function toReadable(entry) {
    return {
      allow: {
        has: (perm) => entry.allow.has(String(perm)),
      },
      deny: {
        has: (perm) => entry.deny.has(String(perm)),
      },
    };
  }

  return {
    stateById,
    cache: {
      get: (target) => {
        const id = normalizeId(target);
        if (!id || !stateById.has(id)) return null;
        return toReadable(stateById.get(id));
      },
      has: (target) => stateById.has(normalizeId(target)),
      entries: () => [...stateById.entries()].map(([id, entry]) => [id, toReadable(entry)]),
      [Symbol.iterator]: function* iterate() {
        for (const [id, entry] of stateById.entries()) {
          yield [id, toReadable(entry)];
        }
      },
    },
    edit: async (target, permissions = {}) => {
      const id = normalizeId(target);
      if (!id) return null;

      const entry = ensureEntry(id);
      for (const [permName, nextValue] of Object.entries(permissions || {})) {
        const permission = String(permName);
        if (nextValue === true) {
          entry.allow.add(permission);
          entry.deny.delete(permission);
          continue;
        }
        if (nextValue === false) {
          entry.deny.add(permission);
          entry.allow.delete(permission);
          continue;
        }
        entry.allow.delete(permission);
        entry.deny.delete(permission);
      }

      if (entry.allow.size === 0 && entry.deny.size === 0) {
        stateById.delete(id);
        return null;
      }

      return toReadable(entry);
    },
  };
}

function createServiceFixture({
  room,
  updateDelayByCall = {},
  lockTimeoutMs = '500',
  allowManageChannels = true,
  roleIds = [],
  existingMessages = [],
}) {
  process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS = String(lockTimeoutMs);
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');

  const rolesMap = new Map([[String(room.guildId), { id: String(room.guildId), name: '@everyone' }]]);
  for (const roleId of roleIds) {
    rolesMap.set(String(roleId), { id: String(roleId), name: `role-${roleId}` });
  }

  const guild = {
    id: room.guildId,
    roles: {
      everyone: { id: String(room.guildId) },
      cache: {
        get: (id) => rolesMap.get(String(id)) || null,
        has: (id) => rolesMap.has(String(id)),
      },
      fetch: async (id) => rolesMap.get(String(id)) || null,
    },
    members: {
      me: {
        displayAvatarURL: () => 'https://example.com/avatar.png',
        permissions: {
          has: () => allowManageChannels,
        },
      },
      cache: {
        get: () => null,
      },
      fetch: async () => null,
    },
  };

  const messages = new Map();
  for (const seed of existingMessages) {
    const message = {
      id: String(seed.id),
      author: { id: 'bot-user' },
      embeds: seed.embeds || [],
      content: seed.content || '',
      edit: async (nextPayload) => {
        if (typeof seed.onEdit === 'function') return seed.onEdit(nextPayload);
        message.embeds = nextPayload?.embeds || [];
        message.content = nextPayload?.content || '';
        return message;
      },
      delete: async () => { },
    };
    messages.set(message.id, message);
  }
  const permissionOverwrites = createPermissionOverwriteCache();
  const roomChannel = {
    id: room.voiceChannelId,
    name: 'room-channel',
    type: ChannelType.GuildVoice,
    guild,
    members: new Map(),
    isTextBased: () => true,
    permissionOverwrites,
    overwriteStateById: permissionOverwrites.stateById,
    deleted: false,
    send: async (payload) => {
      const message = {
        id: `panel-${messages.size + 1}`,
        author: { id: 'bot-user' },
        embeds: payload?.embeds || [],
        content: payload?.content || '',
        edit: async (nextPayload) => {
          message.embeds = nextPayload?.embeds || [];
          message.content = nextPayload?.content || '';
          return message;
        },
        delete: async () => { },
      };
      messages.set(message.id, message);
      return message;
    },
    messages: {
      fetch: async (id) => messages.get(String(id)) || null,
    },
    delete: async () => {
      roomChannel.deleted = true;
      return roomChannel;
    },
  };

  guild.channels = {
    cache: {
      get: (id) => (String(id) === roomChannel.id ? roomChannel : null),
    },
    fetch: async (id) => (String(id) === roomChannel.id ? roomChannel : null),
  };

  const client = {
    user: { id: 'bot-user' },
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
  };

  const repoMock = createPrivateRepoMock({
    guildId: guild.id,
    config: {
      enabled: true,
      hubChannelId: 'hub-1',
      requiredRoleId: 'role-1',
      categoryId: null,
    },
    initialRoom: room,
    updateDelayByCall,
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const errors = [];
  const service = createPrivateRoomService({
    client,
    logSystem: () => { },
    logError: (code, err, meta) => {
      errors.push({ code, err, meta });
    },
  });

  function createInteraction({ userId, values = [], type = 'user-select', customId = null }) {
    const resolvedCustomId =
      customId ||
      (type === 'button' ? `pvr:lockon:${room.id}` : `pvru:sync:${room.id}`);
    const interaction = {
      guildId: guild.id,
      guild,
      channelId: roomChannel.id,
      channel: roomChannel,
      customId: resolvedCustomId,
      values,
      user: { id: String(userId) },
      replied: false,
      deferred: false,
      replies: [],
      message: {
        id: repoMock.state.room.panelMessageId || null,
        author: { id: client.user.id },
        embeds: [{ title: 'Oda Kontrol' }],
      },
      inGuild: () => true,
       isButton: () => type === 'button',
       isStringSelectMenu: () => false,
       isUserSelectMenu: () => type === 'user-select',
       isRoleSelectMenu: () => type === 'role-select',
       isModalSubmit: () => false,
      isRepliable: () => true,
      reply: async (payload) => {
        interaction.replied = true;
        interaction.replies.push(payload);
        return payload;
      },
      deferReply: async () => {
        interaction.deferred = true;
      },
      deferUpdate: async () => {
        interaction.deferred = true;
      },
      editReply: async (payload) => {
        interaction.replies.push(payload);
        return payload;
      },
      followUp: async (payload) => {
        interaction.replies.push(payload);
        return payload;
      },
    };

    return interaction;
  }

  function teardown(previousTimeoutEnv) {
    service.shutdown();
    restoreRepo();
    delete require.cache[require.resolve('../src/voice/privateRoomService')];
    if (previousTimeoutEnv === undefined) delete process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
    else process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS = previousTimeoutEnv;
  }

  return {
    service,
    repoMock,
    guild,
    roomChannel,
    messages,
    errors,
    createInteraction,
    teardown,
  };
}

function getConnectState(channel, targetId) {
  const entry = channel.overwriteStateById.get(String(targetId)) || null;
  if (!entry) return 'inherit';
  if (entry.allow.has('Connect')) return 'allow';
  if (entry.deny.has('Connect')) return 'deny';
  return 'inherit';
}

function getViewState(channel, targetId) {
  const entry = channel.overwriteStateById.get(String(targetId)) || null;
  if (!entry) return 'inherit';
  if (entry.allow.has('ViewChannel')) return 'allow';
  if (entry.deny.has('ViewChannel')) return 'deny';
  return 'inherit';
}

test('private room whitelist lock serializes parallel updates without state corruption', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 1,
      guildId: 'guild-lock-1',
      ownerId: '9001',
      voiceChannelId: 'voice-room-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    updateDelayByCall: {
      1: 80,
    },
    lockTimeoutMs: '500',
  });

  try {
    await fixture.service.bootstrap();
    const first = fixture.createInteraction({ userId: '9001', values: ['5001'] });
    const second = fixture.createInteraction({ userId: '9001', values: ['5001', '5002'] });

    const p1 = fixture.service.handleInteraction(first);
    await waitFor(() => fixture.repoMock.state.updateCallCount >= 1, { timeoutMs: 300 });
    const p2 = fixture.service.handleInteraction(second);

    await Promise.all([p1, p2]);

    assert.deepEqual(fixture.repoMock.state.room.whitelistMemberIds, ['5001', '5002']);
    assert.equal(
      first.replies.some((payload) => String(payload?.content || '').includes('İzin Verilenler güncellendi')),
      true
    );
    assert.equal(
      second.replies.some((payload) => String(payload?.content || '').includes('İzin Verilenler güncellendi')),
      true
    );
    assert.equal(
      fixture.errors.some((entry) => entry.code === 'private_room_whitelist_lock_timeout'),
      false
    );
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room whitelist lock keeps state coherent under a tight timeout budget', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 2,
      guildId: 'guild-lock-2',
      ownerId: '9002',
      voiceChannelId: 'voice-room-2',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    updateDelayByCall: {
      1: 300,
    },
    lockTimeoutMs: '20',
  });

  try {
    await fixture.service.bootstrap();
    const first = fixture.createInteraction({ userId: '9002', values: ['6001'] });
    const second = fixture.createInteraction({ userId: '9002', values: ['6002'] });

    const p1 = fixture.service.handleInteraction(first);
    await waitFor(() => fixture.repoMock.state.updateCallCount >= 1, { timeoutMs: 300 });
    const p2 = fixture.service.handleInteraction(second);

    await Promise.all([p1, p2]);

    assert.equal(
      fixture.repoMock.state.room.whitelistMemberIds.length,
      1
    );
    assert.equal(
      ['6001', '6002'].includes(fixture.repoMock.state.room.whitelistMemberIds[0]),
      true
    );
    const timedOut = fixture.errors.some((entry) => entry.code === 'private_room_whitelist_lock_timeout');
    if (timedOut) {
      assert.equal(
        second.replies.some((payload) => String(payload?.content || '').includes('İşlem sırasında bir hata oluştu')),
        true
      );
    }
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room serializes lock toggle and whitelist sync without snapshot drift', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 38,
      guildId: 'guild-lock-sync-1',
      ownerId: '9038',
      voiceChannelId: 'voice-room-sync-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    updateDelayByCall: {
      1: 80,
    },
    lockTimeoutMs: '500',
  });

  try {
    await fixture.service.bootstrap();

    const lockInteraction = fixture.createInteraction({
      userId: '9038',
      type: 'button',
      customId: 'pvr:lockon:38',
    });
    const syncInteraction = fixture.createInteraction({
      userId: '9038',
      type: 'user-select',
      customId: 'pvru:sync:38',
      values: ['7381'],
    });

    const lockPromise = fixture.service.handleInteraction(lockInteraction);
    await waitFor(() => fixture.repoMock.state.updateCallCount >= 1, { timeoutMs: 300 });
    const syncPromise = fixture.service.handleInteraction(syncInteraction);

    await Promise.all([lockPromise, syncPromise]);

    assert.equal(fixture.repoMock.state.room.locked, true);
    assert.deepEqual(fixture.repoMock.state.room.whitelistMemberIds, ['7381']);
    assert.equal(getConnectState(fixture.roomChannel, fixture.guild.id), 'deny');
    assert.equal(getConnectState(fixture.roomChannel, '9038'), 'allow');
    assert.equal(
      fixture.errors.some((entry) => entry.code === 'private_room_whitelist_lock_timeout'),
      false
    );
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room rejects stale panel interactions before mutating room state', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 40,
      guildId: 'guild-panel-stale-1',
      ownerId: '9040',
      voiceChannelId: 'voice-room-panel-stale-1',
      panelMessageId: 'panel-current',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();

    const interaction = fixture.createInteraction({
      userId: '9040',
      type: 'button',
      customId: 'pvr:lockon:40',
    });
    interaction.message.id = 'panel-stale';

    await fixture.service.handleInteraction(interaction);

    assert.equal(fixture.repoMock.state.room.locked, false);
    assert.equal(interaction.replies.length > 0, true);
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room defers lock button interaction before persisting state', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 41,
      guildId: 'guild-lock-ack-1',
      ownerId: '9041',
      voiceChannelId: 'voice-room-lock-ack-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    updateDelayByCall: {
      1: 50,
    },
  });

  let deferredBeforePersist = false;
  const originalUpdateRoom = privateVoiceRepository.updateRoom;

  try {
    await fixture.service.bootstrap();

    const interaction = fixture.createInteraction({
      userId: '9041',
      type: 'button',
      customId: 'pvr:lockon:41',
    });

    privateVoiceRepository.updateRoom = async (...args) => {
      deferredBeforePersist = interaction.deferred === true;
      return originalUpdateRoom(...args);
    };

    await fixture.service.handleInteraction(interaction);

    assert.equal(deferredBeforePersist, true);
    assert.equal(fixture.repoMock.state.room.locked, true);
  } finally {
    privateVoiceRepository.updateRoom = originalUpdateRoom;
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room lock applies connect overwrites and unlock restores previous states', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 3,
      guildId: 'guild-lock-3',
      ownerId: '9003',
      voiceChannelId: 'voice-room-3',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: ['7001'],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.roomChannel.permissionOverwrites.edit('guild-lock-3', { Connect: true });
    await fixture.roomChannel.permissionOverwrites.edit('7001', { Connect: false });
    await fixture.service.bootstrap();

    const lockInteraction = fixture.createInteraction({
      userId: '9003',
      type: 'button',
      customId: 'pvr:lockon:3',
    });
    await fixture.service.handleInteraction(lockInteraction);

    assert.equal(fixture.repoMock.state.room.locked, true);
    assert.equal(getConnectState(fixture.roomChannel, 'guild-lock-3'), 'deny');
    assert.equal(getConnectState(fixture.roomChannel, '9003'), 'allow');
    assert.equal(getConnectState(fixture.roomChannel, '7001'), 'allow');

    const unlockInteraction = fixture.createInteraction({
      userId: '9003',
      type: 'button',
      customId: 'pvr:lockoff:3',
    });
    await fixture.service.handleInteraction(unlockInteraction);

    assert.equal(fixture.repoMock.state.room.locked, false);
    assert.equal(getConnectState(fixture.roomChannel, 'guild-lock-3'), 'allow');
    assert.equal(getConnectState(fixture.roomChannel, '9003'), 'inherit');
    assert.equal(getConnectState(fixture.roomChannel, '7001'), 'deny');
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room lock neutralizes role-level connect bypass and bootstrap reapplies it after restart', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const roleId = '733500000000000001';
  const fixture = createServiceFixture({
    room: {
      id: 35,
      guildId: 'guild-lock-role-1',
      ownerId: '9035',
      voiceChannelId: 'voice-room-role-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    roleIds: [roleId],
  });

  try {
    await fixture.roomChannel.permissionOverwrites.edit(roleId, { Connect: true });
    await fixture.service.bootstrap();

    const lockInteraction = fixture.createInteraction({
      userId: '9035',
      type: 'button',
      customId: 'pvr:lockon:35',
    });
    await fixture.service.handleInteraction(lockInteraction);

    assert.equal(fixture.repoMock.state.room.locked, true);
    assert.equal(getConnectState(fixture.roomChannel, roleId), 'deny');
    assert.equal(fixture.repoMock.state.room.lockSnapshot.managedDenyRoleIds.includes(roleId), true);

    fixture.service.shutdown();
    delete require.cache[require.resolve('../src/voice/privateRoomService')];

    const restarted = createServiceFixture({
      room: fixture.repoMock.state.room,
      roleIds: [roleId],
    });

    try {
      await restarted.roomChannel.permissionOverwrites.edit(roleId, { Connect: true });
      await restarted.service.bootstrap();

      assert.equal(getConnectState(restarted.roomChannel, roleId), 'deny');

      const unlockInteraction = restarted.createInteraction({
        userId: '9035',
        type: 'button',
        customId: 'pvr:lockoff:35',
      });
      await restarted.service.handleInteraction(unlockInteraction);

      assert.equal(restarted.repoMock.state.room.locked, false);
      assert.equal(getConnectState(restarted.roomChannel, roleId), 'allow');
    } finally {
      restarted.teardown(previousTimeoutEnv);
    }
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room lock failure does not persist locked state or snapshot', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 31,
      guildId: 'guild-lock-fail-1',
      ownerId: '9031',
      voiceChannelId: 'voice-room-fail-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: ['7311'],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();
    const originalEdit = fixture.roomChannel.permissionOverwrites.edit;
    fixture.roomChannel.permissionOverwrites.edit = async (target, permissions = {}) => {
      if (String(target?.id || target) === fixture.guild.id && permissions.Connect === false) {
        throw new Error('edit_failed');
      }
      return originalEdit(target, permissions);
    };

    const lockInteraction = fixture.createInteraction({
      userId: '9031',
      type: 'button',
      customId: 'pvr:lockon:31',
    });
    await fixture.service.handleInteraction(lockInteraction);

    assert.equal(fixture.repoMock.state.room.locked, false);
    assert.equal(fixture.repoMock.state.room.lockSnapshot, null);
    assert.equal(getConnectState(fixture.roomChannel, fixture.guild.id), 'inherit');
    assert.equal(
      lockInteraction.replies.some((payload) => String(payload?.content || '').includes('İşlem sırasında bir hata oluştu')),
      true
    );
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room unlock requires a valid persisted snapshot', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 32,
      guildId: 'guild-lock-fail-2',
      ownerId: '9032',
      voiceChannelId: 'voice-room-fail-2',
      panelMessageId: 'panel-0',
      locked: true,
      lockSnapshot: null,
      whitelistMemberIds: ['7321'],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.roomChannel.permissionOverwrites.edit('guild-lock-fail-2', { Connect: false });
    await fixture.roomChannel.permissionOverwrites.edit('9032', { Connect: true });
    await fixture.service.bootstrap();

    const unlockInteraction = fixture.createInteraction({
      userId: '9032',
      type: 'button',
      customId: 'pvr:lockoff:32',
    });
    await fixture.service.handleInteraction(unlockInteraction);

    assert.equal(fixture.repoMock.state.room.locked, false);
    assert.equal(getConnectState(fixture.roomChannel, 'guild-lock-fail-2'), 'inherit');
    assert.equal(fixture.repoMock.state.room.lockSnapshot, null);
    assert.equal(
      unlockInteraction.replies.some((payload) => String(payload?.content || '').includes('Oda kilidi kaldırıldı')),
      true
    );
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room locked whitelist sync updates connect allow overwrites', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 4,
      guildId: 'guild-lock-4',
      ownerId: '9004',
      voiceChannelId: 'voice-room-4',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: ['7101'],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();

    const lockInteraction = fixture.createInteraction({
      userId: '9004',
      type: 'button',
      customId: 'pvr:lockon:4',
    });
    await fixture.service.handleInteraction(lockInteraction);

    assert.equal(getConnectState(fixture.roomChannel, '7101'), 'allow');

    const syncInteraction = fixture.createInteraction({
      userId: '9004',
      type: 'user-select',
      customId: 'pvru:sync:4',
      values: ['7102'],
    });
    await fixture.service.handleInteraction(syncInteraction);

    assert.deepEqual(fixture.repoMock.state.room.whitelistMemberIds, ['7102']);
    assert.equal(getConnectState(fixture.roomChannel, '7101'), 'deny');
    assert.equal(getConnectState(fixture.roomChannel, '7102'), 'allow');
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room lock logs error when bot lacks ManageChannels', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 5,
      guildId: 'guild-lock-5',
      ownerId: '9005',
      voiceChannelId: 'voice-room-5',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    allowManageChannels: false,
  });

  try {
    await fixture.service.bootstrap();

    const lockInteraction = fixture.createInteraction({
      userId: '9005',
      type: 'button',
      customId: 'pvr:lockon:5',
    });
    await fixture.service.handleInteraction(lockInteraction);

    assert.equal(fixture.repoMock.state.room.locked, false);
    assert.equal(getConnectState(fixture.roomChannel, 'guild-lock-5'), 'inherit');
    assert.equal(
      fixture.errors.some((entry) => entry.code === 'private_room_manage_channels_missing'),
      true
    );
    assert.equal(
      lockInteraction.replies.some((payload) => String(payload?.content || '').includes('izinlerini yönetemiyor')),
      true
    );
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room unlock after restart restores persisted pre-lock states', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 6,
      guildId: 'guild-lock-6',
      ownerId: '9006',
      voiceChannelId: 'voice-room-6',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: ['7201'],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.roomChannel.permissionOverwrites.edit('guild-lock-6', { Connect: true });
    await fixture.roomChannel.permissionOverwrites.edit('7201', { Connect: false });
    await fixture.service.bootstrap();

    const lockInteraction = fixture.createInteraction({
      userId: '9006',
      type: 'button',
      customId: 'pvr:lockon:6',
    });
    await fixture.service.handleInteraction(lockInteraction);

    fixture.service.shutdown();
    delete require.cache[require.resolve('../src/voice/privateRoomService')];

    const restarted = createServiceFixture({
      room: fixture.repoMock.state.room,
    });

    try {
      await restarted.service.bootstrap();

      const unlockInteraction = restarted.createInteraction({
        userId: '9006',
        type: 'button',
        customId: 'pvr:lockoff:6',
      });
      await restarted.service.handleInteraction(unlockInteraction);

      assert.equal(restarted.repoMock.state.room.locked, false);
      assert.equal(restarted.repoMock.state.room.lockSnapshot, null);
      assert.equal(getConnectState(restarted.roomChannel, 'guild-lock-6'), 'allow');
      assert.equal(getConnectState(restarted.roomChannel, '9006'), 'inherit');
      assert.equal(getConnectState(restarted.roomChannel, '7201'), 'deny');
    } finally {
      restarted.teardown(previousTimeoutEnv);
    }
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room whitelist sync preserves hidden members beyond first 25', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const whitelist = Array.from({ length: 27 }, (_, index) => String(8000 + index));
  const fixture = createServiceFixture({
    room: {
      id: 7,
      guildId: 'guild-lock-7',
      ownerId: '9007',
      voiceChannelId: 'voice-room-7',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: whitelist,
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();

    const syncInteraction = fixture.createInteraction({
      userId: '9007',
      type: 'user-select',
      customId: 'pvru:sync:7',
      values: [...whitelist.slice(0, 24), '9999'],
    });
    await fixture.service.handleInteraction(syncInteraction);

    assert.deepEqual(
      fixture.repoMock.state.room.whitelistMemberIds,
      [...whitelist.slice(0, 24), '9999', ...whitelist.slice(25)]
    );
    assert.equal(
      syncInteraction.replies.some((payload) => String(payload?.content || '').includes('üye korundu')),
      true
    );
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room remove button opens reject management mode', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 33,
      guildId: 'guild-lock-remove-1',
      ownerId: '9033',
      voiceChannelId: 'voice-room-remove-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: ['7331'],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();

    const removeInteraction = fixture.createInteraction({
      userId: '9033',
      type: 'button',
      customId: 'pvr:remove:33',
    });
    await fixture.service.handleInteraction(removeInteraction);
    const removeReply = removeInteraction.replies[0];

    assert.equal(
      removeInteraction.replies.some((payload) => String(payload?.content || '').includes('Engellenenler')),
      true
    );
    assert.equal(String(removeReply?.content || '').includes('+ @'), false);
    assert.equal(String(removeReply?.content || '').includes('- @'), false);
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room text-based permit/reject flow is disabled', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const whitelist = Array.from({ length: 27 }, (_, index) => String(8400 + index));
  const fixture = createServiceFixture({
    room: {
      id: 34,
      guildId: 'guild-lock-remove-2',
      ownerId: '9034',
      voiceChannelId: 'voice-room-remove-2',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: whitelist,
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();
    const message = {
      guild: fixture.guild,
      author: { id: '9034', bot: false },
      channelId: fixture.roomChannel.id,
      channel: fixture.roomChannel,
      content: '+ <@8499> <@&9499>',
      mentions: {
        users: new Map([['8499', { id: '8499' }]]),
        roles: new Map([['9499', { id: '9499' }]]),
      },
      delete: async () => {},
    };

    const handled = await fixture.service.handleMessageCreate(message);
    assert.equal(handled, false);
    assert.deepEqual(fixture.repoMock.state.room.whitelistMemberIds, whitelist);
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room panel reflects actual visibility overwrite state', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 8,
      guildId: 'guild-lock-8',
      ownerId: '9008',
      voiceChannelId: 'voice-room-8',
      panelMessageId: null,
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();
    const panelMessageId = fixture.repoMock.state.room.panelMessageId;
    const getDescription = () => {
      const message = fixture.messages.get(panelMessageId);
      return message?.embeds?.[0]?.data?.description || message?.embeds?.[0]?.description || '';
    };
    const getViewState = () => {
      const entry = fixture.roomChannel.overwriteStateById.get(fixture.guild.id) || null;
      if (!entry) return 'inherit';
      if (entry.allow.has('ViewChannel')) return 'allow';
      if (entry.deny.has('ViewChannel')) return 'deny';
      return 'inherit';
    };

    assert.match(getDescription(), /Görünürlük Durumu: Görünür/);
    assert.equal(getViewState(), 'inherit');

    const hideInteraction = fixture.createInteraction({
      userId: '9008',
      type: 'button',
      customId: 'pvr:hide:8',
    });
    await fixture.service.handleInteraction(hideInteraction);
    assert.match(getDescription(), /Görünürlük Durumu: Gizli/);
    assert.equal(getViewState(), 'deny');
    assert.deepEqual(fixture.repoMock.state.room.visibilitySnapshot, {
      everyoneRoleId: fixture.guild.id,
      everyoneViewStateBeforeHide: 'inherit',
      roleViewStatesBeforeHide: {},
      managedDenyRoleIds: [],
    });

    const showInteraction = fixture.createInteraction({
      userId: '9008',
      type: 'button',
      customId: 'pvr:show:8',
    });
    await fixture.service.handleInteraction(showInteraction);
    assert.match(getDescription(), /Görünürlük Durumu: Görünür/);
    assert.equal(getViewState(), 'inherit');
    assert.equal(fixture.repoMock.state.room.visibilitySnapshot, null);
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room hide state is reapplied after restart from persisted snapshot', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 39,
      guildId: 'guild-hide-restart-1',
      ownerId: '9039',
      voiceChannelId: 'voice-room-hide-restart-1',
      panelMessageId: null,
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
  });

  try {
    await fixture.service.bootstrap();

    const hideInteraction = fixture.createInteraction({
      userId: '9039',
      type: 'button',
      customId: 'pvr:hide:39',
    });
    await fixture.service.handleInteraction(hideInteraction);
    assert.equal(getViewState(fixture.roomChannel, fixture.guild.id), 'deny');
    assert.notEqual(fixture.repoMock.state.room.visibilitySnapshot, null);

    fixture.service.shutdown();
    delete require.cache[require.resolve('../src/voice/privateRoomService')];

    const restarted = createServiceFixture({
      room: fixture.repoMock.state.room,
    });

    try {
      await restarted.service.bootstrap();
      assert.equal(getViewState(restarted.roomChannel, restarted.guild.id), 'deny');
      const panelMessageId = restarted.repoMock.state.room.panelMessageId;
      const message = restarted.messages.get(panelMessageId);
      const description = message?.embeds?.[0]?.data?.description || message?.embeds?.[0]?.description || '';
      assert.match(description, /Görünürlük Durumu: Gizli/);
    } finally {
      restarted.teardown(previousTimeoutEnv);
    }
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room hide neutralizes role-level view bypass and show restores it', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const roleId = '733600000000000001';
  const fixture = createServiceFixture({
    room: {
      id: 36,
      guildId: 'guild-hide-role-1',
      ownerId: '9036',
      voiceChannelId: 'voice-room-hide-1',
      panelMessageId: 'panel-0',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    roleIds: [roleId],
  });

  try {
    await fixture.roomChannel.permissionOverwrites.edit(roleId, { ViewChannel: true });
    await fixture.service.bootstrap();

    const hideInteraction = fixture.createInteraction({
      userId: '9036',
      type: 'button',
      customId: 'pvr:hide:36',
    });
    await fixture.service.handleInteraction(hideInteraction);

    assert.equal(getViewState(fixture.roomChannel, roleId), 'deny');
    assert.equal(fixture.repoMock.state.room.visibilitySnapshot.managedDenyRoleIds.includes(roleId), true);

    const showInteraction = fixture.createInteraction({
      userId: '9036',
      type: 'button',
      customId: 'pvr:show:36',
    });
    await fixture.service.handleInteraction(showInteraction);

    assert.equal(getViewState(fixture.roomChannel, roleId), 'allow');
    assert.equal(fixture.repoMock.state.room.visibilitySnapshot, null);
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});

test('private room bootstrap recreates stale panel message when stored panel is missing or broken', async () => {
  const previousTimeoutEnv = process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS;
  const fixture = createServiceFixture({
    room: {
      id: 37,
      guildId: 'guild-panel-heal-1',
      ownerId: '9037',
      voiceChannelId: 'voice-room-panel-1',
      panelMessageId: 'panel-stale-1',
      locked: false,
      whitelistMemberIds: [],
      lastActiveAt: Date.now(),
    },
    existingMessages: [
      {
        id: 'panel-stale-1',
        onEdit: async () => {
          throw new Error('panel_edit_failed');
        },
      },
    ],
  });

  try {
    await fixture.service.bootstrap();
    assert.notEqual(fixture.repoMock.state.room.panelMessageId, 'panel-stale-1');
    assert.equal(Boolean(fixture.messages.get(fixture.repoMock.state.room.panelMessageId)), true);
  } finally {
    fixture.teardown(previousTimeoutEnv);
  }
});
