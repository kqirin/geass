const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

const privateVoiceRepository = require('../src/infrastructure/repositories/privateVoiceRepository');

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

function createPrivateRepoMock({ guildId, config, initialRooms = [] }) {
  const state = {
    nextId: Math.max(0, ...initialRooms.map((r) => Number(r.id) || 0)) + 1,
    rooms: initialRooms.map((r) => cloneRoom(r)),
    logs: [],
  };

  return {
    state,
    getGuildConfig: async (targetGuildId) => {
      if (targetGuildId !== guildId)
        return { enabled: false, hubChannelId: null, requiredRoleId: null, categoryId: null };
      return { ...config };
    },
    listAllRooms: async () => state.rooms.map((room) => cloneRoom(room)),
    getRoomByOwner: async (targetGuildId, ownerId) =>
      cloneRoom(
        state.rooms.find((room) => room.guildId === targetGuildId && room.ownerId === String(ownerId)) || null
      ),
    getRoomByChannel: async (targetGuildId, channelId) =>
      cloneRoom(
        state.rooms.find(
          (room) => room.guildId === targetGuildId && room.voiceChannelId === String(channelId)
        ) || null
      ),
    createRoom: async (input) => {
      const room = {
        id: state.nextId++,
        guildId: String(input.guildId),
        ownerId: String(input.ownerId),
        voiceChannelId: String(input.voiceChannelId),
        panelMessageId: input.panelMessageId || null,
        locked: Boolean(input.locked),
        lockSnapshot: input.lockSnapshot ? JSON.parse(JSON.stringify(input.lockSnapshot)) : null,
        visibilitySnapshot: input.visibilitySnapshot ? JSON.parse(JSON.stringify(input.visibilitySnapshot)) : null,
        whitelistMemberIds: Array.isArray(input.whitelistMemberIds)
          ? [...new Set(input.whitelistMemberIds.map(String))]
          : [],
        permitRoleIds: Array.isArray(input.permitRoleIds) ? [...new Set(input.permitRoleIds.map(String))] : [],
        rejectMemberIds: Array.isArray(input.rejectMemberIds) ? [...new Set(input.rejectMemberIds.map(String))] : [],
        rejectRoleIds: Array.isArray(input.rejectRoleIds) ? [...new Set(input.rejectRoleIds.map(String))] : [],
        lastActiveAt: Number(input.lastActiveAt || Date.now()),
      };
      state.rooms.push(room);
      return cloneRoom(room);
    },
    updateRoom: async (roomId, patch) => {
      const idx = state.rooms.findIndex((room) => Number(room.id) === Number(roomId));
      if (idx < 0) return null;
      const room = state.rooms[idx];
      if (Object.prototype.hasOwnProperty.call(patch, 'panelMessageId'))
        room.panelMessageId = patch.panelMessageId || null;
      if (Object.prototype.hasOwnProperty.call(patch, 'ownerId'))
        room.ownerId = String(patch.ownerId || '').trim();
      if (Object.prototype.hasOwnProperty.call(patch, 'locked')) room.locked = Boolean(patch.locked);
      if (Object.prototype.hasOwnProperty.call(patch, 'lockSnapshot')) {
        room.lockSnapshot = patch.lockSnapshot ? JSON.parse(JSON.stringify(patch.lockSnapshot)) : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'visibilitySnapshot')) {
        room.visibilitySnapshot = patch.visibilitySnapshot ? JSON.parse(JSON.stringify(patch.visibilitySnapshot)) : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'whitelistMemberIds')) {
        const ids = Array.isArray(patch.whitelistMemberIds) ? patch.whitelistMemberIds : [];
        room.whitelistMemberIds = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'permitMemberIds')) {
        const ids = Array.isArray(patch.permitMemberIds) ? patch.permitMemberIds : [];
        room.whitelistMemberIds = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'permitRoleIds')) {
        const ids = Array.isArray(patch.permitRoleIds) ? patch.permitRoleIds : [];
        room.permitRoleIds = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'rejectMemberIds')) {
        const ids = Array.isArray(patch.rejectMemberIds) ? patch.rejectMemberIds : [];
        room.rejectMemberIds = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'rejectRoleIds')) {
        const ids = Array.isArray(patch.rejectRoleIds) ? patch.rejectRoleIds : [];
        room.rejectRoleIds = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'lastActiveAt'))
        room.lastActiveAt = Number(patch.lastActiveAt || Date.now());
      state.rooms[idx] = room;
      return cloneRoom(room);
    },
    deleteRoomById: async (roomId) => {
      const idx = state.rooms.findIndex((room) => Number(room.id) === Number(roomId));
      if (idx >= 0) state.rooms.splice(idx, 1);
    },
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
    for (const key of keys) privateVoiceRepository[key] = original[key];
  };
}

