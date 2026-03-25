const test = require('node:test');
const assert = require('node:assert/strict');

function loadUnbanCommand(logActionStub) {
  const commandPath = require.resolve('../src/bot/commands/unban');
  const logsPath = require.resolve('../src/bot/moderation.logs');

  const originalLogsModule = require.cache[logsPath];
  delete require.cache[commandPath];

  require.cache[logsPath] = {
    id: logsPath,
    filename: logsPath,
    loaded: true,
    exports: {
      logAction: logActionStub,
    },
  };

  const command = require(commandPath);
  return {
    run: command.run,
    restore: () => {
      delete require.cache[commandPath];
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

function normalizeFetchTarget(input) {
  if (input && typeof input === 'object') return String(input.user || '').trim();
  return String(input || '').trim();
}

function buildBanRecord(userId, bannedUser) {
  return {
    user: {
      id: String(bannedUser?.id || userId),
      username: String(bannedUser?.username || 'BannedUser'),
    },
  };
}

function createContext({
  target = null,
  targetId = '1447015808344784956',
  cleanArgs = [],
  argsSummary = targetId,
  verifyPermissionResult = null,
  bannedUser = { id: targetId, username: 'BannedUser' },
  banFetchSequence = null,
  bansFetchError = null,
  bansRemoveError = null,
} = {}) {
  const calls = {
    verifyPermission: [],
    bansFetch: [],
    bansRemove: [],
    consumeLimit: [],
    templates: [],
  };

  const normalizedTargetId = String(targetId || '').trim();
  const normalizedBannedUser = bannedUser
    ? {
        id: String(bannedUser.id || normalizedTargetId),
        username: String(bannedUser.username || 'BannedUser'),
      }
    : null;
  const fetchSequence = Array.isArray(banFetchSequence)
    ? [...banFetchSequence]
    : normalizedBannedUser
      ? [normalizedBannedUser, normalizedBannedUser, null]
      : [null];
  const bansCache = new Map();
  let fetchIndex = 0;

  const message = {
    guild: {
      id: 'guild-1',
      bans: {
        cache: bansCache,
        fetch: async (request) => {
          calls.bansFetch.push(request);
          if (bansFetchError) throw bansFetchError;

          const userId = normalizeFetchTarget(request);
          const sequenceIndex = Math.min(fetchIndex, Math.max(fetchSequence.length - 1, 0));
          const next = fetchSequence.length > 0 ? fetchSequence[sequenceIndex] : null;
          fetchIndex += 1;

          if (next instanceof Error) throw next;
          if (!next) {
            bansCache.delete(userId);
            throw createUnknownBanError();
          }

          const ban = buildBanRecord(userId, next);
          bansCache.set(userId, ban);
          return ban;
        },
        remove: async (id, reason) => {
          calls.bansRemove.push({ id, reason });
          if (bansRemoveError) throw bansRemoveError;
          return { id };
        },
      },
    },
    author: { id: 'mod-1' },
    client: {
      user: { id: 'bot-1', username: 'BotUser' },
    },
  };

  const verifyPermission = async (...args) => {
    calls.verifyPermission.push(args);
    if (typeof verifyPermissionResult === 'function') {
      return verifyPermissionResult(...args);
    }
    if (verifyPermissionResult) {
      return verifyPermissionResult;
    }
    return {
      success: true,
      consumeLimit: async () => {
        calls.consumeLimit.push(true);
        return true;
      },
    };
  };

  const sendTemplate = async (templateKey, context = {}, options = {}) => {
    calls.templates.push({ templateKey, context, options });
  };

  return {
    ctx: {
      message,
      target,
      targetId,
      cleanArgs,
      argsSummary,
      targetMention: target?.id ? `@${target.id}` : '@actor',
      sendTemplate,
      verifyPermission,
    },
    calls: {
      ...calls,
      bansCache,
    },
  };
}

test('.unban <banli userId> basarili calisir', async () => {
  const logCalls = [];
  const command = loadUnbanCommand(async (...args) => {
    logCalls.push(args);
    return 9001;
  });

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      cleanArgs: [],
      argsSummary: '1447015808344784956',
      bannedUser: { id: '1447015808344784956', username: 'SomeUser' },
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 1);
    assert.deepEqual(calls.verifyPermission[0], [
      'ban',
      null,
      { targetId: '1447015808344784956', execution: { requiredBotPermissions: ['BanMembers'] } },
    ]);
    assert.deepEqual(calls.bansFetch, [
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
    ]);
    assert.deepEqual(calls.bansRemove, [{ id: '1447015808344784956', reason: 'af' }]);
    assert.equal(calls.consumeLimit.length, 1);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(calls.templates[0].context.target, '<@1447015808344784956>');
    assert.equal(calls.templates[0].context.reason, 'af');
    assert.equal(logCalls.length, 1);
    assert.deepEqual(logCalls[0], [
      'guild-1',
      '1447015808344784956',
      'mod-1',
      'unban',
      'af',
      'Yok',
    ]);
  } finally {
    command.restore();
  }
});

test('.unban <banli olmayan userId> notApplied doner', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      bannedUser: null,
    });

    await command.run(ctx);

    assert.deepEqual(calls.bansFetch, [
      { user: '1447015808344784956', force: true, cache: false },
    ]);
    assert.equal(calls.bansRemove.length, 0);
    assert.equal(calls.consumeLimit.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'notApplied');
    assert.equal(calls.templates[0].context.target, '<@1447015808344784956>');
  } finally {
    command.restore();
  }
});

