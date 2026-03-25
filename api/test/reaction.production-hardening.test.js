const test = require('node:test');
const assert = require('node:assert/strict');

const reactionRuleRepository = require('../src/infrastructure/repositories/reactionRuleRepository');
const { createReactionActionService } = require('../src/application/reactionActions/service');

function createBaseGuildFixture() {
  const member = {
    id: 'user-1',
    user: { id: 'user-1', bot: false },
    manageable: true,
    roles: {
      cache: {
        some: () => false,
      },
    },
    send: async () => {},
  };

  const message = {
    id: 'msg-1',
    reactions: {
      cache: [],
      fetch: async () => {},
    },
  };

  const channel = {
    id: 'ch-1',
    isTextBased: () => true,
    send: async () => {},
    permissionsFor: () => ({
      has: (permission) => !['SendMessages'].includes(permission),
    }),
    messages: {
      fetch: async () => message,
    },
  };

  const guild = {
    id: 'guild-1',
    members: {
      me: {
        id: 'bot-1',
        permissions: {
          has: (permission) => ['ManageRoles', 'ManageMessages'].includes(permission),
        },
        roles: { highest: { position: 10 } },
      },
      fetchMe: async function fetchMe() {
        return this.me;
      },
      cache: {
        get: (id) => (id === member.id ? member : null),
      },
      fetch: async (id) => (id === member.id ? member : null),
    },
    channels: {
      cache: {
        get: (id) => (id === channel.id ? channel : null),
      },
      fetch: async (id) => (id === channel.id ? channel : null),
    },
    roles: {
      cache: {
        get: () => null,
      },
      fetch: async () => null,
    },
    emojis: {
      cache: {
        get: () => null,
      },
      fetch: async () => null,
    },
  };

  const client = {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (id === guild.id ? guild : null),
    },
  };

  return { client, guild, channel, message, member };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('reaction service allows onlyOnce toggle rules to execute once per event direction', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    tryBeginOnlyOnceExecution: reactionRuleRepository.tryBeginOnlyOnceExecution,
    markOnlyOnceExecutionSuccess: reactionRuleRepository.markOnlyOnceExecutionSuccess,
    releaseOnlyOnceExecution: reactionRuleRepository.releaseOnlyOnceExecution,
    hasSuccessfulExecution: reactionRuleRepository.hasSuccessfulExecution,
  };

  const logged = [];
  const executionStates = new Map();
  const { client, guild, channel, message, member } = createBaseGuildFixture();
  let addedRoles = 0;
  let removedRoles = 0;
  const role = { id: 'role-1', position: 1, permissions: { has: () => false } };
  guild.roles.cache.get = () => role;
  guild.roles.fetch = async () => role;
  member.roles = {
    cache: {
      some: () => false,
    },
    add: async () => {
      addedRoles += 1;
    },
    remove: async () => {
      removedRoles += 1;
    },
  };

  reactionRuleRepository.listEnabledRulesByGuild = async () => [
    {
      id: 7,
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      emojiType: 'unicode',
      emojiId: null,
      emojiName: '✅',
      triggerMode: 'TOGGLE',
      enabled: true,
      cooldownSeconds: 0,
      onlyOnce: true,
      groupKey: null,
      allowedRoles: [],
      excludedRoles: [],
      actions: [{ type: 'ROLE_ADD', payload: { roleId: role.id } }],
    },
  ];
  reactionRuleRepository.tryBeginOnlyOnceExecution = async ({ ruleId, userId, eventType }) => {
    const key = `${ruleId}:${userId}:${eventType}`;
    const state = executionStates.get(key) || null;
    if (state) return { acquired: false, state };
    executionStates.set(key, 'PENDING');
    return { acquired: true, state: 'PENDING' };
  };
  reactionRuleRepository.markOnlyOnceExecutionSuccess = async ({ ruleId, userId, eventType }) => {
    executionStates.set(`${ruleId}:${userId}:${eventType}`, 'SUCCESS');
  };
  reactionRuleRepository.releaseOnlyOnceExecution = async ({ ruleId, userId, eventType }) => {
    executionStates.delete(`${ruleId}:${userId}:${eventType}`);
  };
  reactionRuleRepository.hasSuccessfulExecution = async (_ruleId, userId, eventType) => {
    return executionStates.get(`7:${userId}:${eventType}`) === 'SUCCESS';
  };
  reactionRuleRepository.logRuleEvent = async (entry) => {
    logged.push(entry);
  };

  try {
    const service = createReactionActionService({ client });
    const reaction = {
      emoji: { id: null, name: '✅' },
      message: {
        id: message.id,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        reactions: message.reactions,
      },
    };

    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });
    await service.handleReactionEvent('REMOVE', reaction, { id: member.id, bot: false });

    assert.equal(addedRoles, 1);
    assert.equal(removedRoles, 1);
    assert.deepEqual(
      logged.map((entry) => entry.status),
      ['SUCCESS', 'SUCCESS']
    );
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.logRuleEvent = original.logRuleEvent;
    reactionRuleRepository.tryBeginOnlyOnceExecution = original.tryBeginOnlyOnceExecution;
    reactionRuleRepository.markOnlyOnceExecutionSuccess = original.markOnlyOnceExecutionSuccess;
    reactionRuleRepository.releaseOnlyOnceExecution = original.releaseOnlyOnceExecution;
    reactionRuleRepository.hasSuccessfulExecution = original.hasSuccessfulExecution;
  }
});