function createGuildFixture({ guildId = '1000', clientUserId = '9999' } = {}) {
  const channelsMap = new Map();
  const membersMap = new Map();
  let generatedChannelSeq = 1;
  let generatedMessageSeq = 1;
  let guild = null;

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

  function createVoiceChannel(id, opts = {}) {
    const messageMap = new Map();
    const permissionOverwrites = createPermissionOverwriteCache();
    const channel = {
      id: String(id),
      type: ChannelType.GuildVoice,
      parentId: opts.parentId || null,
      bitrate: opts.bitrate || 64000,
      guild,
      members: new Map(),
      deleted: false,
      deletedReason: null,
      isTextBased: () => true,
      permissionOverwrites,
      overwriteStateById: permissionOverwrites.stateById,
      send: async (payload) => {
        const message = {
          id: `msg-${generatedMessageSeq++}`,
          author: { id: clientUserId },
          embeds: payload?.embeds || [],
          content: payload?.content || '',
          edit: async (nextPayload) => {
            message.embeds = nextPayload?.embeds || [];
            message.content = nextPayload?.content || '';
            return message;
          },
          delete: async () => {},
        };
        messageMap.set(message.id, message);
        channel.lastPayload = payload;
        return message;
      },
      messages: {
        fetch: async (messageId) => messageMap.get(String(messageId)) || null,
      },
      setName: async (name) => {
        channel.name = name;
      },
      setUserLimit: async (limit) => {
        channel.userLimit = Number(limit);
      },
      delete: async (reason) => {
        channel.deleted = true;
        channel.deletedReason = reason;
        channelsMap.delete(channel.id);
      },
    };
    channelsMap.set(channel.id, channel);
    return channel;
  }

  guild = {
    id: String(guildId),
    roles: {
      everyone: { id: String(guildId) },
      cache: {
        get: (id) => {
          const normalizedId = String(id);
          if (normalizedId === String(guildId)) return { id: String(guildId), name: '@everyone' };
          return { id: normalizedId, name: `role-${normalizedId}` };
        },
        has: () => true,
      },
    },
    channels: {
      cache: {
        get: (id) => channelsMap.get(String(id)) || null,
      },
      fetch: async (id) => channelsMap.get(String(id)) || null,
      create: async (opts) =>
        createVoiceChannel(`generated-${generatedChannelSeq++}`, {
          parentId: opts.parent || null,
          bitrate: opts.bitrate || 64000,
        }),
    },
    members: {
      me: {
        id: String(clientUserId),
        permissions: {
          has: () => true,
        },
      },
      cache: {
        get: (id) => membersMap.get(String(id)) || null,
      },
      fetch: async (id) => membersMap.get(String(id)) || null,
    },
  };

  function addMember(id, { roleIds = [] } = {}) {
    const roleSet = new Set(roleIds.map((x) => String(x)));
    const member = {
      id: String(id),
      guild,
      user: {
        id: String(id),
        bot: false,
        username: `user-${id}`,
      },
      displayName: `user-${id}`,
      disconnectCount: 0,
      roles: {
        cache: {
          has: (roleId) => roleSet.has(String(roleId)),
          keys: function* iterateRoleIds() {
            for (const roleId of roleSet) yield roleId;
          },
          forEach: (fn) => {
            for (const roleId of roleSet) fn({ id: roleId, name: `role-${roleId}` }, roleId);
          },
        },
      },
      voice: {
        channelId: null,
        setChannel: async (channel) => {
          const previousChannel = member.voice.channelId
            ? channelsMap.get(String(member.voice.channelId))
            : null;
          if (previousChannel) previousChannel.members.delete(member.id);

          if (channel) {
            channel.members.set(member.id, member);
            member.voice.channelId = channel.id;
          } else {
            member.voice.channelId = null;
          }
        },
        disconnect: async () => {
          member.disconnectCount += 1;
          await member.voice.setChannel(null);
        },
      },
    };
    membersMap.set(member.id, member);
    return member;
  }

  function addVoiceChannel(id, opts = {}) {
    return createVoiceChannel(String(id), opts);
  }

  return { guild, addMember, addVoiceChannel, channelsMap, membersMap };
}

