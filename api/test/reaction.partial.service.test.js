const test = require('node:test');
const assert = require('node:assert/strict');

const reactionRuleRepository = require('../src/infrastructure/repositories/reactionRuleRepository');
const { createReactionActionService } = require('../src/application/reactionActions/service');

test('reaction service should process partial message using guildId/channelId fallback', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    logRuleEvent: reactionRuleRepository.logRuleEvent,
    tryBeginOnlyOnceExecution: reactionRuleRepository.tryBeginOnlyOnceExecution,
    markOnlyOnceExecutionSuccess: reactionRuleRepository.markOnlyOnceExecutionSuccess,
    releaseOnlyOnceExecution: reactionRuleRepository.releaseOnlyOnceExecution,
    hasSuccessfulExecution: reactionRuleRepository.hasSuccessfulExecution,
  };

  const loggedEvents = [];
  const serviceErrors = [];

  reactionRuleRepository.listEnabledRulesByGuild = async () => [
    {
      id: 1,
      guildId: '1',
      channelId: '1000',
      messageId: '555',
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
      actions: [],
    },
  ];
  reactionRuleRepository.logRuleEvent = async (entry) => {
    loggedEvents.push(entry);
  };
  reactionRuleRepository.tryBeginOnlyOnceExecution = async () => ({ acquired: true, state: 'PENDING' });
  reactionRuleRepository.markOnlyOnceExecutionSuccess = async () => {};
  reactionRuleRepository.releaseOnlyOnceExecution = async () => {};
  reactionRuleRepository.hasSuccessfulExecution = async () => false;

  try {
    let seededReactCount = 0;
    const seededMessage = {
      id: '555',
      react: async () => {
        seededReactCount += 1;
      },
      reactions: { cache: new Map() },
    };

    const channel = {
      id: '1000',
      isTextBased: () => true,
      send: async () => {},
      messages: {
        fetch: async () => seededMessage,
      },
    };

    const member = {
      id: '200',
      user: { bot: false },
      manageable: true,
      roles: { cache: { some: () => false }, highest: { position: 10 } },
      send: async () => {},
    };

    const guild = {
      id: '1',
      channels: {
        cache: { get: (id) => (id === '1000' ? channel : null) },
        fetch: async (id) => (id === '1000' ? channel : null),
      },
      members: {
        cache: { get: (id) => (id === '200' ? member : null) },
        fetch: async (id) => (id === '200' ? member : null),
      },
      roles: {
        cache: { get: () => null },
        fetch: async () => null,
      },
    };

    const client = {
      guilds: {
        cache: new Map([['1', guild]]),
        fetch: async (id) => (id === '1' ? guild : null),
      },
    };

    const service = createReactionActionService({
      client,
      logError: (context) => serviceErrors.push(context),
    });

    const reaction = {
      partial: true,
      fetch: async () => reaction,
      emoji: { id: null, name: '✅' },
      message: {
        partial: true,
        id: '555',
        guild: null,
        guildId: '1',
        channel: null,
        channelId: '1000',
        fetch: async () => {
          reaction.message.partial = false;
          reaction.message.guild = guild;
          reaction.message.channel = channel;
          return reaction.message;
        },
      },
    };

    const user = { id: '200', bot: false };
    await service.handleReactionEvent('ADD', reaction, user);

    assert.equal(serviceErrors.length, 0);
    assert.equal(seededReactCount, 0, 'cache miss refresh should not seed reactions aggressively');
    assert.equal(
      loggedEvents.some(
        (entry) => entry.status === 'SUCCESS' && Number(entry.ruleId) === 1 && entry.userId === '200'
      ),
      true
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

test('reaction service refreshAllRules rebuilds cache without startup seeding', async () => {
  const original = {
    listEnabledRulesByGuild: reactionRuleRepository.listEnabledRulesByGuild,
    tryBeginOnlyOnceExecution: reactionRuleRepository.tryBeginOnlyOnceExecution,
    markOnlyOnceExecutionSuccess: reactionRuleRepository.markOnlyOnceExecutionSuccess,
    releaseOnlyOnceExecution: reactionRuleRepository.releaseOnlyOnceExecution,
  };

  reactionRuleRepository.listEnabledRulesByGuild = async () => [
    {
      id: 11,
      guildId: '1',
      channelId: '1000',
      messageId: '555',
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
      actions: [],
    },
  ];
  reactionRuleRepository.tryBeginOnlyOnceExecution = async () => ({ acquired: true, state: 'PENDING' });
  reactionRuleRepository.markOnlyOnceExecutionSuccess = async () => {};
  reactionRuleRepository.releaseOnlyOnceExecution = async () => {};

  try {
    let seededReactCount = 0;
    const seededMessage = {
      id: '555',
      react: async () => {
        seededReactCount += 1;
      },
      reactions: { cache: new Map() },
    };

    const channel = {
      id: '1000',
      isTextBased: () => true,
      messages: {
        fetch: async () => seededMessage,
      },
    };

    const guild = {
      id: '1',
      channels: {
        cache: { get: (id) => (id === '1000' ? channel : null) },
        fetch: async (id) => (id === '1000' ? channel : null),
      },
    };

    const client = {
      guilds: {
        cache: new Map([['1', guild]]),
        fetch: async (id) => (id === '1' ? guild : null),
      },
    };

    const service = createReactionActionService({ client });
    await service.refreshAllRules();

    assert.equal(seededReactCount, 0);
  } finally {
    reactionRuleRepository.listEnabledRulesByGuild = original.listEnabledRulesByGuild;
    reactionRuleRepository.tryBeginOnlyOnceExecution = original.tryBeginOnlyOnceExecution;
    reactionRuleRepository.markOnlyOnceExecutionSuccess = original.markOnlyOnceExecutionSuccess;
    reactionRuleRepository.releaseOnlyOnceExecution = original.releaseOnlyOnceExecution;
  }
});
