const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sendModerationDmNotification,
  notifyModerationActionIfSuccessful,
  __internal,
} = require('../src/bot/services/moderationDmService');

function loadDmServiceWithLoggerMock(loggerStub = {}) {
  const servicePath = require.resolve('../src/bot/services/moderationDmService');
  const loggerPath = require.resolve('../src/logger');
  const originalService = require.cache[servicePath];
  const originalLogger = require.cache[loggerPath];

  delete require.cache[servicePath];
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      logSystem: loggerStub.logSystem || (() => {}),
      logError: loggerStub.logError || (() => {}),
      logStructuredError: loggerStub.logStructuredError || (() => {}),
      serializeError: loggerStub.serializeError || ((err) => String(err?.message || err || '')),
    },
  };

  const service = require(servicePath);
  return {
    service,
    restore: () => {
      delete require.cache[servicePath];
      if (originalService) require.cache[servicePath] = originalService;
      else delete require.cache[servicePath];
      if (originalLogger) require.cache[loggerPath] = originalLogger;
      else delete require.cache[loggerPath];
    },
  };
}

function createMessage({
  guildName = 'Geass',
  actorId = '900000000000000001',
  memberDisplayName = 'Kirin',
  authorGlobalName = 'Kirin Global',
  authorUsername = 'kirin-user',
  actorFetchMember = null,
  targetUser = undefined,
  fetchedUser = null,
  channelName = 'Anime & Sohbet',
  categoryName = 'Geass',
} = {}) {
  const sentPayloads = [];
  const fetchCalls = [];
  const defaultTargetUser = targetUser === undefined
    ? {
        id: '123456789012345678',
        username: 'TargetUser',
        send: async (payload) => {
          sentPayloads.push(payload);
          return payload;
        },
      }
    : targetUser;

  const userCache = new Map();
  if (defaultTargetUser?.id) userCache.set(defaultTargetUser.id, defaultTargetUser);

  return {
    message: {
      guild: {
        id: 'guild-1',
        name: guildName,
        members: {
          fetch: async () => actorFetchMember,
        },
      },
      author: {
        id: actorId,
        globalName: authorGlobalName,
        username: authorUsername,
      },
      member: memberDisplayName === null ? null : { displayName: memberDisplayName },
      channel: {
        name: channelName,
        parent: {
          name: categoryName,
        },
      },
      client: {
        user: { id: 'bot-1', username: 'BotUser' },
        users: {
          cache: userCache,
          fetch: async (id) => {
            fetchCalls.push(id);
            return fetchedUser;
          },
        },
      },
    },
    sentPayloads,
    fetchCalls,
    targetUser: defaultTargetUser,
  };
}

function getDmText(payload) {
  return String(payload?.content || '');
}

test('warn DM starts with guild name only and does not include breadcrumb-like channel text', async () => {
  const { message, sentPayloads, targetUser } = createMessage({
    guildName: 'Geass︱Anime & Sohbet',
    memberDisplayName: 'kuroda',
    channelName: 'Anime & Sohbet',
    categoryName: 'Kategori',
  });

  const result = await sendModerationDmNotification({
    message,
    actionType: 'warn',
    targetUserOrMember: targetUser,
    reason: 'flood',
  });

  assert.equal(result.sent, true);
  assert.equal(
    getDmText(sentPayloads[0]),
    "Geass'ta `kuroda` tarafından flood sebebiyle uyarıldın. İtirazınız varsa ticket açabilirsiniz. ୭ ˚. !!"
  );
  assert.doesNotMatch(getDmText(sentPayloads[0]), /\|/);
  assert.doesNotMatch(getDmText(sentPayloads[0]), /Anime & Sohbet/);
  assert.doesNotMatch(getDmText(sentPayloads[0]), /Kategori/);
});

test('guild name cleaner strips pipe-delimited branding from DM guild name', () => {
  assert.equal(__internal.cleanGuildName('Geass | Anime & Sohbet'), 'Geass');
});

test('mute DM renders executor as inline code and appends duration only when present', async () => {
  const { message, sentPayloads, targetUser } = createMessage({
    memberDisplayName: 'kuroda',
  });

  const result = await sendModerationDmNotification({
    message,
    actionType: 'mute',
    targetUserOrMember: targetUser,
    reason: 'küfür',
    durationText: '10m',
  });

  assert.equal(result.sent, true);
  assert.equal(
    getDmText(sentPayloads[0]),
    "Geass'ta `kuroda` tarafından küfür sebebiyle 10m süreyle susturuldun. İtirazınız varsa ticket açabilirsiniz. ୭ ˚. !!"
  );
});

test('unmute DM uses the simplified revoke format', async () => {
  const { message, sentPayloads, targetUser } = createMessage({
    memberDisplayName: 'kuroda',
  });

  const result = await sendModerationDmNotification({
    message,
    actionType: 'unmute',
    targetUserOrMember: targetUser,
  });

  assert.equal(result.sent, true);
  assert.equal(
    getDmText(sentPayloads[0]),
    "Geass'ta `kuroda` tarafından susturman kaldırıldı. ⋆˚࿔"
  );
});

test('reason fallback stays intact and suresiz duration segment is omitted', () => {
  const text = __internal.buildModerationDmText({
    actionType: 'mute',
    guildName: 'Geass',
    executorName: 'Kirin',
    reason: 'Yok',
    durationText: 'Süresiz',
  });

  assert.equal(
    text,
    "Geass'ta `Kirin` tarafından Belirtilmedi sebebiyle susturuldun. İtirazınız varsa ticket açabilirsiniz. ୭ ˚. !!"
  );
  assert.doesNotMatch(text, / {2}/);
  assert.doesNotMatch(text, /undefined|null|\[object Object\]/i);
});