function createInteraction({ guild, clientUserId, userId, customId, type, values = [] }) {
  const interaction = {
    guildId: guild.id,
    guild,
    customId,
    values,
    user: { id: String(userId) },
    replied: false,
    deferred: false,
    replies: [],
    message: {
      id: null,
      author: { id: clientUserId },
      embeds: [{ title: 'Oda Kontrol' }],
    },
    inGuild: () => true,
    isButton: () => type === 'button',
    isStringSelectMenu: () => type === 'string-select',
    isUserSelectMenu: () => type === 'user-select',
    isRoleSelectMenu: () => type === 'role-select',
    isModalSubmit: () => type === 'modal',
    isRepliable: () => true,
  };

  interaction.reply = async (payload) => {
    interaction.replied = true;
    interaction.replies.push(payload);
    return payload;
  };
  interaction.deferReply = async () => {
    interaction.deferred = true;
  };
  interaction.deferUpdate = async () => {
    interaction.deferred = true;
  };
  interaction.editReply = async (payload) => {
    interaction.replies.push(payload);
    return payload;
  };
  interaction.followUp = async (payload) => {
    interaction.replies.push(payload);
    return payload;
  };
  interaction.showModal = async () => {};

  return interaction;
}

test('private room integration: create/persist/lock/whitelist/non-owner guard', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const hubChannel = fixture.addVoiceChannel('2000');
  const owner = fixture.addMember('3001', { roleIds: ['500'] });
  const nonOwner = fixture.addMember('3002');
  fixture.addMember('3003');
  fixture.addMember('3004', { roleIds: ['500'] });

  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: hubChannel.id,
      requiredRoleId: '500',
      categoryId: null,
    },
    initialRooms: [],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });

  try {
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null },
      { guild: fixture.guild, channelId: hubChannel.id, channel: hubChannel, member: owner, id: owner.id }
    );

    assert.equal(repoMock.state.rooms.length, 1);
    assert.equal(repoMock.state.rooms[0].ownerId, owner.id);
    assert.notEqual(owner.voice.channelId, hubChannel.id);

    const room = repoMock.state.rooms[0];
    const roomChannelId = room.voiceChannelId;

    await owner.voice.setChannel(hubChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: roomChannelId },
      { guild: fixture.guild, channelId: hubChannel.id, channel: hubChannel, member: owner, id: owner.id }
    );

    assert.equal(repoMock.state.rooms.length, 1);
    assert.equal(owner.voice.channelId, roomChannelId);

    const ownerLockInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: `pvr:lockon:${room.id}`,
      type: 'button',
    });
    await service.handleInteraction(ownerLockInteraction);
    assert.equal(repoMock.state.rooms[0].locked, true);

    const nonOwnerLockInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: nonOwner.id,
      customId: `pvr:lockon:${room.id}`,
      type: 'button',
    });
    await service.handleInteraction(nonOwnerLockInteraction);
    assert.equal(repoMock.state.rooms[0].locked, true);
    assert.equal(
      nonOwnerLockInteraction.replies.some((payload) =>
        String(payload?.content || '').includes('yalnızca oda sahibi')
      ),
      true
    );

    const permitManageInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: `pvr:allow:${room.id}`,
      type: 'button',
    });
    await service.handleInteraction(permitManageInteraction);
    const permitReply = permitManageInteraction.replies[0];
    assert.equal(
      permitManageInteraction.replies.some((payload) =>
        String(payload?.content || '').includes('İzin Verilenler')
      ),
      true
    );
    assert.equal(String(permitReply?.content || '').includes('+ @'), false);
    assert.equal(
      permitReply?.components?.[0]?.components?.[0]?.data?.placeholder ||
      permitReply?.components?.[0]?.components?.[0]?.placeholder,
      'İzin verilecek üyeleri seç'
    );
    assert.equal(
      permitReply?.components?.[1]?.components?.[0]?.data?.placeholder ||
      permitReply?.components?.[1]?.components?.[0]?.placeholder,
      'İzin verilecek rolleri seç'
    );

    const roomChannel = fixture.channelsMap.get(String(roomChannelId));
    const transferInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: `pvr:transfer:${room.id}`,
      type: 'button',
    });
    await service.handleInteraction(transferInteraction);
    assert.equal(
      transferInteraction.replies.some((payload) =>
        String(payload?.content || '').includes('Oda Devri')
      ),
      true
    );

    await owner.voice.setChannel(null);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: roomChannelId },
      { guild: fixture.guild, channelId: null, channel: null, member: owner, id: owner.id }
    );
    assert.equal(repoMock.state.rooms.length, 1);
  } finally {
    service.shutdown();
    restoreRepo();
  }
});

