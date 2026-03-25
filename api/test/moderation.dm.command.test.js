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

function createMessageBase({ events, warnings, fetchedUserFactory = null } = {}) {
  return {
    guild: {
      id: 'guild-1',
      name: 'Geass',
    },
    author: {
      id: '900000000000000001',
      username: 'mod-user',
    },
    member: {
      id: '900000000000000001',
      displayName: 'Kirin',
    },
    client: {
      user: { id: 'bot-1', username: 'BotUser' },
      users: {
        cache: new Map(),
        fetch: async (id) => {
          events.push(`fetchUser:${id}`);
          return fetchedUserFactory ? fetchedUserFactory(id) : null;
        },
      },
    },
    reply: async (payload) => {
      warnings.push(payload);
      return payload;
    },
    channel: {
      send: async (payload) => {
        warnings.push(payload);
        return payload;
      },
    },
  };
}

function createSendTemplate(events, templates) {
  return async (templateKey, context = {}, options = {}) => {
    events.push(`template:${templateKey}`);
    templates.push({ templateKey, context, options });
  };
}

function createDmUser(events, dmPayloads, { id = '123456789012345678', username = 'TargetUser', error = null } = {}) {
  return {
    id,
    username,
    send: async (payload) => {
      events.push('dm');
      if (error) throw error;
      dmPayloads.push(payload);
      return payload;
    },
  };
}

function createWarnLikeContext({
  events,
  warnings,
  dmPayloads,
  commandName = 'warn',
  cleanArgs = [],
  targetId = '123456789012345678',
  dmError = null,
  verifyPermissionResult = null,
  targetPatch = {},
  messagePatch = {},
  settings = {},
} = {}) {
  const targetUser = createDmUser(events, dmPayloads, { id: targetId, error: dmError });
  const {
    communicationDisabledUntilTimestamp: initialTimeoutUntil = null,
    voice: targetVoicePatch = {},
    ...otherTargetPatch
  } = targetPatch;
  const targetState = {
    communicationDisabledUntilTimestamp: initialTimeoutUntil,
    voiceChannelId: targetVoicePatch.channelId || null,
  };
  const target = {
    id: targetId,
    user: targetUser,
    permissions: {
      has: () => false,
    },
    get communicationDisabledUntilTimestamp() {
      return targetState.communicationDisabledUntilTimestamp;
    },
    set communicationDisabledUntilTimestamp(value) {
      targetState.communicationDisabledUntilTimestamp = value;
    },
    moderatable: true,
    timeout: async (duration) => {
      events.push(duration === null ? 'timeout.clear' : 'timeout.apply');
      targetState.communicationDisabledUntilTimestamp = duration === null ? null : Date.now() + Number(duration);
      return target;
    },
    voice: {
      get channelId() {
        return targetState.voiceChannelId;
      },
      get channel() {
        return targetState.voiceChannelId ? { id: targetState.voiceChannelId } : null;
      },
      disconnect: async () => {
        events.push('voice.disconnect');
        targetState.voiceChannelId = null;
      },
    },
    roles: {
      cache: {
        has: () => false,
      },
      add: async () => {
        events.push('roles.add');
      },
      remove: async () => {
        events.push('roles.remove');
      },
      set: async () => {
        events.push('roles.set');
      },
    },
    kick: async (reason) => {
      events.push('kick');
      return reason;
    },
    ...otherTargetPatch,
  };

  const templates = [];
  const baseMessage = createMessageBase({ events, warnings });
  const message = {
    ...baseMessage,
    ...messagePatch,
    guild: {
      ...baseMessage.guild,
      ...(messagePatch.guild || {}),
      members: {
        ...(baseMessage.guild?.members || {}),
        ...(messagePatch.guild?.members || {}),
        fetch: async (id) => (String(id) === String(targetId) ? target : null),
      },
    },
  };

  const verifyPermission = async () => {
    if (verifyPermissionResult) return verifyPermissionResult;
    const baseResult = {
      success: true,
      consumeLimit: async () => true,
    };

    if (commandName === 'mute' || commandName === 'unmute') {
      baseResult.context = {
        botMember: {
          permissions: {
            has: () => true,
          },
        },
      };
    }
    if (commandName === 'unjail') {
      baseResult.context = { managedRoleId: 'jail-role' };
    }

    return baseResult;
  };

  return {
    ctx: {
      message,
      target,
      cleanArgs,
      targetMention: '@Target',
      sendTemplate: createSendTemplate(events, templates),
      verifyPermission,
      settings,
    },
    target,
    templates,
  };
}

