const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

const privateVoiceRepository = require('../src/infrastructure/repositories/privateVoiceRepository');
const { createPrivateRoomService } = require('../src/voice/privateRoomService');

function cloneRoom(room) {
  return {
    ...room,
    whitelistMemberIds: Array.isArray(room.whitelistMemberIds) ? [...room.whitelistMemberIds] : [],
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
        whitelistMemberIds: Array.isArray(input.whitelistMemberIds)
          ? [...new Set(input.whitelistMemberIds.map(String))]
          : [],
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
      if (Object.prototype.hasOwnProperty.call(patch, 'locked')) room.locked = Boolean(patch.locked);
      if (Object.prototype.hasOwnProperty.call(patch, 'whitelistMemberIds')) {
        const ids = Array.isArray(patch.whitelistMemberIds) ? patch.whitelistMemberIds : [];
        room.whitelistMemberIds = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
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

  function createVoiceChannel(id, opts = {}) {
    const messageMap = new Map();
    const channel = {
      id: String(id),
      type: ChannelType.GuildVoice,
      parentId: opts.parentId || null,
      bitrate: opts.bitrate || 64000,
      members: new Map(),
      deleted: false,
      deletedReason: null,
      isTextBased: () => true,
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

  const guild = {
    id: String(guildId),
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
      author: { id: clientUserId },
      embeds: [{ title: 'Oda Kontrol' }],
    },
    inGuild: () => true,
    isButton: () => type === 'button',
    isStringSelectMenu: () => type === 'string-select',
    isUserSelectMenu: () => type === 'user-select',
    isModalSubmit: () => type === 'modal',
    isRepliable: () => true,
  };

  interaction.reply = async (payload) => {
    interaction.replied = true;
    interaction.replies.push(payload);
  };
  interaction.followUp = async (payload) => {
    interaction.replies.push(payload);
  };
  interaction.showModal = async () => {};

  return interaction;
}

test('private room integration: create/persist/lock/whitelist/non-owner guard', async () => {
  const fixture = createGuildFixture();
  const hubChannel = fixture.addVoiceChannel('2000');
  const owner = fixture.addMember('3001', { roleIds: ['500'] });
  const nonOwner = fixture.addMember('3002');
  const whitelistTarget = fixture.addMember('3003');

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
      customId: `pvr:lock:${room.id}`,
      type: 'button',
    });
    await service.handleInteraction(ownerLockInteraction);
    assert.equal(repoMock.state.rooms[0].locked, true);

    const nonOwnerLockInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: nonOwner.id,
      customId: `pvr:lock:${room.id}`,
      type: 'button',
    });
    await service.handleInteraction(nonOwnerLockInteraction);
    assert.equal(repoMock.state.rooms[0].locked, true);
    assert.equal(
      nonOwnerLockInteraction.replies.some((payload) =>
        String(payload?.content || '').includes('Yetkin yok')
      ),
      true
    );

    const whitelistAddInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: `pvru:sync:${room.id}`,
      type: 'user-select',
      values: [whitelistTarget.id],
    });
    await service.handleInteraction(whitelistAddInteraction);
    assert.deepEqual(repoMock.state.rooms[0].whitelistMemberIds, [whitelistTarget.id]);

    const whitelistRemoveInteraction = createInteraction({
      guild: fixture.guild,
      clientUserId: client.user.id,
      userId: owner.id,
      customId: `pvru:sync:${room.id}`,
      type: 'user-select',
      values: [],
    });
    await service.handleInteraction(whitelistRemoveInteraction);
    assert.deepEqual(repoMock.state.rooms[0].whitelistMemberIds, []);

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

test('private room integration: bootstrap recover, lock enforcement, stale cleanup', async () => {
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
