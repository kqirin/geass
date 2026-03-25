const test = require('node:test');
const assert = require('node:assert/strict');

function loadKickCommand(logActionStub) {
  const commandPath = require.resolve('../src/bot/commands/kick');
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

const MISSING = Symbol('missing');

function createContext({
  target = MISSING,
  cleanArgs = [],
  targetMention = '@Target',
  verifyPermissionResult = null,
  kickError = null,
} = {}) {
  const calls = {
    verifyPermission: [],
    kick: [],
    consumeLimit: [],
    templates: [],
  };

  const defaultTarget = {
    id: '123456789012345678',
    user: { id: '123456789012345678', username: 'TargetUser' },
    kick: async (reason) => {
      calls.kick.push({ reason });
      if (kickError) throw kickError;
    },
  };

  const message = {
    guild: { id: 'guild-1' },
    author: { id: 'mod-1' },
    client: { user: { id: 'bot-1', username: 'BotUser' } },
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

  const resolvedTarget = target === MISSING ? defaultTarget : target;

  return {
    ctx: {
      message,
      target: resolvedTarget,
      cleanArgs,
      targetMention,
      sendTemplate,
      verifyPermission,
    },
    calls,
  };
}

test('.kick basarili calisir', async () => {
  const logCalls = [];
  const command = loadKickCommand(async (...args) => {
    logCalls.push(args);
    return 42;
  });

  try {
    const { ctx, calls } = createContext({
      cleanArgs: ['test', 'reason'],
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 1);
    assert.deepEqual(calls.verifyPermission[0], [
      'kick',
      ctx.target,
      { execution: { requireTargetMember: true, requireTargetKickable: true } },
    ]);
    assert.equal(calls.kick.length, 1);
    assert.equal(calls.kick[0].reason, 'test reason');
    assert.equal(calls.consumeLimit.length, 1);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(logCalls.length, 1);
  } finally {
    command.restore();
  }
});

test('.kick verifyPermission contextindeki authoritative targetMember kullanilir', async () => {
  const command = loadKickCommand(async () => 12);

  try {
    const authoritativeKickCalls = [];
    const authoritativeTarget = {
      id: '123456789012345679',
      user: { id: '123456789012345679', username: 'AuthoritativeTarget' },
      kick: async (reason) => {
        authoritativeKickCalls.push(reason);
      },
    };

    const { ctx, calls } = createContext({
      cleanArgs: ['test'],
      verifyPermissionResult: {
        success: true,
        context: {
          targetMember: authoritativeTarget,
        },
        consumeLimit: async () => {
          calls.consumeLimit.push(true);
          return true;
        },
      },
    });

    await command.run(ctx);

    assert.equal(calls.kick.length, 0);
    assert.deepEqual(authoritativeKickCalls, ['test']);
    assert.equal(calls.templates[0].templateKey, 'success');
  } finally {
    command.restore();
  }
});

test('.kick target yoksa invalidUsage doner', async () => {
  const command = loadKickCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({ target: null });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'invalidUsage');
  } finally {
    command.restore();
  }
});

test('.kick yetkisiz kullanicida komut isleme durur', async () => {
  const command = loadKickCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({
      verifyPermissionResult: { success: false, reasonCode: 'missing_command_permission' },
    });

    await command.run(ctx);

    assert.equal(calls.verifyPermission.length, 1);
    assert.equal(calls.kick.length, 0);
    assert.equal(calls.templates.length, 0);
  } finally {
    command.restore();
  }
});

test('.kick Discord 50013 hatasinda operationNotAllowed doner', async () => {
  const command = loadKickCommand(async () => 1);

  try {
    const err50013 = new Error('Missing Permissions');
    err50013.code = 50013;

    const { ctx, calls } = createContext({ kickError: err50013 });

    await command.run(ctx);

    assert.equal(calls.kick.length, 1);
    assert.equal(calls.consumeLimit.length, 1);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'operationNotAllowed');
  } finally {
    command.restore();
  }
});

test('.kick Discord rawError.code 50013 oldugunda operationNotAllowed doner', async () => {
  const command = loadKickCommand(async () => 1);

  try {
    const errRaw = new Error('Missing Permissions (rawError)');
    errRaw.rawError = { code: 50013 };

    const { ctx, calls } = createContext({ kickError: errRaw });

    await command.run(ctx);

    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'operationNotAllowed');
  } finally {
    command.restore();
  }
});

test('.kick diger Discord hatasinda systemError doner', async () => {
  const command = loadKickCommand(async () => 1);

  try {
    const errOther = new Error('Unknown server error');
    errOther.code = 500;

    const { ctx, calls } = createContext({ kickError: errOther });

    await command.run(ctx);

    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'systemError');
  } finally {
    command.restore();
  }
});

test('.kick hata yokken yalanci systemError donmez', async () => {
  const command = loadKickCommand(async () => 1);

  try {
    const { ctx, calls } = createContext({ cleanArgs: [] });

    await command.run(ctx);

    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(calls.kick.length, 1);
  } finally {
    command.restore();
  }
});