function createBanContext({ events, warnings, dmPayloads, reason = 'reklam', dmError = null } = {}) {
  const targetId = '1447015808344784956';
  const dmUser = createDmUser(events, dmPayloads, { id: targetId, username: 'TargetUser', error: dmError });
  const targetMember = {
    id: targetId,
    bannable: true,
    user: { id: targetId, username: 'TargetUser' },
    roles: { cache: new Map() },
  };

  const memberSequence = [targetMember, targetMember];
  const banSequence = [
    null,
    null,
    {
      user: {
        id: targetId,
        username: 'TargetUser',
      },
    },
  ];
  const templates = [];
  const message = createMessageBase({
    events,
    warnings,
    fetchedUserFactory: asyncId => (String(asyncId) === targetId ? dmUser : null),
  });
  let memberFetchIndex = 0;
  let banFetchIndex = 0;

  message.guild.members = {
    fetch: async () => {
      const index = Math.min(memberFetchIndex, memberSequence.length - 1);
      memberFetchIndex += 1;
      return memberSequence[index];
    },
    ban: async () => {
      events.push('ban');
    },
  };
  message.guild.bans = {
    cache: new Map(),
    fetch: async () => {
      const index = Math.min(banFetchIndex, banSequence.length - 1);
      const next = banSequence[index];
      banFetchIndex += 1;
      return next;
    },
  };

  return {
    ctx: {
      message,
      target: null,
      targetId,
      cleanArgs: [reason],
      targetMention: `<@${targetId}>`,
      argsSummary: `${targetId} ${reason}`,
      sendTemplate: createSendTemplate(events, templates),
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => true,
      }),
    },
    templates,
    targetId,
  };
}

function createUnbanContext({ events, warnings, dmPayloads } = {}) {
  const targetId = '1447015808344784956';
  const dmUser = createDmUser(events, dmPayloads, { id: targetId, username: 'BannedUser' });
  const templates = [];
  const message = createMessageBase({
    events,
    warnings,
    fetchedUserFactory: asyncId => (String(asyncId) === targetId ? dmUser : null),
  });
  const banSequence = [
    { user: { id: targetId, username: 'BannedUser' } },
    { user: { id: targetId, username: 'BannedUser' } },
    null,
  ];
  let banFetchIndex = 0;

  message.guild.bans = {
    cache: new Map(),
    fetch: async () => {
      const index = Math.min(banFetchIndex, banSequence.length - 1);
      const next = banSequence[index];
      banFetchIndex += 1;
      return next;
    },
    remove: async () => {
      events.push('unban');
      return { id: targetId };
    },
  };

  return {
    ctx: {
      message,
      target: null,
      targetId,
      cleanArgs: [],
      argsSummary: targetId,
      targetMention: `<@${targetId}>`,
      sendTemplate: createSendTemplate(events, templates),
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => true,
      }),
    },
    templates,
  };
}

test('warn success sends a DM that names the real moderator', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('warn', {
    logActionStub: async () => 42,
  });

  try {
    const { ctx, templates } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      cleanArgs: ['flood'],
      messagePatch: {
        guild: {
          id: 'guild-1',
          name: 'Geass | Anime & Sohbet',
        },
      },
    });

    await command.run(ctx);

    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'success');
    assert.equal(dmPayloads.length, 1);
    assert.equal(
      String(dmPayloads[0]?.content || ''),
      "Geass'ta `Kirin` tarafından flood sebebiyle uyarıldın. İtirazınız varsa ticket açabilirsiniz. ୭ ˚. !!"
    );
    assert.doesNotMatch(String(dmPayloads[0]?.content || ''), /BotUser/);
  } finally {
    command.restore();
  }
});

test('mute success sends DM with duration and reason', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('mute', {
    logActionStub: async () => 42,
  });

  try {
    const { ctx } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      commandName: 'mute',
      cleanArgs: ['10m', 'kufur'],
    });

    await command.run(ctx);

    assert.equal(dmPayloads.length, 1);
    assert.equal(
      String(dmPayloads[0]?.content || ''),
      "Geass'ta `Kirin` tarafından kufur sebebiyle 10m süreyle susturuldun. İtirazınız varsa ticket açabilirsiniz. ୭ ˚. !!"
    );
  } finally {
    command.restore();
  }
});

test('unmute success sends DM after timeout is cleared', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('unmute', {
    logActionStub: async () => 42,
  });

  try {
    const { ctx } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      commandName: 'unmute',
      cleanArgs: ['af'],
      targetPatch: {
        communicationDisabledUntilTimestamp: Date.now() + 60_000,
      },
    });

    await command.run(ctx);

    assert.equal(dmPayloads.length, 1);
    assert.equal(
      String(dmPayloads[0]?.content || ''),
      "Geass'ta `Kirin` tarafından susturman kaldırıldı. ⋆˚࿔"
    );
  } finally {
    command.restore();
  }
});

