const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_NATIVE_TIMEOUT_MS,
  SAFE_TIMEOUT_BUFFER_MS,
  SAFE_MAX_NATIVE_TIMEOUT_MS,
} = require('../src/bot/services/nativeTimeoutService');

function loadCommandWithMocks(commandName, {
  logActionStub = async () => 1,
  notifyStub = async () => ({ sent: false, skipped: 'stubbed' }),
  loggerStub = {},
} = {}) {
  const commandPath = require.resolve(`../src/bot/commands/${commandName}`);
  const logsPath = require.resolve('../src/bot/moderation.logs');
  const dmServicePath = require.resolve('../src/bot/services/moderationDmService');
  const loggerPath = require.resolve('../src/logger');
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

  remember(commandPath);
  delete require.cache[commandPath];

  setModule(logsPath, {
    logAction: logActionStub,
  });
  setModule(dmServicePath, {
    notifyModerationActionIfSuccessful: notifyStub,
  });
  setModule(loggerPath, {
    logSystem: loggerStub.logSystem || (() => {}),
    logError: loggerStub.logError || (() => {}),
  });

  const command = require(commandPath);
  return {
    run: command.run,
    restore: () => {
      delete require.cache[commandPath];
      for (const [path, original] of originals.entries()) {
        if (original) require.cache[path] = original;
        else delete require.cache[path];
      }
    },
  };
}

function createTimeoutTarget({
  id = '123456789012345678',
  username = 'TargetUser',
  inVoice = false,
  activeTimeoutUntil = null,
  admin = false,
  moderatable = true,
  timeoutError = null,
  clearTimeoutError = null,
  disconnectError = null,
  leaveVoiceOnDisconnectError = false,
  events = [],
} = {}) {
  const state = {
    communicationDisabledUntilTimestamp: activeTimeoutUntil,
    voiceChannelId: inVoice ? 'voice-1' : null,
    lastAppliedTimeoutDurationMs: null,
  };

  const member = {
    id,
    user: { id, username },
    roles: {
      cache: {
        has: () => false,
      },
    },
    permissions: {
      has: (perm) => perm === 'Administrator' && admin,
    },
    get communicationDisabledUntilTimestamp() {
      return state.communicationDisabledUntilTimestamp;
    },
    set communicationDisabledUntilTimestamp(value) {
      state.communicationDisabledUntilTimestamp = value;
    },
    get moderatable() {
      return Boolean(moderatable) && !admin;
    },
    voice: {
      get channelId() {
        return state.voiceChannelId;
      },
      get channel() {
        return state.voiceChannelId ? { id: state.voiceChannelId } : null;
      },
      disconnect: async () => {
        events.push('voice.disconnect');
        if (disconnectError) {
          if (leaveVoiceOnDisconnectError) state.voiceChannelId = null;
          throw disconnectError;
        }
        state.voiceChannelId = null;
      },
    },
    timeout: async (duration) => {
      if (duration === null) {
        events.push('timeout.clear');
        if (clearTimeoutError) throw clearTimeoutError;
        state.communicationDisabledUntilTimestamp = null;
        return member;
      }

      events.push('timeout.apply');
      if (timeoutError) throw timeoutError;
      state.lastAppliedTimeoutDurationMs = Number(duration);
      state.communicationDisabledUntilTimestamp = Date.now() + Number(duration);
      return member;
    },
  };

  return { member, state };
}

