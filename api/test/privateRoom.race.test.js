const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

const privateVoiceRepository = require('../src/infrastructure/repositories/privateVoiceRepository');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneRoom(room) {
  return room
    ? {
        ...room,
        lockSnapshot: room.lockSnapshot ? JSON.parse(JSON.stringify(room.lockSnapshot)) : null,
        visibilitySnapshot: room.visibilitySnapshot ? JSON.parse(JSON.stringify(room.visibilitySnapshot)) : null,
        whitelistMemberIds: Array.isArray(room.whitelistMemberIds) ? [...room.whitelistMemberIds] : [],
        permitRoleIds: Array.isArray(room.permitRoleIds) ? [...room.permitRoleIds] : [],
        rejectMemberIds: Array.isArray(room.rejectMemberIds) ? [...room.rejectMemberIds] : [],
        rejectRoleIds: Array.isArray(room.rejectRoleIds) ? [...room.rejectRoleIds] : [],
      }
    : null;
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

function createGuildFixture() {
  const channels = new Map();
  const members = new Map();
  let nextChannelId = 1;
  let nextMessageId = 1;

  const guild = {
    id: 'guild-race-1',
    roles: {
      everyone: { id: 'guild-race-1' },
      cache: {
        get: (id) => ({ id: String(id), name: `role-${id}` }),
        has: () => true,
      },
    },
    members: {
      me: {
        id: 'bot-1',
        permissions: {
          has: () => true,
        },
        displayAvatarURL: () => 'https://example.com/avatar.png',
      },
      cache: {
        get: (id) => members.get(String(id)) || null,
      },
      fetch: async (id) => members.get(String(id)) || null,
    },
  };

  function createVoiceChannel(id, { parentId = null } = {}) {
    const overwriteStateById = new Map();
    const messageMap = new Map();
    const channel = {
      id: String(id),
      type: ChannelType.GuildVoice,
      parentId,
      bitrate: 64000,
      guild,
      members: new Map(),
      permissionOverwrites: {
        cache: {
          get: (targetId) => overwriteStateById.get(String(targetId)) || null,
        },
        edit: async (target, permissions = {}) => {
          const targetId = String(target?.id || target);
          const entry = overwriteStateById.get(targetId) || {
            allow: new Set(),
            deny: new Set(),
          };
          for (const [permission, value] of Object.entries(permissions || {})) {
            if (value === true) {
              entry.allow.add(permission);
              entry.deny.delete(permission);
            } else if (value === false) {
              entry.deny.add(permission);
              entry.allow.delete(permission);
            } else {
              entry.allow.delete(permission);
              entry.deny.delete(permission);
            }
          }
          if (entry.allow.size || entry.deny.size) {
            overwriteStateById.set(targetId, {
              allow: { has: (permission) => entry.allow.has(String(permission)) },
              deny: { has: (permission) => entry.deny.has(String(permission)) },
            });
          } else {
            overwriteStateById.delete(targetId);
          }
          return null;
        },
      },
      isTextBased: () => true,
      send: async (payload) => {
        const message = {
          id: `panel-${nextMessageId++}`,
          author: { id: 'bot-1' },
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
        return message;
      },
      messages: {
        fetch: async (id) => messageMap.get(String(id)) || null,
      },
      fetch: async function fetch() {
        return this;
      },
      delete: async () => {
        channels.delete(channel.id);
      },
    };
    channels.set(channel.id, channel);
    return channel;
  }

  guild.channels = {
    cache: {
      get: (id) => channels.get(String(id)) || null,
    },
    fetch: async (id) => channels.get(String(id)) || null,
    create: async (options) => createVoiceChannel(`generated-${nextChannelId++}`, { parentId: options.parent || null }),
  };

  function addMember(id, roleIds = []) {
    const roles = new Set(roleIds.map(String));
    const member = {
      id: String(id),
      guild,
      user: { id: String(id), username: `user-${id}`, bot: false },
      displayName: `user-${id}`,
      roles: {
        cache: {
          has: (roleId) => roles.has(String(roleId)),
          keys: function* iterateRoleIds() {
            for (const roleId of roles) yield roleId;
          },
          forEach: (fn) => {
            for (const roleId of roles) fn({ id: roleId, name: `role-${roleId}` }, roleId);
          },
        },
      },
      voice: {
        channelId: null,
        setChannel: async (channel) => {
          if (member.voice.channelId) {
            channels.get(String(member.voice.channelId))?.members.delete(member.id);
          }
          if (channel) {
            channel.members.set(member.id, member);
            member.voice.channelId = channel.id;
          } else {
            member.voice.channelId = null;
          }
        },
        disconnect: async () => {
          await member.voice.setChannel(null);
        },
      },
    };
    members.set(member.id, member);
    return member;
  }

  return {
    guild,
    createVoiceChannel,
    addMember,
  };
}

test('private room create path serializes concurrent hub joins for the same owner', async () => {
  delete require.cache[require.resolve('../src/voice/privateRoomService')];
  const { createPrivateRoomService } = require('../src/voice/privateRoomService');
  const fixture = createGuildFixture();
  const hubChannel = fixture.createVoiceChannel('hub-1');
  const member = fixture.addMember('owner-1', ['role-allow']);

  const repoState = {
    rooms: [],
    createCalls: 0,
  };

  const restoreRepo = patchPrivateRepo({
    getGuildConfig: async () => ({
      enabled: true,
      hubChannelId: hubChannel.id,
      requiredRoleId: 'role-allow',
      categoryId: null,
    }),
    listAllRooms: async () => repoState.rooms.map(cloneRoom),
    getRoomByOwner: async (_guildId, ownerId) =>
      cloneRoom(repoState.rooms.find((room) => room.ownerId === String(ownerId)) || null),
    getRoomByChannel: async (_guildId, channelId) =>
      cloneRoom(repoState.rooms.find((room) => room.voiceChannelId === String(channelId)) || null),
    createRoom: async (input) => {
      repoState.createCalls += 1;
      await wait(40);
      const room = {
        id: repoState.createCalls,
        guildId: input.guildId,
        ownerId: input.ownerId,
        voiceChannelId: input.voiceChannelId,
        panelMessageId: null,
        locked: false,
        lockSnapshot: null,
        visibilitySnapshot: null,
        whitelistMemberIds: [],
        lastActiveAt: Number(input.lastActiveAt || Date.now()),
      };
      repoState.rooms.push(room);
      return cloneRoom(room);
    },
    updateRoom: async (roomId, patch) => {
      const room = repoState.rooms.find((entry) => Number(entry.id) === Number(roomId));
      if (!room) return null;
      Object.assign(room, patch);
      return cloneRoom(room);
    },
    deleteRoomById: async (roomId) => {
      const index = repoState.rooms.findIndex((room) => Number(room.id) === Number(roomId));
      if (index >= 0) repoState.rooms.splice(index, 1);
    },
    insertRoomLog: async () => {},
  });

  const client = {
    user: { id: 'bot-1' },
    guilds: {
      cache: new Map([[fixture.guild.id, fixture.guild]]),
      fetch: async (id) => (String(id) === fixture.guild.id ? fixture.guild : null),
    },
  };
  const service = createPrivateRoomService({ client, logSystem: () => {}, logError: () => {} });

  try {
    const oldState = { guild: fixture.guild, channelId: null };
    const newState = {
      guild: fixture.guild,
      channelId: hubChannel.id,
      channel: hubChannel,
      member,
      id: member.id,
    };

    await Promise.all([
      service.handleVoiceStateUpdate(oldState, newState),
      service.handleVoiceStateUpdate(oldState, newState),
    ]);

    assert.equal(repoState.createCalls, 1);
    assert.equal(repoState.rooms.length, 1);
  } finally {
    service.shutdown();
    restoreRepo();
    delete require.cache[require.resolve('../src/voice/privateRoomService')];
  }
});