test('private room integration: ownership transfer requires in-room member with required role', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const hubChannel = fixture.addVoiceChannel('2200');
  const roomChannel = fixture.addVoiceChannel('2201');
  const owner = fixture.addMember('3201', { roleIds: ['500'] });
  const offChannelTarget = fixture.addMember('3202', { roleIds: ['500'] });
  const missingRoleTarget = fixture.addMember('3203');
  await owner.voice.setChannel(roomChannel);
  await missingRoleTarget.voice.setChannel(roomChannel);

  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: hubChannel.id,
      requiredRoleId: '500',
      categoryId: null,
    },
    initialRooms: [
      {
        id: 5,
        guildId: fixture.guild.id,
        ownerId: owner.id,
        voiceChannelId: roomChannel.id,
        panelMessageId: 'panel-0',
        locked: false,
        whitelistMemberIds: [],
        lastActiveAt: Date.now(),
      },
    ],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });
  try {
    await service.bootstrap();

    const offChannelInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: 'pvru:transfer:5',
      type: 'user-select',
      values: [offChannelTarget.id],
    });
    await service.handleInteraction(offChannelInteraction);
    assert.equal(repoMock.state.rooms[0].ownerId, owner.id);
    assert.equal(
      offChannelInteraction.replies.some((payload) =>
        String(payload?.content || '').includes('yalnızca odadaki bir üyeye')
      ),
      true
    );

    const missingRoleInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: 'pvru:transfer:5',
      type: 'user-select',
      values: [missingRoleTarget.id],
    });
    await service.handleInteraction(missingRoleInteraction);
    assert.equal(repoMock.state.rooms[0].ownerId, owner.id);
    assert.equal(
      missingRoleInteraction.replies.some((payload) =>
        String(payload?.content || '').includes('gerekli role sahip değil')
      ),
      true
    );
  } finally {
    service.shutdown();
    restoreRepo();
  }
});

test('private room integration: bootstrap recover, lock enforcement, stale cleanup', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const activeRoomChannel = fixture.addVoiceChannel('2101');
  const staleRoomChannel = fixture.addVoiceChannel('2102');

  const owner = fixture.addMember('3101');
  const intruder = fixture.addMember('3102');
  await owner.voice.setChannel(activeRoomChannel);
  await intruder.voice.setChannel(activeRoomChannel);

  const now = Date.now();
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;

  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: 'unused',
      requiredRoleId: 'unused',
      categoryId: null,
    },
    initialRooms: [
      {
        id: 1,
        guildId: fixture.guild.id,
        ownerId: owner.id,
        voiceChannelId: activeRoomChannel.id,
        panelMessageId: null,
        locked: true,
        whitelistMemberIds: [],
        lastActiveAt: now,
      },
      {
        id: 2,
        guildId: fixture.guild.id,
        ownerId: '3999',
        voiceChannelId: staleRoomChannel.id,
        panelMessageId: null,
        locked: false,
        whitelistMemberIds: [],
        lastActiveAt: now - fourDaysMs,
      },
    ],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });
  try {
    const loaded = await service.bootstrap();
    assert.equal(loaded >= 1, true);

    const activeRoom = repoMock.state.rooms.find((room) => Number(room.id) === 1);
    assert.ok(activeRoom);
    assert.equal(Boolean(activeRoom.panelMessageId), true);
    assert.equal(intruder.disconnectCount, 1);

    assert.equal(staleRoomChannel.deleted, true);
    assert.equal(
      repoMock.state.rooms.some((room) => Number(room.id) === 2),
      false
    );
  } finally {
    service.shutdown();
    restoreRepo();
  }
});