test('unban success mesaji sadece authoritative verify ile gonderilir', async () => {
  const logCalls = [];
  const command = loadUnbanCommand(async (...args) => {
    logCalls.push(args);
    return 42;
  });

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      bannedUser: { id: '1447015808344784956', username: 'SomeUser' },
      banFetchSequence: [
        { id: '1447015808344784956', username: 'SomeUser' },
        { id: '1447015808344784956', username: 'SomeUser' },
        { id: '1447015808344784956', username: 'SomeUser' },
      ],
    });

    await command.run(ctx);

    assert.deepEqual(calls.bansRemove, [{ id: '1447015808344784956', reason: 'af' }]);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'systemError');
    assert.equal(logCalls.length, 0);
  } finally {
    command.restore();
  }
});

test('unban authoritative verify retries through an initial still-banned false-negative', async () => {
  const logCalls = [];
  const command = loadUnbanCommand(async (...args) => {
    logCalls.push(args);
    return 43;
  });

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      bannedUser: { id: '1447015808344784956', username: 'SomeUser' },
      banFetchSequence: [
        { id: '1447015808344784956', username: 'SomeUser' },
        { id: '1447015808344784956', username: 'SomeUser' },
        { id: '1447015808344784956', username: 'SomeUser' },
        null,
      ],
    });

    await command.run(ctx);

    assert.deepEqual(calls.bansRemove, [{ id: '1447015808344784956', reason: 'af' }]);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(logCalls.length, 1);
    assert.deepEqual(calls.bansFetch, [
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
    ]);
  } finally {
    command.restore();
  }
});

test('unban remove sonrasi verify fail etse bile stale ban cache birakmaz', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const verifyError = new Error('rest_down_after_remove');
    verifyError.code = 'ECONNRESET';
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      bannedUser: { id: '1447015808344784956', username: 'SomeUser' },
      banFetchSequence: [
        { id: '1447015808344784956', username: 'SomeUser' },
        { id: '1447015808344784956', username: 'SomeUser' },
        verifyError,
      ],
    });

    await command.run(ctx);

    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(calls.bansCache.has('1447015808344784956'), false);
  } finally {
    command.restore();
  }
});

test('unban authoritative fetch hatasini notApplied diye yutmaz', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const fetchError = new Error('rest_down');
    fetchError.code = 'ECONNRESET';
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      bansFetchError: fetchError,
    });

    await command.run(ctx);

    assert.equal(calls.bansRemove.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'systemError');
  } finally {
    command.restore();
  }
});

test('.unban <gecersiz ID> userNotFound doner', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '123',
      argsSummary: '123',
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 0);
    assert.equal(calls.bansFetch.length, 0);
    assert.equal(calls.bansRemove.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'userNotFound');
  } finally {
    command.restore();
  }
});

test('.unban <metin> userNotFound doner', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: null,
      argsSummary: 'abc',
      cleanArgs: [],
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 0);
    assert.equal(calls.bansFetch.length, 0);
    assert.equal(calls.bansRemove.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'userNotFound');
  } finally {
    command.restore();
  }
});

test('.unban (arg yok) invalidUsage doner', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: null,
      argsSummary: '',
      bannedUser: null,
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'invalidUsage');
  } finally {
    command.restore();
  }
});

test('yetkisiz kullanici durumda komut isleme devam etmez', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      verifyPermissionResult: { success: false, reasonCode: 'missing_command_permission' },
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 1);
    assert.equal(calls.bansFetch.length, 0);
    assert.equal(calls.bansRemove.length, 0);
    assert.equal(calls.templates.length, 0);
  } finally {
    command.restore();
  }
});

test('botta BanMembers izni yoksa komut isleme devam etmez', async () => {
  const command = loadUnbanCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      target: null,
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      verifyPermissionResult: { success: false, reasonCode: 'bot_missing_discord_permission' },
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 1);
    assert.deepEqual(calls.verifyPermission[0], [
      'ban',
      null,
      { targetId: '1447015808344784956', execution: { requiredBotPermissions: ['BanMembers'] } },
    ]);
    assert.equal(calls.bansFetch.length, 0);
    assert.equal(calls.bansRemove.length, 0);
    assert.equal(calls.templates.length, 0);
  } finally {
    command.restore();
  }
});