test('reaction service blocks concurrent onlyOnce executions before the second action runs', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    tryBeginOnlyOnceExecution: reactionRuleRepository.tryBeginOnlyOnceExecution,
    markOnlyOnceExecutionSuccess: reactionRuleRepository.markOnlyOnceExecutionSuccess,
    releaseOnlyOnceExecution: reactionRuleRepository.releaseOnlyOnceExecution,
  };

  const logged = [];
  const executionStates = new Map();
  const { client, guild, channel, message, member } = createBaseGuildFixture();
  let addedRoles = 0;
  const role = { id: 'role-2', position: 1, permissions: { has: () => false } };
  guild.roles.cache.get = () => role;
  guild.roles.fetch = async () => role;
  member.roles = {
    cache: {
      some: () => false,
    },
    add: async () => {
      addedRoles += 1;
      await wait(25);
    },
    remove: async () => {},
  };

  reactionRuleRepository.listEnabledRulesByGuild = async () => [
    {
      id: 17,
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      emojiType: 'unicode',
      emojiId: null,
      emojiName: 'âœ…',
      triggerMode: 'ADD',
      enabled: true,
      cooldownSeconds: 0,
      onlyOnce: true,
      groupKey: null,
      allowedRoles: [],
      excludedRoles: [],
      actions: [{ type: 'ROLE_ADD', payload: { roleId: role.id } }],
    },
  ];
  reactionRuleRepository.tryBeginOnlyOnceExecution = async ({ ruleId, userId, eventType }) => {
    const key = `${ruleId}:${userId}:${eventType}`;
    const state = executionStates.get(key) || null;
    if (state) return { acquired: false, state };
    executionStates.set(key, 'PENDING');
    return { acquired: true, state: 'PENDING' };
  };
  reactionRuleRepository.markOnlyOnceExecutionSuccess = async ({ ruleId, userId, eventType }) => {
    executionStates.set(`${ruleId}:${userId}:${eventType}`, 'SUCCESS');
  };
  reactionRuleRepository.releaseOnlyOnceExecution = async ({ ruleId, userId, eventType }) => {
    executionStates.delete(`${ruleId}:${userId}:${eventType}`);
  };
  reactionRuleRepository.logRuleEvent = async (entry) => {
    logged.push(entry);
  };

  try {
    const service = createReactionActionService({ client });
    const reaction = {
      emoji: { id: null, name: 'âœ…' },
      message: {
        id: message.id,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        reactions: message.reactions,
      },
    };

    await Promise.all([
      service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false }),
      service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false }),
    ]);

    assert.equal(addedRoles, 1);
    assert.equal(logged.filter((entry) => entry.status === 'SUCCESS').length, 1);
    assert.equal(logged.filter((entry) => entry.status === 'SKIPPED').length, 1);
    assert.equal(
      logged.some(
        (entry) =>
          entry.errorCode === 'only_once_execution_in_progress' ||
          entry.errorCode === 'only_once_already_executed'
      ),
      true
    );
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.logRuleEvent = original.logRuleEvent;
    reactionRuleRepository.tryBeginOnlyOnceExecution = original.tryBeginOnlyOnceExecution;
    reactionRuleRepository.markOnlyOnceExecutionSuccess = original.markOnlyOnceExecutionSuccess;
    reactionRuleRepository.releaseOnlyOnceExecution = original.releaseOnlyOnceExecution;
  }
});

