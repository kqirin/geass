const test = require('node:test');
const assert = require('node:assert/strict');

function loadCommandWithMocks(commandName, { logActionStub = async () => 1, penaltySchedulerStub = null } = {}) {
  const commandPath = require.resolve(`../src/bot/commands/${commandName}`);
  const logsPath = require.resolve('../src/bot/moderation.logs');
  const schedulerPath = require.resolve('../src/bot/penaltyScheduler');

  const originalLogsModule = require.cache[logsPath];
  const originalSchedulerModule = require.cache[schedulerPath];
  delete require.cache[commandPath];

  require.cache[logsPath] = {
    id: logsPath,
    filename: logsPath,
    loaded: true,
    exports: {
      logAction: logActionStub,
    },
  };

  if (penaltySchedulerStub) {
    require.cache[schedulerPath] = {
      id: schedulerPath,
      filename: schedulerPath,
      loaded: true,
      exports: penaltySchedulerStub,
    };
  }

  const command = require(commandPath);
  return {
    run: command.run,
    restore: () => {
      delete require.cache[commandPath];
      if (originalLogsModule) require.cache[logsPath] = originalLogsModule;
      else delete require.cache[logsPath];
      if (penaltySchedulerStub) {
        if (originalSchedulerModule) require.cache[schedulerPath] = originalSchedulerModule;
        else delete require.cache[schedulerPath];
      }
    },
  };
}

function createBaseContext() {
  const calls = {
    templates: [],
    warningReplies: [],
  };
  let banned = true;

  const message = {
    guild: {
      id: 'guild-1',
      bans: {
        cache: new Map(),
        fetch: async () => {
          if (!banned) {
            const err = new Error('unknown_ban');
            err.code = 10026;
            throw err;
          }
          return {
            user: { id: '1447015808344784956', username: 'BannedUser' },
          };
        },
        remove: async () => {
          banned = false;
          return { id: '1447015808344784956' };
        },
      },
      members: {
        unban: async () => ({ id: '1447015808344784956' }),
      },
    },
    author: { id: 'mod-1' },
    client: { user: { id: 'bot-1', username: 'BotUser' } },
    reply: async (payload) => {
      calls.warningReplies.push(payload);
      return payload;
    },
    channel: {
      send: async (payload) => {
        calls.warningReplies.push(payload);
        return payload;
      },
    },
  };

  const sendTemplate = async (templateKey, context = {}, options = {}) => {
    calls.templates.push({ templateKey, context, options });
  };

  return {
    calls,
    message,
    sendTemplate,
  };
}

test('mute does not emit success when voice disconnect fails after timeout apply', async () => {
  const command = loadCommandWithMocks('mute', {
    logActionStub: async () => 42,
  });

  try {
    const { calls, message, sendTemplate } = createBaseContext();
    const target = {
      id: '123456789012345678',
      user: { id: '123456789012345678', username: 'TargetUser' },
      permissions: {
        has: () => false,
      },
      moderatable: true,
      communicationDisabledUntilTimestamp: null,
      timeout: async (duration) => {
        target.communicationDisabledUntilTimestamp = duration === null ? null : Date.now() + Number(duration);
      },
      voice: {
        channelId: 'voice-1',
        disconnect: async () => {
          throw new Error('disconnect_failed');
        },
      },
      roles: {
        cache: {
          has: () => false,
        },
      },
    };
    message.guild.members = {
      fetch: async () => target,
    };

    await command.run({
      message,
      target,
      cleanArgs: ['10m', 'test'],
      targetMention: '@Target',
      sendTemplate,
      verifyPermission: async () => ({
        success: true,
        context: {
          botMember: {
            permissions: {
              has: (perm) => perm === 'ModerateMembers' || perm === 'MoveMembers',
            },
          },
        },
        consumeLimit: async () => ({
          commit: async () => {},
          rollback: async () => {},
        }),
      }),
      settings: {},
    });

    assert.equal(calls.warningReplies.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'voiceDisconnectFailed');
  } finally {
    command.restore();
  }
});

test('unban keeps success semantics when log write fails after Discord action', async () => {
  const command = loadCommandWithMocks('unban', {
    logActionStub: async () => {
      throw new Error('log_down');
    },
  });

  try {
    const { calls, message, sendTemplate } = createBaseContext();

    await command.run({
      message,
      target: null,
      targetId: '1447015808344784956',
      cleanArgs: [],
      argsSummary: '1447015808344784956',
      targetMention: '@actor',
      sendTemplate,
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => true,
      }),
    });

    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.match(String(calls.warningReplies[0]?.content || ''), /log kaydi/i);
  } finally {
    command.restore();
  }
});

test('warn stops before primary action when final consumeLimit denies', async () => {
  const command = loadCommandWithMocks('warn', {
    logActionStub: async () => 77,
  });

  try {
    const { calls, message, sendTemplate } = createBaseContext();
    const target = {
      id: '123456789012345678',
      user: { id: '123456789012345678', username: 'TargetUser' },
    };

    await command.run({
      message,
      target,
      cleanArgs: ['neden'],
      targetMention: '@Target',
      sendTemplate,
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => false,
      }),
    });

    assert.equal(calls.templates.length, 0);
    assert.equal(calls.warningReplies.length, 0);
  } finally {
    command.restore();
  }
});
