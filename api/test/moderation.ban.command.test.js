const test = require('node:test');
const assert = require('node:assert/strict');

function loadBanCommand(logActionStub) {
  const commandPath = require.resolve('../src/bot/commands/ban');
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

function buildBanRecord(userId, username = 'TargetUser') {
  return {
    user: {
      id: String(userId),
      username,
    },
  };
}

function createContext({
  target = null,
  targetId = null,
  argsSummary = '',
  cleanArgs = [],
  targetMention = '@Target',
  fetchedMember = null,
  fetchedMemberSequence = null,
  verifyPermissionResult = null,
  banFetchSequence = null,
  bansFetchError = null,
} = {}) {
  const calls = {
    verifyPermission: [],
    fetchMember: [],
    ban: [],
    fetchBan: [],
    templates: [],
    consumeLimit: [],
  };

  const normalizedTargetId = String(targetId || fetchedMember?.id || '').trim();
  const memberSequence = Array.isArray(fetchedMemberSequence)
    ? [...fetchedMemberSequence]
    : fetchedMember
      ? [fetchedMember, fetchedMember]
      : [null];
  const normalizedBanSequence = Array.isArray(banFetchSequence)
    ? [...banFetchSequence]
    : [
        null,
        null,
        normalizedTargetId ? buildBanRecord(normalizedTargetId, fetchedMember?.user?.username || 'TargetUser') : null,
      ];
  let memberFetchIndex = 0;
  let banFetchIndex = 0;

  const message = {
    guild: {
      id: 'guild-1',
      members: {
        fetch: async (id) => {
          calls.fetchMember.push(id);
          const index = Math.min(memberFetchIndex, Math.max(memberSequence.length - 1, 0));
          const next = memberSequence.length > 0 ? memberSequence[index] : null;
          memberFetchIndex += 1;
          return next;
        },
        ban: async (id, payload) => {
          calls.ban.push({ id, payload });
        },
      },
      bans: {
        cache: new Map(),
        fetch: async (request) => {
          calls.fetchBan.push(request);
        if (bansFetchError) throw bansFetchError;
        const index = Math.min(banFetchIndex, Math.max(normalizedBanSequence.length - 1, 0));
        const next = normalizedBanSequence.length > 0 ? normalizedBanSequence[index] : null;
        banFetchIndex += 1;
        if (next instanceof Error) throw next;
        return next;
      },
    },
    },
    author: { id: 'mod-1' },
    client: { user: { id: 'bot-1', username: 'BotUser' } },
  };

  const verifyPermission = async (...args) => {
    calls.verifyPermission.push(args);
    if (verifyPermissionResult) return verifyPermissionResult;
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
      argsSummary,
      cleanArgs,
      targetMention,
      sendTemplate,
      verifyPermission,
    },
    calls,
  };
}

test('.ban ID-only hedefte member bulunamiyorsa fail-closed davranir', async () => {
  const logCalls = [];
  const command = loadBanCommand(async (...args) => {
    logCalls.push(args);
    return 77;
  });

  try {
    const { ctx, calls } = createContext({
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956 test reason',
      cleanArgs: ['test', 'reason'],
    });

    await command.run(ctx);

    assert.equal(calls.fetchMember.length, 1);
    assert.equal(calls.fetchMember[0], '1447015808344784956');
    assert.equal(calls.verifyPermission.length, 0);
    assert.equal(calls.consumeLimit.length, 0);
    assert.equal(calls.ban.length, 0);
    assert.equal(calls.templates[0].templateKey, 'userNotFound');
    assert.equal(logCalls.length, 0);
  } finally {
    command.restore();
  }
});