function createContext({
  cleanArgs = [],
  targetConfig = {},
  verifyPermissionResult = null,
  memberFetchSequence = null,
  events = [],
  warnings = [],
  targetMention = '@Target',
} = {}) {
  const { member, state } = createTimeoutTarget({ ...targetConfig, events });
  const templates = [];
  const limitState = {
    committed: 0,
    rolledBack: 0,
  };

  const botPermissions = new Set((targetConfig.botPermissions || ['ModerateMembers', 'MoveMembers']).map(String));
  const botMember = {
    permissions: {
      has: (perm) => botPermissions.has(String(perm)),
    },
  };
  const fetchSequence = Array.isArray(memberFetchSequence) && memberFetchSequence.length > 0
    ? [...memberFetchSequence]
    : [member];
  let memberFetchIndex = 0;

  const message = {
    guild: {
      id: 'guild-1',
      name: 'Geass',
      ownerId: targetConfig.guildOwnerId || 'owner-1',
      members: {
        fetch: async (id) => {
          if (String(id) !== String(member.id)) return null;
          const sequenceIndex = Math.min(memberFetchIndex, fetchSequence.length - 1);
          memberFetchIndex += 1;
          return fetchSequence[sequenceIndex];
        },
      },
    },
    author: { id: 'mod-1', username: 'ModUser' },
    member: { id: 'mod-1', displayName: 'Kirin' },
    client: { user: { id: 'bot-1', username: 'BotUser' } },
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

  const sendTemplate = async (templateKey, context = {}, options = {}) => {
    templates.push({ templateKey, context, options });
    return { templateKey, context, options };
  };

  const verifyPermission = async () => {
    if (verifyPermissionResult) return verifyPermissionResult;
    return {
      success: true,
      context: { botMember },
      consumeLimit: async () => ({
        commit: async () => {
          limitState.committed += 1;
          events.push('limit.commit');
        },
        rollback: async () => {
          limitState.rolledBack += 1;
          events.push('limit.rollback');
        },
      }),
    };
  };

  return {
    ctx: {
      message,
      target: member,
      cleanArgs,
      targetMention,
      sendTemplate,
      verifyPermission,
      settings: {},
      argsSummary: `${targetMention} ${cleanArgs.join(' ')}`.trim(),
    },
    member,
    state,
    templates,
    warnings,
    limitState,
  };
}

test('mute success applies native timeout and emits success', async () => {
  const logCalls = [];
  const notifyCalls = [];
  const events = [];
  const command = loadCommandWithMocks('mute', {
    logActionStub: async (...args) => {
      logCalls.push(args);
      return 77;
    },
    notifyStub: async (result, options) => {
      notifyCalls.push({ result, options });
      return { sent: true };
    },
  });

  try {
    const { ctx, state, templates, limitState } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'kufur'],
      events,
    });

    await command.run(ctx);

    assert.equal(state.communicationDisabledUntilTimestamp > Date.now(), true);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'success');
    assert.equal(templates[0].context.caseId, '#77');
    assert.equal(templates[0].context.time, '10m');
    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0][3], 'mute');
    assert.equal(limitState.committed, 1);
    assert.equal(limitState.rolledBack, 0);
    assert.equal(notifyCalls.length, 1);
  } finally {
    command.restore();
  }
});

test('mute success disconnects target from voice when target starts in voice', async () => {
  const events = [];
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, state, templates } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
      targetConfig: { inVoice: true },
      events,
    });

    await command.run(ctx);

    assert.equal(state.communicationDisabledUntilTimestamp > Date.now(), true);
    assert.equal(state.voiceChannelId, null);
    assert.deepEqual(events.filter((entry) => entry === 'timeout.apply' || entry === 'voice.disconnect'), [
      'timeout.apply',
      'voice.disconnect',
    ]);
    assert.equal(templates[0]?.templateKey, 'success');
  } finally {
    command.restore();
  }
});

test('mute authoritative verify retries through a stale false-negative and still returns success', async () => {
  const logCalls = [];
  const notifyCalls = [];
  const command = loadCommandWithMocks('mute', {
    logActionStub: async (...args) => {
      logCalls.push(args);
      return 88;
    },
    notifyStub: async (result, options) => {
      notifyCalls.push({ result, options });
      return { sent: true };
    },
  });

  try {
    const staleSnapshot = {
      id: '123456789012345678',
      roles: { cache: { has: () => false } },
      get communicationDisabledUntilTimestamp() {
        return null;
      },
    };
    const { ctx, templates, warnings, limitState } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
    });
    const stableMember = ctx.target;
    const sequence = [stableMember, stableMember, staleSnapshot, stableMember];
    let index = 0;
    ctx.message.guild.members.fetch = async (id) => {
      if (String(id) !== String(stableMember.id)) return null;
      const next = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return next;
    };

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(templates[0]?.context?.caseId, '#88');
    assert.equal(warnings.length, 0);
    assert.equal(limitState.committed, 1);
    assert.equal(limitState.rolledBack, 0);
    assert.equal(logCalls.length, 1);
    assert.equal(notifyCalls.length, 1);
  } finally {
    command.restore();
  }
});

