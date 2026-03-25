const test = require('node:test');
const assert = require('node:assert/strict');

const COMMAND_FILES = [
  'log',
  'warn',
  'mute',
  'unmute',
  'kick',
  'jail',
  'unjail',
  'ban',
  'unban',
  'vcmute',
  'vcunmute',
  'yardim',
  'embed',
  'lock',
  'unlock',
  'durum',
];

function loadModerationForResponseTest({
  logActionStub = async () => 191,
} = {}) {
  const moderationPath = require.resolve('../src/bot/moderation');
  const cachePath = require.resolve('../src/utils/cache');
  const permissionServicePath = require.resolve('../src/bot/services/permissionService');
  const loggerPath = require.resolve('../src/logger');
  const perfMonitorPath = require.resolve('../src/utils/perfMonitor');
  const logsPath = require.resolve('../src/bot/moderation.logs');
  const schedulerPath = require.resolve('../src/bot/penaltyScheduler');
  const originals = new Map();

  const remember = (path) => {
    if (!originals.has(path)) originals.set(path, require.cache[path]);
  };

  const setModule = (path, exportsValue) => {
    remember(path);
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: exportsValue,
    };
  };

  remember(moderationPath);
  delete require.cache[moderationPath];

  setModule(cachePath, {
    getSettings: () => ({
      prefix: '.',
    }),
  });
  setModule(permissionServicePath, {
    createPermissionService: () => ({
      maybePruneModerationCaches: () => {},
      verifyPermission: async ({ cmdType }) => ({
        success: true,
        context: cmdType === 'mute' || cmdType === 'unmute'
          ? {
            botMember: {
              permissions: {
                has: () => true,
              },
            },
          }
          : {},
        consumeLimit: async () => ({
          commit: async () => {},
          rollback: async () => {},
        }),
      }),
    }),
  });
  setModule(loggerPath, {
    logSystem: () => {},
    logError: () => {},
  });
  setModule(perfMonitorPath, {
    incCounter: () => {},
  });
  setModule(logsPath, {
    logAction: logActionStub,
  });
  setModule(schedulerPath, {
    schedulePenalty: async () => {},
  });

  for (const commandName of COMMAND_FILES) {
    const commandPath = require.resolve(`../src/bot/commands/${commandName}`);
    remember(commandPath);
    delete require.cache[commandPath];
    if (commandName === 'warn' || commandName === 'mute' || commandName === 'unmute') continue;
    setModule(commandPath, {
      run: async () => {},
    });
  }

  const moderation = require(moderationPath);
  const restore = () => {
    delete require.cache[moderationPath];
    for (const [path, original] of originals.entries()) {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
  };

  return { moderation, restore };
}

function createPrefixMessage({
  content,
  targetId = '123456789012345678',
  username = 'opsecspotted',
  activeTimeoutUntil = null,
} = {}) {
  const replies = [];
  const target = {
    id: targetId,
    user: {
      id: targetId,
      username,
      displayAvatarURL: () => 'https://cdn.example.com/target.png',
    },
    permissions: {
      has: () => false,
    },
    moderatable: true,
    communicationDisabledUntilTimestamp: activeTimeoutUntil,
    timeout: async (duration) => {
      target.communicationDisabledUntilTimestamp = duration === null ? null : Date.now() + Number(duration);
      return target;
    },
    voice: {
      channelId: null,
      channel: null,
      disconnect: async () => {
        target.voice.channelId = null;
        target.voice.channel = null;
      },
    },
    roles: {
      cache: {
        has: () => false,
      },
    },
  };

  const message = {
    content,
    author: {
      id: 'mod-1',
      bot: false,
      username: 'mod-user',
      displayAvatarURL: () => null,
    },
    member: {
      id: 'mod-1',
      displayName: 'mod-display',
      displayAvatarURL: () => null,
    },
    guild: {
      id: 'guild-1',
      name: 'Guild One',
      members: {
        fetch: async (id) => (String(id) === String(targetId) ? target : null),
      },
    },
    mentions: {
      repliedUser: null,
    },
    reference: null,
    channel: {
      id: 'channel-1',
      toString: () => '#general',
      send: async (payload) => {
        replies.push(payload);
        return payload;
      },
    },
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
    client: {
      user: {
        id: 'bot-1',
        username: 'bot-user',
        displayAvatarURL: () => null,
      },
      users: {
        fetch: async (id) => ({
          id,
          displayAvatarURL: () => 'https://cdn.example.com/fetched-target.png',
        }),
      },
    },
  };

  return { message, replies };
}

