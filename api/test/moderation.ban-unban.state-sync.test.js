const test = require('node:test');
const assert = require('node:assert/strict');

function loadBanAndUnbanCommands(logActionStub = async () => 1) {
  const banPath = require.resolve('../src/bot/commands/ban');
  const unbanPath = require.resolve('../src/bot/commands/unban');
  const logsPath = require.resolve('../src/bot/moderation.logs');

  const originalLogsModule = require.cache[logsPath];
  delete require.cache[banPath];
  delete require.cache[unbanPath];

  require.cache[logsPath] = {
    id: logsPath,
    filename: logsPath,
    loaded: true,
    exports: {
      logAction: logActionStub,
    },
  };

  const banCommand = require(banPath);
  const unbanCommand = require(unbanPath);

  return {
    banRun: banCommand.run,
    unbanRun: unbanCommand.run,
    restore: () => {
      delete require.cache[banPath];
      delete require.cache[unbanPath];
      if (originalLogsModule) require.cache[logsPath] = originalLogsModule;
      else delete require.cache[logsPath];
    },
  };
}

function createUnknownBanError() {
  const err = new Error('unknown_ban');
  err.code = 10026;
  return err;
}

function createDiscordLikeGuild(targetId, { initialBanPresent = true, banDelayMs = 0 } = {}) {
  let authoritativeBanPresent = initialBanPresent;
  const calls = {
    bansFetch: [],
    bansRemove: [],
    membersBan: [],
  };
  const cache = new Map();

  const guild = {
    id: 'guild-1',
    bans: {
      cache,
      fetch: async (request) => {
        calls.bansFetch.push(request);
        const isAuthoritativeFetch = request && typeof request === 'object';
        const userId = isAuthoritativeFetch ? String(request.user || '').trim() : String(request || '').trim();

        if (isAuthoritativeFetch) {
          if (!authoritativeBanPresent) throw createUnknownBanError();
          return {
            user: {
              id: userId,
              username: 'opsecspotted',
            },
          };
        }

        const cachedBan = cache.get(userId);
        if (cachedBan) return cachedBan;
        if (!authoritativeBanPresent) throw createUnknownBanError();

        const ban = {
          user: {
            id: userId,
            username: 'opsecspotted',
          },
        };
        cache.set(userId, ban);
        return ban;
      },
      remove: async (id, reason) => {
        calls.bansRemove.push({ id, reason });
        authoritativeBanPresent = false;
        return { id };
      },
    },
    members: {
      fetch: async (id) => ({
        id,
        bannable: true,
        user: {
          id,
          username: 'opsecspotted',
        },
        roles: {
          cache: new Map(),
        },
      }),
      ban: async (id, payload) => {
        calls.membersBan.push({ id, payload });
        if (banDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, banDelayMs));
        }
        authoritativeBanPresent = true;
        return { id };
      },
    },
  };

  return {
    guild,
    calls,
    isBanPresent: () => authoritativeBanPresent,
  };
}

function createMessage(guild, authorId = 'mod-1') {
  return {
    guild,
    author: { id: authorId },
    client: { user: { id: 'bot-1', username: 'BotUser' } },
  };
}

function createPermissionResult() {
  return {
    success: true,
    consumeLimit: async () => true,
  };
}

test('unban stale ban cache driftini temizler ve ayni ID tekrar banlanabilir', async () => {
  const targetId = '1447015808344784956';
  const commandSet = loadBanAndUnbanCommands();

  try {
    const env = createDiscordLikeGuild(targetId, { initialBanPresent: true });
    const message = createMessage(env.guild);
    const unbanTemplates = [];

    await commandSet.unbanRun({
      message,
      target: null,
      targetId,
      cleanArgs: [],
      argsSummary: targetId,
      targetMention: '@actor',
      sendTemplate: async (templateKey, context = {}, options = {}) => {
        unbanTemplates.push({ templateKey, context, options });
      },
      verifyPermission: async () => createPermissionResult(),
    });

    assert.equal(unbanTemplates.length, 1);
    assert.equal(unbanTemplates[0].templateKey, 'success');
    assert.equal(env.isBanPresent(), false);
    assert.equal(env.guild.bans.cache.has(targetId), false);

    const banTemplates = [];
    await commandSet.banRun({
      message,
      target: null,
      targetId,
      cleanArgs: [],
      argsSummary: targetId,
      targetMention: `<@${targetId}>`,
      sendTemplate: async (templateKey, context = {}, options = {}) => {
        banTemplates.push({ templateKey, context, options });
      },
      verifyPermission: async () => createPermissionResult(),
    });

    assert.equal(banTemplates.length, 1);
    assert.equal(banTemplates[0].templateKey, 'success');
    assert.equal(env.calls.membersBan.length, 1);
    assert.equal(env.isBanPresent(), true);
  } finally {
    commandSet.restore();
  }
});

test('concurrent ayni hedef ban islemleri serialize edilir ve double-log uretmez', async () => {
  const targetId = '1447015808344784956';
  const logCalls = [];
  const commandSet = loadBanAndUnbanCommands(async (...args) => {
    logCalls.push(args);
    return logCalls.length;
  });

  try {
    const env = createDiscordLikeGuild(targetId, {
      initialBanPresent: false,
      banDelayMs: 20,
    });
    const templatesA = [];
    const templatesB = [];

    await Promise.all([
      commandSet.banRun({
        message: createMessage(env.guild, 'mod-1'),
        target: null,
        targetId,
        cleanArgs: [],
        argsSummary: targetId,
        targetMention: `<@${targetId}>`,
        sendTemplate: async (templateKey, context = {}, options = {}) => {
          templatesA.push({ templateKey, context, options });
        },
        verifyPermission: async () => createPermissionResult(),
      }),
      commandSet.banRun({
        message: createMessage(env.guild, 'mod-2'),
        target: null,
        targetId,
        cleanArgs: [],
        argsSummary: targetId,
        targetMention: `<@${targetId}>`,
        sendTemplate: async (templateKey, context = {}, options = {}) => {
          templatesB.push({ templateKey, context, options });
        },
        verifyPermission: async () => createPermissionResult(),
      }),
    ]);

    assert.equal(env.calls.membersBan.length, 1);
    assert.equal(logCalls.length, 1);
    const templateKeys = [templatesA[0]?.templateKey, templatesB[0]?.templateKey].sort();
    assert.deepEqual(templateKeys, ['alreadyApplied', 'success']);
  } finally {
    commandSet.restore();
  }
});