test('mute fails cleanly before timeout when target is in voice and bot lacks MoveMembers', async () => {
  const events = [];
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, state, templates, limitState } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
      targetConfig: {
        inVoice: true,
        botPermissions: ['ModerateMembers'],
      },
      events,
    });

    await command.run(ctx);

    assert.equal(state.communicationDisabledUntilTimestamp, null);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].templateKey, 'voiceDisconnectPermissionRequired');
    assert.equal(events.includes('timeout.apply'), false);
    assert.equal(limitState.committed, 0);
    assert.equal(limitState.rolledBack, 0);
  } finally {
    command.restore();
  }
});

test('mute defaults to 28d when duration is omitted entirely', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates, state } = createContext({
      commandName: 'mute',
      cleanArgs: [],
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(templates[0]?.context?.time, '28d');
    assert.equal(templates[0]?.context?.reason, 'Yok');
    assert.equal(state.communicationDisabledUntilTimestamp > Date.now(), true);
    assert.equal(SAFE_MAX_NATIVE_TIMEOUT_MS, MAX_NATIVE_TIMEOUT_MS - SAFE_TIMEOUT_BUFFER_MS);
    assert.equal(state.lastAppliedTimeoutDurationMs, SAFE_MAX_NATIVE_TIMEOUT_MS);
  } finally {
    command.restore();
  }
});

test('mute defaults to 28d and treats the first plain-text token as reason', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates, state } = createContext({
      commandName: 'mute',
      cleanArgs: ['kufur'],
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(templates[0]?.context?.time, '28d');
    assert.equal(templates[0]?.context?.reason, 'kufur');
    assert.equal(state.communicationDisabledUntilTimestamp > Date.now(), true);
    assert.equal(state.lastAppliedTimeoutDurationMs, SAFE_MAX_NATIVE_TIMEOUT_MS);
  } finally {
    command.restore();
  }
});

test('mute clamps explicit 28d input to the safe native timeout upper bound', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates, state } = createContext({
      commandName: 'mute',
      cleanArgs: ['28d', 'test'],
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(templates[0]?.context?.time, '28d');
    assert.equal(state.lastAppliedTimeoutDurationMs, SAFE_MAX_NATIVE_TIMEOUT_MS);
  } finally {
    command.restore();
  }
});

test('mute rejects invalid duration explicitly', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates } = createContext({
      commandName: 'mute',
      cleanArgs: ['20dk', 'test'],
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'invalidDuration');
  } finally {
    command.restore();
  }
});

test('mute rejects durations longer than Discord native limit', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates } = createContext({
      commandName: 'mute',
      cleanArgs: ['29d', 'test'],
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'durationTooLong');
    assert.equal(templates[0]?.context?.maxDuration, '28d');
  } finally {
    command.restore();
  }
});

test('mute rejects administrator targets with a dedicated template', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates, state } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
      targetConfig: { admin: true },
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'timeoutProtectedTarget');
    assert.equal(state.communicationDisabledUntilTimestamp, null);
  } finally {
    command.restore();
  }
});

test('mute reports already timed out targets without overwriting timeout state', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates, state } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
      targetConfig: { activeTimeoutUntil: Date.now() + 60_000 },
    });
    const originalUntil = state.communicationDisabledUntilTimestamp;

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'alreadyApplied');
    assert.equal(state.communicationDisabledUntilTimestamp, originalUntil);
  } finally {
    command.restore();
  }
});

test('mute does not fake success when timeout apply throws', async () => {
  const logCalls = [];
  const events = [];
  const command = loadCommandWithMocks('mute', {
    logActionStub: async (...args) => {
      logCalls.push(args);
      return 77;
    },
  });

  try {
    const { ctx, templates, limitState, warnings } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
      targetConfig: {
        timeoutError: new Error('discord_down'),
      },
      events,
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'systemError');
    assert.equal(logCalls.length, 0);
    assert.equal(events.includes('timeout.apply'), true);
    assert.equal(limitState.committed, 0);
    assert.equal(limitState.rolledBack, 1);
    assert.equal(warnings.length, 0);
  } finally {
    command.restore();
  }
});