test('kick sends DM only after the kick action has already succeeded', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('kick', {
    logActionStub: async () => 42,
  });

  try {
    const { ctx } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      cleanArgs: ['reklam'],
    });

    await command.run(ctx);

    assert.deepEqual(events.filter((entry) => ['kick', 'template:success', 'dm'].includes(entry)), [
      'kick',
      'template:success',
      'dm',
    ]);
  } finally {
    command.restore();
  }
});

test('ban sends DM only after authoritative success has been confirmed', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('ban', {
    logActionStub: async () => 77,
  });

  try {
    const { ctx } = createBanContext({ events, warnings, dmPayloads });

    await command.run(ctx);

    const relevantEvents = events.filter((entry) => entry === 'ban' || entry === 'template:success' || entry.startsWith('fetchUser:') || entry === 'dm');
    assert.deepEqual(relevantEvents, [
      'ban',
      'template:success',
      'fetchUser:1447015808344784956',
      'dm',
    ]);
    assert.equal(dmPayloads.length, 1);
  } finally {
    command.restore();
  }
});

test('required log failure suppresses DM dispatch entirely', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('warn', {
    logActionStub: async () => {
      throw new Error('log_down');
    },
  });

  try {
    const { ctx, templates } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      cleanArgs: ['flood'],
    });

    await command.run(ctx);

    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'systemError');
    assert.equal(dmPayloads.length, 0);
    assert.equal(warnings.length, 0);
  } finally {
    command.restore();
  }
});

test('DM failure does not break the main moderation command', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const dmError = new Error('dm_closed');
  dmError.code = 50007;
  const command = loadCommandWithMocks('warn', {
    logActionStub: async () => 42,
  });

  try {
    const { ctx, templates } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      cleanArgs: ['flood'],
      dmError,
    });

    await command.run(ctx);

    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'success');
    assert.equal(dmPayloads.length, 0);
    assert.equal(warnings.length, 0);
  } finally {
    command.restore();
  }
});

test('ban keeps success semantics when target DMs are closed', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const dmError = new Error('Cannot send messages to this user');
  dmError.code = 50007;
  const command = loadCommandWithMocks('ban', {
    logActionStub: async () => 77,
  });

  try {
    const { ctx, templates } = createBanContext({
      events,
      warnings,
      dmPayloads,
      dmError,
    });

    await command.run(ctx);

    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'success');
    assert.equal(dmPayloads.length, 0);
    assert.equal(warnings.length, 0);
    assert.deepEqual(events.filter((entry) => entry === 'ban' || entry.startsWith('fetchUser:')), [
      'ban',
      'fetchUser:1447015808344784956',
    ]);
  } finally {
    command.restore();
  }
});

test('unban success sends the revoke DM after the ban is removed', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('unban', {
    logActionStub: async () => 42,
  });

  try {
    const { ctx, templates } = createUnbanContext({ events, warnings, dmPayloads });

    await command.run(ctx);

    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'success');
    assert.deepEqual(events.filter((entry) => entry === 'unban' || entry.startsWith('fetchUser:') || entry === 'dm'), [
      'unban',
      'fetchUser:1447015808344784956',
      'dm',
    ]);
    assert.equal(
      String(dmPayloads[0]?.content || ''),
      "Geass'taki yasağın `Kirin` tarafından kaldırıldı. ⋆˚࿔"
    );
  } finally {
    command.restore();
  }
});

test('unjail success sends the revoke DM after roles are restored', async () => {
  const events = [];
  const warnings = [];
  const dmPayloads = [];
  const command = loadCommandWithMocks('unjail', {
    penaltySchedulerStub: {
      restoreJailRoles: async () => {
        events.push('restoreJailRoles');
      },
      cancelPenalty: async () => {},
    },
  });

  try {
    const { ctx, templates } = createWarnLikeContext({
      events,
      warnings,
      dmPayloads,
      commandName: 'unjail',
      targetPatch: {
        roles: {
          cache: {
            has: (roleId) => roleId === 'jail-role',
          },
        },
      },
      settings: { jail_penalty_role: 'jail-role' },
    });

    await command.run(ctx);

    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'success');
    assert.deepEqual(events.filter((entry) => entry === 'restoreJailRoles' || entry === 'template:success' || entry === 'dm'), [
      'restoreJailRoles',
      'template:success',
      'dm',
    ]);
    assert.equal(
      String(dmPayloads[0]?.content || ''),
      "Geass'ta `Kirin` tarafından Underworld'den çıkarıldın. ⋆˚࿔"
    );
  } finally {
    command.restore();
  }
});