test('private room integration: cleanup keeps DB/cache when Discord channel delete fails', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const staleRoomChannel = fixture.addVoiceChannel('2301');
  staleRoomChannel.delete = async () => {
    throw new Error('delete_failed');
  };

  const now = Date.now();
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: 'unused',
      requiredRoleId: 'unused',
      categoryId: null,
    },
    initialRooms: [
      {
        id: 9,
        guildId: fixture.guild.id,
        ownerId: '3998',
        voiceChannelId: staleRoomChannel.id,
        panelMessageId: null,
        locked: false,
        whitelistMemberIds: [],
        lastActiveAt: now - fourDaysMs,
      },
    ],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });
  try {
    await service.bootstrap();

    assert.equal(repoMock.state.rooms.some((room) => Number(room.id) === 9), true);
    assert.equal(fixture.channelsMap.has(staleRoomChannel.id), true);
  } finally {
    service.shutdown();
    restoreRepo();
  }
});

test('private room integration: permit/reject enforcement covers users, roles, and privileged runtime joins', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const roomChannel = fixture.addVoiceChannel('2401');

  const owner = fixture.addMember('3401', { roleIds: ['500'] });
  const permitUser = fixture.addMember('3402');
  const privilegedUser = fixture.addMember('3403', { roleIds: ['900000000000000021'] });
  const rejectUser = fixture.addMember('3404');
  const permitRoleUser = fixture.addMember('3405', { roleIds: ['900000000000000022'] });
  const rejectRoleUser = fixture.addMember('3406', { roleIds: ['900000000000000023'] });
  const conflictRoleUser = fixture.addMember('3407', { roleIds: ['900000000000000022', '900000000000000023'] });

  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: 'unused',
      requiredRoleId: '500',
      categoryId: null,
    },
    initialRooms: [
      {
        id: 11,
        guildId: fixture.guild.id,
        ownerId: owner.id,
        voiceChannelId: roomChannel.id,
        panelMessageId: null,
        locked: true,
        whitelistMemberIds: [permitUser.id],
        permitRoleIds: ['900000000000000022'],
        rejectMemberIds: [rejectUser.id],
        rejectRoleIds: ['900000000000000023'],
        lastActiveAt: Date.now(),
      },
    ],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });
  try {
    await service.bootstrap();

    const everyoneState = roomChannel.overwriteStateById.get(fixture.guild.id);
    assert.equal(everyoneState?.deny?.has('Connect') || false, true);
    assert.equal(roomChannel.overwriteStateById.get(permitUser.id)?.allow?.has('Connect') || false, true);
    assert.equal(roomChannel.overwriteStateById.get('900000000000000022')?.allow?.has('Connect') || false, true);
    assert.equal(roomChannel.overwriteStateById.get(rejectUser.id)?.deny?.has('Connect') || false, true);
    assert.equal(roomChannel.overwriteStateById.get('900000000000000023')?.deny?.has('Connect') || false, true);

    await privilegedUser.voice.setChannel(roomChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null, member: privilegedUser, id: privilegedUser.id },
      { guild: fixture.guild, channelId: roomChannel.id, channel: roomChannel, member: privilegedUser, id: privilegedUser.id }
    );
    assert.equal(privilegedUser.disconnectCount, 1);
    assert.equal(privilegedUser.voice.channelId, null);

    await permitUser.voice.setChannel(roomChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null, member: permitUser, id: permitUser.id },
      { guild: fixture.guild, channelId: roomChannel.id, channel: roomChannel, member: permitUser, id: permitUser.id }
    );
    assert.equal(permitUser.disconnectCount, 0);
    assert.equal(permitUser.voice.channelId, roomChannel.id);

    await rejectUser.voice.setChannel(roomChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null, member: rejectUser, id: rejectUser.id },
      { guild: fixture.guild, channelId: roomChannel.id, channel: roomChannel, member: rejectUser, id: rejectUser.id }
    );
    assert.equal(rejectUser.disconnectCount, 1);
    assert.equal(rejectUser.voice.channelId, null);

    await permitRoleUser.voice.setChannel(roomChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null, member: permitRoleUser, id: permitRoleUser.id },
      { guild: fixture.guild, channelId: roomChannel.id, channel: roomChannel, member: permitRoleUser, id: permitRoleUser.id }
    );
    assert.equal(permitRoleUser.disconnectCount, 0);
    assert.equal(permitRoleUser.voice.channelId, roomChannel.id);

    await rejectRoleUser.voice.setChannel(roomChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null, member: rejectRoleUser, id: rejectRoleUser.id },
      { guild: fixture.guild, channelId: roomChannel.id, channel: roomChannel, member: rejectRoleUser, id: rejectRoleUser.id }
    );
    assert.equal(rejectRoleUser.disconnectCount, 1);
    assert.equal(rejectRoleUser.voice.channelId, null);

    await conflictRoleUser.voice.setChannel(roomChannel);
    await service.handleVoiceStateUpdate(
      { guild: fixture.guild, channelId: null, member: conflictRoleUser, id: conflictRoleUser.id },
      { guild: fixture.guild, channelId: roomChannel.id, channel: roomChannel, member: conflictRoleUser, id: conflictRoleUser.id }
    );
    assert.equal(conflictRoleUser.disconnectCount, 1);
    assert.equal(conflictRoleUser.voice.channelId, null);
  } finally {
    service.shutdown();
    restoreRepo();
  }
});