test('mute rolls back timeout and reports honest failure when disconnect fails while target stays in voice', async () => {
  const logCalls = [];
  const events = [];
  const command = loadCommandWithMocks('mute', {
    logActionStub: async (...args) => {
      logCalls.push(args);
      return 77;
    },
  });

  try {
    const { ctx, templates, state, limitState } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
      targetConfig: {
        inVoice: true,
        disconnectError: new Error('voice_disconnect_failed'),
      },
      events,
    });

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'voiceDisconnectFailed');
    assert.equal(state.communicationDisabledUntilTimestamp, null);
    assert.equal(state.voiceChannelId, 'voice-1');
    assert.equal(logCalls.length, 0);
    assert.equal(limitState.committed, 0);
    assert.equal(limitState.rolledBack, 1);
    assert.deepEqual(events.filter((entry) => entry === 'timeout.apply' || entry === 'voice.disconnect' || entry === 'timeout.clear'), [
      'timeout.apply',
      'voice.disconnect',
      'timeout.clear',
    ]);
  } finally {
    command.restore();
  }
});

test('manual unmute clears native timeout and writes a case log', async () => {
  const logCalls = [];
  const notifyCalls = [];
  const command = loadCommandWithMocks('unmute', {
    logActionStub: async (...args) => {
      logCalls.push(args);
      return 91;
    },
    notifyStub: async (result, options) => {
      notifyCalls.push({ result, options });
      return { sent: true };
    },
  });

  try {
    const { ctx, state, templates, limitState } = createContext({
      commandName: 'unmute',
      cleanArgs: ['af'],
      targetConfig: {
        activeTimeoutUntil: Date.now() + 60_000,
      },
    });

    await command.run(ctx);

    assert.equal(state.communicationDisabledUntilTimestamp, null);
    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(templates[0]?.context?.caseId, '#91');
    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0][3], 'unmute');
    assert.equal(limitState.committed, 1);
    assert.equal(limitState.rolledBack, 0);
    assert.equal(notifyCalls.length, 1);
  } finally {
    command.restore();
  }
});

test('unmute authoritative verify retries through a stale still-timed-out snapshot', async () => {
  const logCalls = [];
  const notifyCalls = [];
  const command = loadCommandWithMocks('unmute', {
    logActionStub: async (...args) => {
      logCalls.push(args);
      return 92;
    },
    notifyStub: async (result, options) => {
      notifyCalls.push({ result, options });
      return { sent: true };
    },
  });

  try {
    const activeTimeoutUntil = Date.now() + 60_000;
    const staleSnapshot = {
      id: '123456789012345678',
      roles: { cache: { has: () => false } },
      get communicationDisabledUntilTimestamp() {
        return activeTimeoutUntil;
      },
    };
    const { ctx, templates, warnings, limitState, state } = createContext({
      commandName: 'unmute',
      cleanArgs: ['af'],
      targetConfig: {
        activeTimeoutUntil,
      },
    });
    const stableMember = ctx.target;
    const sequence = [stableMember, stableMember, staleSnapshot, stableMember];
    let index = 0;
    ctx.message.guild.members.fetch = async (id) => {
      if (String(id) !== String(stableMember.id)) return null;
      const next = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return next;
    };

    await command.run(ctx);

    assert.equal(state.communicationDisabledUntilTimestamp, null);
    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(templates[0]?.context?.caseId, '#92');
    assert.equal(warnings.length, 0);
    assert.equal(limitState.committed, 1);
    assert.equal(limitState.rolledBack, 0);
    assert.equal(logCalls.length, 1);
    assert.equal(notifyCalls.length, 1);
  } finally {
    command.restore();
  }
});

test('mute runs successfully without mute_penalty_role settings or scheduler coupling', async () => {
  const command = loadCommandWithMocks('mute');

  try {
    const { ctx, templates, state } = createContext({
      commandName: 'mute',
      cleanArgs: ['10m', 'test'],
    });
    ctx.settings = {};

    await command.run(ctx);

    assert.equal(templates[0]?.templateKey, 'success');
    assert.equal(state.communicationDisabledUntilTimestamp > Date.now(), true);
  } finally {
    command.restore();
  }
});