test('.ban resolve edilen member varken hierarchy/bannable kontrol yolunu korur', async () => {
  const command = loadBanCommand(async () => 11);

  try {
    const fetchedMember = {
      id: '1447015808344784956',
      bannable: true,
      user: { id: '1447015808344784956', username: 'TargetUser' },
      roles: { cache: new Map() },
    };
    const { ctx, calls } = createContext({
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      fetchedMember,
      targetMention: '<@1447015808344784956>',
    });

    await command.run(ctx);

    assert.deepEqual(calls.verifyPermission[0], [
      'ban',
      fetchedMember,
      { execution: { requireTargetMember: true, requireTargetBannable: true } },
    ]);
    assert.deepEqual(calls.fetchBan, [
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
    ]);
    assert.equal(calls.fetchMember.length, 2);
    assert.equal(calls.ban[0].id, '1447015808344784956');
    assert.equal(calls.templates[0].templateKey, 'success');
  } finally {
    command.restore();
  }
});

test('ban success mesaji sadece authoritative verify ile gonderilir', async () => {
  const logCalls = [];
  const command = loadBanCommand(async (...args) => {
    logCalls.push(args);
    return 15;
  });

  try {
    const fetchedMember = {
      id: '1447015808344784956',
      bannable: true,
      user: { id: '1447015808344784956', username: 'TargetUser' },
      roles: { cache: new Map() },
    };
    const { ctx, calls } = createContext({
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      fetchedMember,
      targetMention: '<@1447015808344784956>',
      banFetchSequence: [null, null, null],
    });

    await command.run(ctx);

    assert.equal(calls.ban.length, 1);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'systemError');
    assert.equal(logCalls.length, 0);
  } finally {
    command.restore();
  }
});

test('ban authoritative verify retries through an initial false-negative', async () => {
  const logCalls = [];
  const command = loadBanCommand(async (...args) => {
    logCalls.push(args);
    return 16;
  });

  try {
    const fetchedMember = {
      id: '1447015808344784956',
      bannable: true,
      user: { id: '1447015808344784956', username: 'TargetUser' },
      roles: { cache: new Map() },
    };
    const { ctx, calls } = createContext({
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      fetchedMember,
      targetMention: '<@1447015808344784956>',
      banFetchSequence: [null, null, null, buildBanRecord('1447015808344784956')],
    });

    await command.run(ctx);

    assert.equal(calls.ban.length, 1);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(logCalls.length, 1);
    assert.deepEqual(calls.fetchBan, [
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
      { user: '1447015808344784956', force: true, cache: false },
    ]);
  } finally {
    command.restore();
  }
});

test('ban authoritative fetch hatasini sessizce yutmaz', async () => {
  const command = loadBanCommand(async () => 1);

  try {
    const fetchedMember = {
      id: '1447015808344784956',
      bannable: true,
      user: { id: '1447015808344784956', username: 'TargetUser' },
      roles: { cache: new Map() },
    };
    const fetchError = new Error('rest_down');
    fetchError.code = 'ECONNRESET';
    const { ctx, calls } = createContext({
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      fetchedMember,
      targetMention: '<@1447015808344784956>',
      bansFetchError: fetchError,
    });

    await command.run(ctx);

    assert.equal(calls.ban.length, 0);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'systemError');
  } finally {
    command.restore();
  }
});

test('ban Discord aksiyonu sonrasi gelen transient verify hatasinda yalanci failure donmez', async () => {
  const logCalls = [];
  const command = loadBanCommand(async (...args) => {
    logCalls.push(args);
    return 81;
  });

  try {
    const fetchedMember = {
      id: '1447015808344784956',
      bannable: true,
      user: { id: '1447015808344784956', username: 'TargetUser' },
      roles: { cache: new Map() },
    };
    const verifyError = new Error('rest_down_after_ban');
    verifyError.code = 'ECONNRESET';
    const { ctx, calls } = createContext({
      targetId: '1447015808344784956',
      argsSummary: '1447015808344784956',
      fetchedMember,
      targetMention: '<@1447015808344784956>',
      banFetchSequence: [null, null, verifyError],
    });

    await command.run(ctx);

    assert.equal(calls.ban.length, 1);
    assert.equal(calls.templates.length, 1);
    assert.equal(calls.templates[0].templateKey, 'success');
    assert.equal(logCalls.length, 1);
  } finally {
    command.restore();
  }
});