test('revoke templates stay action-specific and readable', () => {
  const unmuteText = __internal.buildModerationDmText({
    actionType: 'unmute',
    guildName: 'Geass',
    executorName: 'Kirin',
  });
  const unbanText = __internal.buildModerationDmText({
    actionType: 'unban',
    guildName: 'Geass',
    executorName: 'Kirin',
  });
  const unjailText = __internal.buildModerationDmText({
    actionType: 'unjail',
    guildName: 'Geass',
    executorName: 'Kirin',
  });

  assert.equal(unmuteText, "Geass'ta `Kirin` tarafından susturman kaldırıldı. ⋆˚࿔");
  assert.equal(unbanText, "Geass'taki yasağın `Kirin` tarafından kaldırıldı. ⋆˚࿔");
  assert.equal(unjailText, "Geass'ta `Kirin` tarafından Underworld'den çıkarıldın. ⋆˚࿔");
});

test('executor formatter always renders inline code safely', () => {
  assert.equal(__internal.formatExecutorName('kuroda'), '`kuroda`');
  assert.equal(__internal.formatExecutorName('bad`name'), "`bad'name`");
});

test('service fetches the target user by authoritative ID when only userId is available', async () => {
  const fetchedPayloads = [];
  const fetchedUser = {
    id: '123456789012345678',
    username: 'FetchedUser',
    send: async (payload) => {
      fetchedPayloads.push(payload);
      return payload;
    },
  };
  const { message, fetchCalls } = createMessage({
    targetUser: null,
    fetchedUser,
  });

  const result = await sendModerationDmNotification({
    message,
    actionType: 'unban',
    targetId: '123456789012345678',
  });

  assert.equal(result.sent, true);
  assert.deepEqual(fetchCalls, ['123456789012345678']);
  assert.equal(fetchedPayloads.length, 1);
});

test('DM send failure is swallowed and does not throw to the caller', async () => {
  const sendError = new Error('Cannot send messages to this user');
  sendError.code = 50007;
  const { message, targetUser } = createMessage({
    targetUser: {
      id: '123456789012345678',
      username: 'TargetUser',
      send: async () => {
        throw sendError;
      },
    },
  });

  const result = await sendModerationDmNotification({
    message,
    actionType: 'warn',
    targetUserOrMember: targetUser,
    reason: 'flood',
  });

  assert.deepEqual(result, { sent: false, skipped: 'dm_closed', benign: true });
});

test('benign DM-closed failures are not logged at ERROR level', async () => {
  const logs = [];
  const { service, restore } = loadDmServiceWithLoggerMock({
    logStructuredError: (...args) => {
      logs.push(args);
    },
  });

  try {
    const sendError = new Error('Cannot send messages to this user');
    sendError.code = 50278;
    const { message, targetUser } = createMessage({
      targetUser: {
        id: '123456789012345678',
        username: 'TargetUser',
        send: async () => {
          throw sendError;
        },
      },
    });

    const result = await service.sendModerationDmNotification({
      message,
      actionType: 'ban',
      targetUserOrMember: targetUser,
      reason: 'reklam',
    });

    assert.deepEqual(result, { sent: false, skipped: 'dm_closed', benign: true });
    assert.equal(logs.length, 0);
  } finally {
    restore();
  }
});

test('non-benign DM failures are downgraded to WARN logs instead of being silenced', async () => {
  const logs = [];
  const { service, restore } = loadDmServiceWithLoggerMock({
    logStructuredError: (...args) => {
      logs.push(args);
    },
  });

  try {
    const sendError = new Error('payload malformed');
    sendError.code = 'EINVAL';
    const { message, targetUser } = createMessage({
      targetUser: {
        id: '123456789012345678',
        username: 'TargetUser',
        send: async () => {
          throw sendError;
        },
      },
    });

    const result = await service.sendModerationDmNotification({
      message,
      actionType: 'warn',
      targetUserOrMember: targetUser,
      reason: 'flood',
    });

    assert.deepEqual(result, { sent: false, skipped: 'send_failed', benign: false });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'moderation_dm_send_failed');
    assert.equal(logs[0][3], 'WARN');
  } finally {
    restore();
  }
});

test('notify helper skips DM dispatch when moderation execution is not successful', async () => {
  const sentPayloads = [];
  const { message, targetUser } = createMessage({
    targetUser: {
      id: '123456789012345678',
      username: 'TargetUser',
      send: async (payload) => {
        sentPayloads.push(payload);
        return payload;
      },
    },
  });

  const result = await notifyModerationActionIfSuccessful(
    { ok: false, primaryApplied: true },
    {
      message,
      actionType: 'warn',
      targetUserOrMember: targetUser,
      reason: 'flood',
    }
  );

  assert.deepEqual(result, { sent: false, skipped: 'action_not_successful' });
  assert.equal(sentPayloads.length, 0);
});

test('executor name falls back to author metadata when guild member data is absent', async () => {
  const { message } = createMessage({
    memberDisplayName: null,
    authorGlobalName: 'Kirin Global',
    authorUsername: 'kirin-user',
  });

  const executorName = await __internal.resolveExecutorName(message);
  assert.equal(executorName, 'Kirin Global');
});

test('guild name resolver uses only guild.name', () => {
  const { message } = createMessage({
    guildName: 'Geass︱Anime & Sohbet',
    channelName: 'Anime & Sohbet',
    categoryName: 'Kategori',
  });

  assert.equal(__internal.resolveGuildName(message), 'Geass');
});