test('reaction service releases onlyOnce reservations after failure so a later retry can succeed', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    tryBeginOnlyOnceExecution: reactionRuleRepository.tryBeginOnlyOnceExecution,
    markOnlyOnceExecutionSuccess: reactionRuleRepository.markOnlyOnceExecutionSuccess,
    releaseOnlyOnceExecution: reactionRuleRepository.releaseOnlyOnceExecution,
  };

  const logged = [];
  const executionStates = new Map();
  const { client, guild, channel, message, member } = createBaseGuildFixture();
  let addAttempts = 0;
  const role = { id: 'role-3', position: 1, permissions: { has: () => false } };
  guild.roles.cache.get = () => role;
  guild.roles.fetch = async () => role;
  member.roles = {
    cache: {
      some: () => false,
    },
    add: async () => {
      addAttempts += 1;
      if (addAttempts === 1) throw new Error('first_attempt_failed');
    },
    remove: async () => {},
  };

  reactionRuleRepository.listEnabledRulesByGuild = async () => [
    {
      id: 27,
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      emojiType: 'unicode',
      emojiId: null,
      emojiName: '\u2705',
      triggerMode: 'ADD',
      enabled: true,
      cooldownSeconds: 0,
      onlyOnce: true,
      groupKey: null,
      allowedRoles: [],
      excludedRoles: [],
      actions: [{ type: 'ROLE_ADD', payload: { roleId: role.id } }],
    },
  ];
  reactionRuleRepository.tryBeginOnlyOnceExecution = async ({ ruleId, userId, eventType }) => {
    const key = `${ruleId}:${userId}:${eventType}`;
    const state = executionStates.get(key) || null;
    if (state) return { acquired: false, state };
    executionStates.set(key, 'PENDING');
    return { acquired: true, state: 'PENDING' };
  };
  reactionRuleRepository.markOnlyOnceExecutionSuccess = async ({ ruleId, userId, eventType }) => {
    executionStates.set(`${ruleId}:${userId}:${eventType}`, 'SUCCESS');
  };
  reactionRuleRepository.releaseOnlyOnceExecution = async ({ ruleId, userId, eventType }) => {
    executionStates.delete(`${ruleId}:${userId}:${eventType}`);
  };
  reactionRuleRepository.logRuleEvent = async (entry) => {
    logged.push(entry);
  };

  try {
    const service = createReactionActionService({ client });
    const reaction = {
      emoji: { id: null, name: '\u2705' },
      message: {
        id: message.id,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        reactions: message.reactions,
      },
    };

    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });
    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });

    assert.equal(addAttempts, 2);
    assert.deepEqual(
      logged.map((entry) => entry.status),
      ['ERROR', 'SUCCESS']
    );
    assert.equal(executionStates.get(`27:${member.id}:ADD`), 'SUCCESS');
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.logRuleEvent = original.logRuleEvent;
    reactionRuleRepository.tryBeginOnlyOnceExecution = original.tryBeginOnlyOnceExecution;
    reactionRuleRepository.markOnlyOnceExecutionSuccess = original.markOnlyOnceExecutionSuccess;
    reactionRuleRepository.releaseOnlyOnceExecution = original.releaseOnlyOnceExecution;
  }
});

test('reaction service logs a single ERROR entry when action execution fails', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    hasSuccessfulExecution: reactionRuleRepository.hasSuccessfulExecution,
  };

  const logged = [];
  const { client, guild, channel, message, member } = createBaseGuildFixture();

  reactionRuleRepository.listEnabledRulesByGuild = async () => [
    {
      id: 9,
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      emojiType: 'unicode',
      emojiId: null,
      emojiName: '✅',
      triggerMode: 'ADD',
      enabled: true,
      cooldownSeconds: 0,
      onlyOnce: false,
      groupKey: null,
      allowedRoles: [],
      excludedRoles: [],
      actions: [{ type: 'ROLE_ADD', payload: {} }],
    },
  ];
  reactionRuleRepository.hasSuccessfulExecution = async () => false;
  reactionRuleRepository.logRuleEvent = async (entry) => {
    logged.push(entry);
  };

  try {
    const service = createReactionActionService({ client });
    const reaction = {
      emoji: { id: null, name: '✅' },
      message: {
        id: message.id,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        reactions: message.reactions,
      },
    };

    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });

    assert.deepEqual(
      logged.map((entry) => entry.status),
      ['ERROR']
    );
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.logRuleEvent = original.logRuleEvent;
    reactionRuleRepository.hasSuccessfulExecution = original.hasSuccessfulExecution;
  }
});