test('private room integration: role permit/reject selectors update state without changing panel surface', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const roomChannel = fixture.addVoiceChannel('2501');
  const owner = fixture.addMember('3501', { roleIds: ['500'] });

  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: 'unused',
      requiredRoleId: '500',
      categoryId: null,
    },
    initialRooms: [
      {
        id: 12,
        guildId: fixture.guild.id,
        ownerId: owner.id,
        voiceChannelId: roomChannel.id,
        panelMessageId: null,
        locked: false,
        whitelistMemberIds: [],
        permitRoleIds: [],
        rejectMemberIds: [],
        rejectRoleIds: [],
        lastActiveAt: Date.now(),
      },
    ],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });
  try {
    await service.bootstrap();
    const panelMessage = roomChannel.lastPayload;
    assert.equal(panelMessage?.embeds?.[0]?.data?.title || panelMessage?.embeds?.[0]?.title, 'Oda Kontrol');
    assert.equal(panelMessage?.components?.length || 0, 2);
    assert.equal(panelMessage?.components?.[0]?.components?.length || 0, 5);
    assert.equal(panelMessage?.components?.[1]?.components?.length || 0, 5);

    const permitRoleInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: 'pvrr:permit:12',
      type: 'role-select',
      values: ['900000000000000031'],
    });
    await service.handleInteraction(permitRoleInteraction);
    assert.deepEqual(repoMock.state.rooms[0].permitRoleIds, ['900000000000000031']);

    const rejectRoleInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: 'pvrr:reject:12',
      type: 'role-select',
      values: ['900000000000000032'],
    });
    await service.handleInteraction(rejectRoleInteraction);
    assert.deepEqual(repoMock.state.rooms[0].rejectRoleIds, ['900000000000000032']);

    const panelMessageAfter = roomChannel.lastPayload;
    assert.equal(panelMessageAfter?.embeds?.[0]?.data?.title || panelMessageAfter?.embeds?.[0]?.title, 'Oda Kontrol');
    assert.equal(panelMessageAfter?.components?.length || 0, 2);
    assert.equal(panelMessageAfter?.components?.[0]?.components?.length || 0, 5);
    assert.equal(panelMessageAfter?.components?.[1]?.components?.length || 0, 5);
  } finally {
    service.shutdown();
    restoreRepo();
  }
});

test('private room integration: transient channel fetch failure does not delete persisted room state on bootstrap', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const roomChannel = fixture.addVoiceChannel('2601');

  const repoMock = createPrivateRepoMock({
    guildId: fixture.guild.id,
    config: {
      enabled: true,
      hubChannelId: 'unused',
      requiredRoleId: '500',
      categoryId: null,
    },
    initialRooms: [
      {
        id: 13,
        guildId: fixture.guild.id,
        ownerId: '3601',
        voiceChannelId: roomChannel.id,
        panelMessageId: null,
        locked: true,
        whitelistMemberIds: [],
        permitRoleIds: [],
        rejectMemberIds: [],
        rejectRoleIds: [],
        lastActiveAt: Date.now(),
      },
    ],
  });
  const restoreRepo = patchPrivateRepo(repoMock);

  const originalCacheGet = fixture.guild.channels.cache.get;
  const originalFetch = fixture.guild.channels.fetch;
  fixture.guild.channels.cache.get = () => null;
  fixture.guild.channels.fetch = async () => {
    throw new Error('transient_channel_fetch_failure');
  };

  const client = {
    user: { id: '9999' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };

  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });
  try {
    const loaded = await service.bootstrap();
    assert.equal(loaded, 1);
    assert.equal(repoMock.state.rooms.some((room) => Number(room.id) === 13), true);
  } finally {
    fixture.guild.channels.cache.get = originalCacheGet;
    fixture.guild.channels.fetch = originalFetch;
    service.shutdown();
    restoreRepo();
  }
});