function getRenderedEmbedText(payload) {
  const embedJson = payload?.embeds?.[0]?.toJSON?.() || {};
  return {
    embedJson,
    text: `${embedJson.author?.name || ''}\n${embedJson.description || ''}`.trim(),
  };
}

test('prefix warn success response shows caseId and keeps empty-reason formatting valid', async () => {
  const { moderation, restore } = loadModerationForResponseTest({
    logActionStub: async () => 191,
  });

  try {
    const targetId = '123456789012345678';
    const { message, replies } = createPrefixMessage({
      content: `.warn <@${targetId}>`,
      targetId,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    const { text } = getRenderedEmbedText(replies[0]);
    assert.match(text, /sebep: Yok/i);
    assert.match(text, /\(#191\)/);
    assert.doesNotMatch(text, /\(\)/);
  } finally {
    restore();
  }
});

test('prefix mute success response shows caseId and preserves timed reason formatting', async () => {
  const { moderation, restore } = loadModerationForResponseTest({
    logActionStub: async () => 191,
  });

  try {
    const targetId = '123456789012345678';
    const { message, replies } = createPrefixMessage({
      content: `.mute <@${targetId}> 10m kufur`,
      targetId,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    const { text } = getRenderedEmbedText(replies[0]);
    assert.match(text, /süre: 10m, sebep: kufur/i);
    assert.match(text, /\(#191\)/);
    assert.doesNotMatch(text, /\(\)/);
  } finally {
    restore();
  }
});

test('prefix mute success response keeps fallback reason formatting valid when reason is omitted', async () => {
  const { moderation, restore } = loadModerationForResponseTest({
    logActionStub: async () => 191,
  });

  try {
    const targetId = '123456789012345678';
    const { message, replies } = createPrefixMessage({
      content: `.mute <@${targetId}> 10m`,
      targetId,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    const { text } = getRenderedEmbedText(replies[0]);
    assert.match(text, /süre: 10m, sebep: Yok/i);
    assert.match(text, /\(#191\)/);
    assert.doesNotMatch(text, /\(\)/);
  } finally {
    restore();
  }
});

test('prefix mute defaults to 28d when duration is omitted and keeps reason formatting valid', async () => {
  const { moderation, restore } = loadModerationForResponseTest({
    logActionStub: async () => 191,
  });

  try {
    const targetId = '123456789012345678';
    const { message, replies } = createPrefixMessage({
      content: `.mute <@${targetId}> kufur`,
      targetId,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    const { text } = getRenderedEmbedText(replies[0]);
    assert.match(text, /süre: 28d, sebep: kufur/i);
    assert.match(text, /\(#191\)/);
    assert.doesNotMatch(text, /\(\)/);
  } finally {
    restore();
  }
});

test('prefix mute keeps success response when case log creation fails and omits empty caseId', async () => {
  const { moderation, restore } = loadModerationForResponseTest({
    logActionStub: async () => {
      throw new Error('log_down');
    },
  });

  try {
    const targetId = '123456789012345678';
    const { message, replies } = createPrefixMessage({
      content: `.mute <@${targetId}> 10m kufur`,
      targetId,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    const successReply = replies.find((payload) => Array.isArray(payload.embeds) && payload.embeds.length > 0);
    const warningReply = replies.find((payload) => String(payload?.content || '').match(/log kaydi/i));

    assert.ok(successReply);
    const { text } = getRenderedEmbedText(successReply);
    assert.match(text, /süre: 10m, sebep: kufur/i);
    assert.doesNotMatch(text, /\(#/);
    assert.doesNotMatch(text, /\(\)/);
    assert.ok(warningReply);
  } finally {
    restore();
  }
});

test('prefix unmute success response shows caseId and preserves reason formatting', async () => {
  const { moderation, restore } = loadModerationForResponseTest({
    logActionStub: async () => 191,
  });

  try {
    const targetId = '123456789012345678';
    const { message, replies } = createPrefixMessage({
      content: `.unmute <@${targetId}> af`,
      targetId,
      activeTimeoutUntil: Date.now() + 60_000,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    const { text } = getRenderedEmbedText(replies[0]);
    assert.match(text, /sebep: af/i);
    assert.match(text, /\(#191\)/);
    assert.doesNotMatch(text, /\(\)/);
  } finally {
    restore();
  }
});