test('reaction service health reports channel permission gaps for reply actions', async () => {
  const original = {
    listRulesByGuild: reactionRuleRepository.listRulesByGuild,
  };

  const { client, guild, channel, message } = createBaseGuildFixture();
  channel.permissionsFor = () => ({
    has: (permission) => ['ViewChannel', 'ReadMessageHistory'].includes(permission),
  });

  reactionRuleRepository.listRulesByGuild = async () => [
    {
      id: 11,
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      emojiType: 'unicode',
      emojiId: null,
      emojiName: '✅',
      triggerMode: 'ADD',
      enabled: true,
      cooldownSeconds: 0,
      onlyOnce: false,
      groupKey: null,
      allowedRoles: [],
      excludedRoles: [],
      actions: [{ type: 'REPLY', payload: { text: 'selam' } }],
    },
  ];

  try {
    const service = createReactionActionService({ client });
    const health = await service.getHealth(guild.id);

    assert.equal(health.ok, false);
    assert.equal(health.ruleIssues[0].issues.includes('channel_permissions_missing'), true);
  } finally {
    reactionRuleRepository.listRulesByGuild = original.listRulesByGuild;
  }
});

test('reaction service removes grouped reactions without extra database reloads', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    hasSuccessfulExecution: reactionRuleRepository.hasSuccessfulExecution,
  };

  const { client, guild, channel, member } = createBaseGuildFixture();
  let listCalls = 0;
  const removedUsers = [];

  const otherReaction = {
    emoji: { id: null, name: '❌' },
    users: {
      remove: async (userId) => {
        removedUsers.push(userId);
      },
    },
  };

  const currentReaction = {
    emoji: { id: null, name: '✅' },
    users: {
      remove: async () => {},
    },
  };

  const message = {
    id: 'msg-1',
    reactions: {
      cache: [currentReaction, otherReaction],
      fetch: async () => {},
    },
  };

  reactionRuleRepository.listEnabledRulesByGuild = async () => {
    listCalls += 1;
    return [
      {
        id: 13,
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        emojiType: 'unicode',
        emojiId: null,
        emojiName: '✅',
        triggerMode: 'ADD',
        enabled: true,
        cooldownSeconds: 0,
        onlyOnce: false,
        groupKey: 'grp',
        allowedRoles: [],
        excludedRoles: [],
        actions: [{ type: 'REMOVE_OTHER_REACTIONS_IN_GROUP', payload: {} }],
      },
      {
        id: 14,
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        emojiType: 'unicode',
        emojiId: null,
        emojiName: '❌',
        triggerMode: 'ADD',
        enabled: true,
        cooldownSeconds: 0,
        onlyOnce: false,
        groupKey: 'grp',
        allowedRoles: [],
        excludedRoles: [],
        actions: [],
      },
    ];
  };
  reactionRuleRepository.hasSuccessfulExecution = async () => false;
  reactionRuleRepository.logRuleEvent = async () => {};

  try {
    const service = createReactionActionService({ client });
    const reaction = {
      emoji: { id: null, name: '✅' },
      message: {
        id: message.id,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        reactions: message.reactions,
      },
    };

    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });

    assert.equal(listCalls, 1);
    assert.deepEqual(removedUsers, [member.id]);
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.logRuleEvent = original.logRuleEvent;
    reactionRuleRepository.hasSuccessfulExecution = original.hasSuccessfulExecution;
  }
});

test('reaction service caches unknown reaction misses to avoid repeated guild reloads', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    hasSuccessfulExecution: reactionRuleRepository.hasSuccessfulExecution,
  };

  const { client, guild, channel, message, member } = createBaseGuildFixture();
  let listCalls = 0;

  reactionRuleRepository.listEnabledRulesByGuild = async () => {
    listCalls += 1;
    return [];
  };
  reactionRuleRepository.logRuleEvent = async () => {};
  reactionRuleRepository.hasSuccessfulExecution = async () => false;

  try {
    const service = createReactionActionService({ client });
    const reaction = {
      emoji: { id: null, name: '❓' },
      message: {
        id: message.id,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        reactions: message.reactions,
      },
    };

    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });
    await service.handleReactionEvent('ADD', reaction, { id: member.id, bot: false });
    await service.handleReactionEvent('REMOVE', reaction, { id: member.id, bot: false });

    assert.equal(listCalls, 1);
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.logRuleEvent = original.logRuleEvent;
    reactionRuleRepository.hasSuccessfulExecution = original.hasSuccessfulExecution;
  }
});
