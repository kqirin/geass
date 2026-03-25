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

function loadModerationWithStubs(commandOverrides = {}) {
  const moderationPath = require.resolve('../src/bot/moderation');
  const cachePath = require.resolve('../src/utils/cache');
  const permissionServicePath = require.resolve('../src/bot/services/permissionService');
  const templateServicePath = require.resolve('../src/application/messages/templateService');
  const loggerPath = require.resolve('../src/logger');
  const perfMonitorPath = require.resolve('../src/utils/perfMonitor');

  const originals = new Map();
  const setModule = (path, exportsValue) => {
    originals.set(path, require.cache[path]);
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: exportsValue,
    };
  };

  delete require.cache[moderationPath];

  setModule(cachePath, {
    getSettings: () => ({ prefix: '.' }),
  });
  setModule(permissionServicePath, {
    createPermissionService: () => ({
      maybePruneModerationCaches: () => { },
      verifyPermission: async () => ({ success: true, key: 'perm-key' }),
    }),
  });
  setModule(templateServicePath, {
    createTemplateSender: () => ({
      sendTemplate: async () => { },
    }),
  });
  setModule(loggerPath, {
    logSystem: () => { },
  });
  setModule(perfMonitorPath, {
    incCounter: () => { },
  });

  for (const commandName of COMMAND_FILES) {
    const commandPath = require.resolve(`../src/bot/commands/${commandName}`);
    const override = commandOverrides[commandName];
    setModule(commandPath, {
      run: typeof override === 'function' ? override : async () => { },
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
  reference = null,
  fetchMember = async (id) => ({ id, user: { id, username: `user-${id}` } }),
} = {}) {
  const replies = [];
  const sends = [];
  const message = {
    content,
    author: {
      id: 'mod-1',
      bot: false,
      username: 'mod-user',
    },
    member: {
      id: 'mod-1',
      displayName: 'mod-display',
    },
    guild: {
      id: 'guild-1',
      name: 'Guild One',
      members: {
        fetch: fetchMember,
      },
    },
    reference,
    mentions: {
      repliedUser: null,
    },
    channel: {
      id: 'channel-1',
      toString: () => '#general',
      send: async (payload) => {
        sends.push(payload);
        return payload;
      },
    },
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
    client: {
      user: { id: 'bot-1', username: 'bot-user' },
    },
  };

  return { message, replies, sends };
}

test('.mute <@123...> 10m -> PASS', async () => {
  const targetId = '123456789012345678';
  let muteCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    mute: async (ctx) => {
      muteCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: `.mute <@${targetId}> 10m deneme`,
      fetchMember: async (id) => ({
        id,
        user: { id, username: 'MentionTarget' },
      }),
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(muteCtx);
    assert.equal(muteCtx.target?.id, targetId);
    assert.equal(muteCtx.targetId, targetId);
    assert.deepEqual(muteCtx.cleanArgs, ['10m', 'deneme']);
  } finally {
    restore();
  }
});

test('.mute <@!123...> 10m -> PASS', async () => {
  const targetId = '123456789012345678';
  let muteCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    mute: async (ctx) => {
      muteCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: `.mute <@!${targetId}> 10m deneme`,
      fetchMember: async (id) => ({
        id,
        user: { id, username: 'BangMentionTarget' },
      }),
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(muteCtx);
    assert.equal(muteCtx.target?.id, targetId);
    assert.equal(muteCtx.targetId, targetId);
    assert.deepEqual(muteCtx.cleanArgs, ['10m', 'deneme']);
  } finally {
    restore();
  }
});

test('.mute 123... 10m -> PASS', async () => {
  const targetId = '123456789012345678';
  let muteCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    mute: async (ctx) => {
      muteCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: `.mute ${targetId} 10m deneme`,
      fetchMember: async (id) => ({
        id,
        user: { id, username: 'TargetUser' },
      }),
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(muteCtx);
    assert.equal(muteCtx.target?.id, targetId);
    assert.equal(muteCtx.targetId, targetId);
    assert.deepEqual(muteCtx.cleanArgs, ['10m', 'deneme']);
  } finally {
    restore();
  }
});

test('reply ile .mute 10m -> reply hedefi kullanilmaz', async () => {
  let muteCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    mute: async (ctx) => {
      muteCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: '.mute 10m',
      reference: { messageId: 'reply-message-id' },
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(muteCtx);
    assert.equal(muteCtx.target, null);
    assert.equal(muteCtx.targetId, null);
    assert.deepEqual(muteCtx.cleanArgs, ['10m']);
  } finally {
    restore();
  }
});

test('.unban 123... -> PASS (member cache bagimsiz)', async () => {
  const targetId = '1447015808344784956';
  let unbanCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    unban: async (ctx) => {
      unbanCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: `.unban ${targetId}`,
      fetchMember: async () => null,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(unbanCtx);
    assert.equal(unbanCtx.target?.id, targetId);
    assert.equal(unbanCtx.targetId, targetId);
    assert.deepEqual(unbanCtx.cleanArgs, []);
  } finally {
    restore();
  }
});

test('.unban <@123...> -> PASS (mention ile member cache bagimsiz)', async () => {
  const targetId = '1447015808344784956';
  let unbanCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    unban: async (ctx) => {
      unbanCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: `.unban <@${targetId}> af`,
      fetchMember: async () => null,
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(unbanCtx);
    assert.equal(unbanCtx.target?.id, targetId);
    assert.equal(unbanCtx.targetId, targetId);
    assert.deepEqual(unbanCtx.cleanArgs, ['af']);
  } finally {
    restore();
  }
});

test('.durum -> PASS (hedefsiz sistem komutu route edilir)', async () => {
  let durumCtx = null;
  const { moderation, restore } = loadModerationWithStubs({
    durum: async (ctx) => {
      durumCtx = ctx;
    },
  });

  try {
    const { message, replies } = createPrefixMessage({
      content: '.durum',
    });

    const handled = await moderation.handlePrefix({}, message);

    assert.equal(handled, true);
    assert.equal(replies.length, 0);
    assert.ok(durumCtx);
    assert.equal(durumCtx.commandName, 'durum');
    assert.deepEqual(durumCtx.cleanArgs, []);
    assert.equal(durumCtx.target, null);
    assert.equal(durumCtx.targetId, null);
  } finally {
    restore();
  }
});
