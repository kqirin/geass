const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { logDiag, serializeError } = require('../diagnostics');

const stateByGuild = new Map();
const activeConnectionByGuild = new Map();
const operationQueueByGuild = new Map();
const queueDepthByGuild = new Map();
let operationSeq = 0;

function readEnvInt(name, fallback, min = 0) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

const CONNECT_READY_TIMEOUT_MS = readEnvInt('VOICE_CONNECT_READY_TIMEOUT_MS', 20_000, 10_000);
const CONNECT_VERIFY_ATTEMPTS = readEnvInt('VOICE_CONNECT_VERIFY_ATTEMPTS', 4, 1);
const CONNECT_VERIFY_RETRY_DELAY_MS = readEnvInt('VOICE_CONNECT_VERIFY_RETRY_DELAY_MS', 250, 100);
const RECONNECT_WAIT_TIMEOUT_MS = readEnvInt('VOICE_RECONNECT_WAIT_TIMEOUT_MS', 8_000, 2_000);

function traceVoice(event, payload = {}, level = 'INFO') {
  logDiag(`voice.${event}`, payload, level);
}

function isVoiceChannel(channel) {
  return channel && (channel.type === 2 || channel.type === 13);
}

function isConnectionAlive(connection) {
  return Boolean(connection) && connection.state?.status !== VoiceConnectionStatus.Destroyed;
}

function isConnectionReady(connection) {
  return Boolean(connection) && connection.state?.status === VoiceConnectionStatus.Ready;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createVoiceManagerError(code, message, options = {}) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = Number.isInteger(options.httpStatus) ? options.httpStatus : 500;
  if (options.cause) err.cause = options.cause;
  if (options.details && typeof options.details === 'object') err.details = options.details;
  return err;
}

function getTrackedConnection(guildId) {
  const safeGuildId = String(guildId || '');
  return getVoiceConnection(safeGuildId) || activeConnectionByGuild.get(safeGuildId) || null;
}

function buildStatusSnapshot({ guildId, client = null, guild = null, connection = null, trackedState = null, botVoiceChannelId = null }) {
  const safeGuildId = String(guildId || '');
  const resolvedConnection = connection || getTrackedConnection(safeGuildId);
  const resolvedState = trackedState || stateByGuild.get(safeGuildId) || null;
  const resolvedGuild = guild || client?.guilds?.cache?.get(safeGuildId) || null;
  const cachedBotVoiceChannelId = resolvedGuild?.members?.me?.voice?.channelId
    ? String(resolvedGuild.members.me.voice.channelId)
    : null;
  const authoritativeBotVoiceChannelId = botVoiceChannelId
    ? String(botVoiceChannelId)
    : cachedBotVoiceChannelId;
  const joinedChannelId = resolvedConnection?.joinConfig?.channelId
    ? String(resolvedConnection.joinConfig.channelId)
    : null;
  const trackedChannelId = resolvedState?.channelId ? String(resolvedState.channelId) : null;
  const channelId = authoritativeBotVoiceChannelId || joinedChannelId || trackedChannelId || null;

  let channelName = null;
  if (channelId && resolvedGuild?.channels?.cache) {
    const channel = resolvedGuild.channels.cache.get(channelId);
    if (channel) channelName = channel.name;
  }

  const connectionState = resolvedConnection?.state?.status || null;
  const connected =
    Boolean(channelId) &&
    (Boolean(authoritativeBotVoiceChannelId) || isConnectionReady(resolvedConnection));
  const connecting = !connected && Boolean(channelId) && isConnectionAlive(resolvedConnection);

  return {
    connected,
    connecting,
    channelId,
    channelName,
    connectionState,
  };
}

function clearTrackedState(guildId, connection = null, reason = 'unknown') {
  const key = String(guildId || '');
  if (!key) return false;

  const active = activeConnectionByGuild.get(key);
  if (connection && active && active !== connection) return false;

  activeConnectionByGuild.delete(key);
  stateByGuild.delete(key);
  traceVoice('state_cleared', { guildId: key, reason });
  return true;
}

function runGuildOperation(guildId, taskFn) {
  const key = String(guildId || '');
  const nextDepth = Number(queueDepthByGuild.get(key) || 0) + 1;
  queueDepthByGuild.set(key, nextDepth);
  traceVoice('queue_enqueued', {
    guildId: key,
    depth: nextDepth,
    activeGuildQueues: operationQueueByGuild.size,
  });

  const previous = operationQueueByGuild.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(taskFn);
  let queued = null;

  queued = current.finally(() => {
    const currentDepth = Math.max(0, Number(queueDepthByGuild.get(key) || 1) - 1);
    if (currentDepth === 0) queueDepthByGuild.delete(key);
    else queueDepthByGuild.set(key, currentDepth);

    if (operationQueueByGuild.get(key) === queued) {
      operationQueueByGuild.delete(key);
    }

    traceVoice('queue_settled', {
      guildId: key,
      depth: currentDepth,
      activeGuildQueues: operationQueueByGuild.size,
    });
  });
  queued.catch(() => {});

  operationQueueByGuild.set(key, queued);

  return current;
}

function attachConnectionObservers({ guildId, channelId, connection, operationId, context }) {
  connection.on('stateChange', (oldState, newState) => {
    traceVoice('state_change', {
      guildId,
      channelId,
      operationId,
      from: oldState?.status || null,
      to: newState?.status || null,
      context,
    });
  });

  connection.on('error', (err) => {
    traceVoice(
      'connection_error',
      {
        guildId,
        channelId,
        operationId,
        error: serializeError(err),
        context,
      },
      'ERROR'
    );
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (activeConnectionByGuild.get(guildId) !== connection) return;
    clearTrackedState(guildId, connection, 'destroyed_event');
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    traceVoice('disconnected', {
      guildId,
      channelId,
      operationId,
      context,
    });

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_WAIT_TIMEOUT_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_WAIT_TIMEOUT_MS),
        entersState(connection, VoiceConnectionStatus.Ready, RECONNECT_WAIT_TIMEOUT_MS),
      ]);

      traceVoice('reconnect_recovered', {
        guildId,
        channelId,
        operationId,
        context,
      });
    } catch (err) {
      traceVoice(
        'reconnect_failed',
        {
          guildId,
          channelId,
          operationId,
          error: serializeError(err),
          context,
        },
        'WARN'
      );

      if (activeConnectionByGuild.get(guildId) !== connection) return;
      if (connection.state?.status === VoiceConnectionStatus.Ready) {
        traceVoice('reconnect_recovered_late_ready', {
          guildId,
          channelId,
          operationId,
          context,
        });
        return;
      }

      try {
        connection.destroy();
      } catch (destroyErr) {
        traceVoice(
          'destroy_after_disconnect_failed',
          {
            guildId,
            channelId,
            operationId,
            error: serializeError(destroyErr),
          },
          'ERROR'
        );
      }

      clearTrackedState(guildId, connection, 'disconnect_reconnect_failed');
    }
  });
}

async function resolveGuild(client, guildId) {
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

async function resolveGuildChannel(guild, channelId) {
  if (!guild?.channels) return null;
  return guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
}

async function resolveBotVoiceChannelId(guild, options = {}) {
  const forceFetch = Boolean(options.forceFetch);
  const fromCache = guild?.members?.me?.voice?.channelId || null;
  if (!forceFetch && fromCache) return String(fromCache);

  const fromFetch = await guild?.members?.fetchMe?.().catch(() => null);
  if (fromFetch?.voice?.channelId) return String(fromFetch.voice.channelId);
  return fromCache ? String(fromCache) : null;
}

function getConnectionVerification({ guildId, guild, channelId, connection, botVoiceChannelId = null }) {
  const safeGuildId = String(guildId || '');
  const safeChannelId = String(channelId || '');
  const resolvedConnection = connection || getTrackedConnection(safeGuildId);
  const observedBotVoiceChannelId = botVoiceChannelId ? String(botVoiceChannelId) : null;
  const readyByState =
    activeConnectionByGuild.get(safeGuildId) === resolvedConnection &&
    isConnectionReady(resolvedConnection) &&
    String(resolvedConnection?.joinConfig?.channelId || '') === safeChannelId;
  const readyByMemberVoice = observedBotVoiceChannelId === safeChannelId;
  const status = buildStatusSnapshot({
    guildId: safeGuildId,
    guild,
    connection: resolvedConnection,
    botVoiceChannelId: observedBotVoiceChannelId,
  });

  return {
    verified: readyByState || readyByMemberVoice,
    readyByState,
    readyByMemberVoice,
    observedBotVoiceChannelId,
    status,
  };
}

async function verifyConnectedChannel({ guild, guildId, channelId, connection, operationId, context = null, cause = null }) {
  const safeGuildId = String(guildId || '');
  const safeChannelId = String(channelId || '');
  const cachedBotVoiceChannelId = guild?.members?.me?.voice?.channelId || null;

  let verification = getConnectionVerification({
    guildId: safeGuildId,
    guild,
    channelId: safeChannelId,
    connection,
    botVoiceChannelId: cachedBotVoiceChannelId,
  });

  for (let attempt = 1; attempt <= CONNECT_VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await sleep(CONNECT_VERIFY_RETRY_DELAY_MS);
      const observedBotVoiceChannelId = await resolveBotVoiceChannelId(guild, { forceFetch: true });
      verification = getConnectionVerification({
        guildId: safeGuildId,
        guild,
        channelId: safeChannelId,
        connection,
        botVoiceChannelId: observedBotVoiceChannelId,
      });
    }

    if (verification.verified) {
      return {
        ok: true,
        verifyAttempts: attempt,
        ...verification,
      };
    }

    if (attempt < CONNECT_VERIFY_ATTEMPTS) {
      traceVoice(
        'connect_verify_retry',
        {
          guildId: safeGuildId,
          channelId: safeChannelId,
          operationId,
          attempt,
          nextAttempt: attempt + 1,
          delayMs: CONNECT_VERIFY_RETRY_DELAY_MS,
          observedBotVoiceChannelId: verification.observedBotVoiceChannelId,
          connectionState: verification.status.connectionState,
          context,
        },
        'WARN'
      );
    }
  }

  const observedChannelId =
    verification.observedBotVoiceChannelId || verification.status.channelId || null;
  const mismatch = Boolean(observedChannelId) && observedChannelId !== safeChannelId;
  const error = createVoiceManagerError(
    mismatch ? 'VOICE_CONNECT_CHANNEL_MISMATCH' : 'VOICE_CONNECT_VERIFY_FAILED',
    mismatch ? 'Bot hedef ses kanalina baglanamadi' : 'Ses baglantisi dogrulanamadi',
    {
      cause,
      details: {
        guildId: safeGuildId,
        channelId: safeChannelId,
        observedChannelId,
        operationId,
        verifyAttempts: CONNECT_VERIFY_ATTEMPTS,
        connectionState: verification.status.connectionState,
      },
    }
  );

  return {
    ok: false,
    verifyAttempts: CONNECT_VERIFY_ATTEMPTS,
    error,
    ...verification,
  };
}

async function connectInternal({ client, guildId, channelId, selfDeaf = true, context = null }) {
  const safeGuildId = String(guildId || '');
  const safeChannelId = String(channelId || '');
  const operationId = ++operationSeq;
  const previousState = stateByGuild.get(safeGuildId) || {};
  const attempt = Number(previousState.connectAttempts || 0) + 1;

  traceVoice('connect_called', {
    guildId: safeGuildId,
    channelId: safeChannelId,
    operationId,
    attempt,
    context,
  });

  const guild = await resolveGuild(client, safeGuildId);
  if (!guild) {
    throw createVoiceManagerError('VOICE_GUILD_NOT_FOUND', 'Sunucu bulunamadi', {
      httpStatus: 404,
      details: { guildId: safeGuildId, channelId: safeChannelId, operationId },
    });
  }

  const channel = await resolveGuildChannel(guild, safeChannelId);
  if (!channel) {
    throw createVoiceManagerError('VOICE_CHANNEL_NOT_FOUND', 'Kanal bulunamadi', {
      httpStatus: 404,
      details: { guildId: safeGuildId, channelId: safeChannelId, operationId },
    });
  }
  if (!isVoiceChannel(channel)) {
    throw createVoiceManagerError('VOICE_CHANNEL_INVALID_TYPE', 'Bu kanal ses kanali degil', {
      httpStatus: 400,
      details: { guildId: safeGuildId, channelId: safeChannelId, operationId },
    });
  }

  const existing = getTrackedConnection(safeGuildId);
  if (
    isConnectionAlive(existing) &&
    String(existing.joinConfig?.channelId || '') === safeChannelId
  ) {
    const existingBotVoiceChannelId = await resolveBotVoiceChannelId(guild, { forceFetch: true });
    const existingVerification = getConnectionVerification({
      guildId: safeGuildId,
      guild,
      channelId: safeChannelId,
      connection: existing,
      botVoiceChannelId: existingBotVoiceChannelId,
    });

    if (existingVerification.verified) {
      activeConnectionByGuild.set(safeGuildId, existing);
      stateByGuild.set(safeGuildId, {
        ...previousState,
        channelId: safeChannelId,
        operationId,
        connectAttempts: attempt,
        reused: true,
        lastContext: context || previousState.lastContext || null,
        lastJoinRequestedAt: Date.now(),
        lastVerifiedAt: Date.now(),
        lastReadyAt: Date.now(),
        readyFallback: !existingVerification.readyByState,
      });
      traceVoice('connect_reused_existing', {
        guildId: safeGuildId,
        channelId: safeChannelId,
        operationId,
        attempt,
        readyByState: existingVerification.readyByState,
        readyByMemberVoice: existingVerification.readyByMemberVoice,
        context,
      });
      return {
        ok: true,
        reused: true,
        operationId,
        attempt,
        verifyAttempts: 1,
        readyByState: existingVerification.readyByState,
        readyByMemberVoice: existingVerification.readyByMemberVoice,
        fallbackReady: !existingVerification.readyByState,
        status: existingVerification.status,
      };
    }
  }

  if (isConnectionAlive(existing)) {
    traceVoice('connect_replacing_existing', {
      guildId: safeGuildId,
      channelId: safeChannelId,
      operationId,
      previousChannelId: String(existing.joinConfig?.channelId || '') || null,
      context,
    });
    try {
      existing.destroy();
    } catch (err) {
      traceVoice(
        'destroy_existing_failed',
        {
          guildId: safeGuildId,
          operationId,
          error: serializeError(err),
        },
        'WARN'
      );
    }
  }

  const connection = joinVoiceChannel({
    channelId: safeChannelId,
    guildId: safeGuildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf,
  });

  activeConnectionByGuild.set(safeGuildId, connection);
  stateByGuild.set(safeGuildId, {
    ...previousState,
    channelId: safeChannelId,
    operationId,
    connectAttempts: attempt,
    reused: false,
    lastContext: context || null,
    lastJoinRequestedAt: Date.now(),
  });

  attachConnectionObservers({
    guildId: safeGuildId,
    channelId: safeChannelId,
    connection,
    operationId,
    context,
  });

  let readyError = null;
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_READY_TIMEOUT_MS);
  } catch (err) {
    readyError = err;
  }

  const verification = await verifyConnectedChannel({
    guild,
    guildId: safeGuildId,
    channelId: safeChannelId,
    connection,
    operationId,
    context,
    cause: readyError,
  });

  if (verification.ok) {
    if (activeConnectionByGuild.get(safeGuildId) !== connection) {
      traceVoice('connect_ready_ignored_stale', {
        guildId: safeGuildId,
        channelId: safeChannelId,
        operationId,
      });
      return {
        ok: true,
        stale: true,
        operationId,
        attempt,
        verifyAttempts: verification.verifyAttempts,
        status: verification.status,
      };
    }

    const cur = stateByGuild.get(safeGuildId) || {};
    stateByGuild.set(safeGuildId, {
      ...cur,
      channelId: safeChannelId,
      operationId,
      connectAttempts: attempt,
      lastReadyAt: Date.now(),
      lastVerifiedAt: Date.now(),
      readyFallback: Boolean(readyError) || !verification.readyByState,
    });

    traceVoice(
      readyError || verification.verifyAttempts > 1 || !verification.readyByState
        ? 'connect_ready_fallback'
        : 'connect_ready',
      {
        guildId: safeGuildId,
        channelId: safeChannelId,
        operationId,
        attempt,
        verifyAttempts: verification.verifyAttempts,
        readyByState: verification.readyByState,
        readyByMemberVoice: verification.readyByMemberVoice,
        observedBotVoiceChannelId: verification.observedBotVoiceChannelId,
        readyError: readyError ? serializeError(readyError) : null,
        context,
      },
      readyError || verification.verifyAttempts > 1 || !verification.readyByState ? 'WARN' : 'INFO'
    );

    return {
      ok: true,
      operationId,
      attempt,
      verifyAttempts: verification.verifyAttempts,
      readyByState: verification.readyByState,
      readyByMemberVoice: verification.readyByMemberVoice,
      fallbackReady: Boolean(readyError) || !verification.readyByState,
      status: verification.status,
    };
  }

  traceVoice(
    'connect_failed',
    {
      guildId: safeGuildId,
      channelId: safeChannelId,
      operationId,
      attempt,
      error: serializeError(verification.error),
      readyError: readyError ? serializeError(readyError) : null,
      observedBotVoiceChannelId: verification.observedBotVoiceChannelId,
      verifyAttempts: verification.verifyAttempts,
      connectionState: verification.status.connectionState,
      context,
    },
    'ERROR'
  );

  if (activeConnectionByGuild.get(safeGuildId) === connection) {
    try {
      connection.destroy();
    } catch (destroyErr) {
      traceVoice(
        'destroy_after_connect_failure_failed',
        {
          guildId: safeGuildId,
          channelId: safeChannelId,
          operationId,
          error: serializeError(destroyErr),
        },
        'ERROR'
      );
    }
    clearTrackedState(safeGuildId, connection, 'connect_verify_failed');
  }

  throw verification.error;
}

async function disconnectInternal({ guildId, context = null }) {
  const safeGuildId = String(guildId || '');
  const operationId = ++operationSeq;
  traceVoice('disconnect_called', {
    guildId: safeGuildId,
    operationId,
    context,
  });

  const connection = getTrackedConnection(safeGuildId);
  if (isConnectionAlive(connection)) {
    try {
      connection.destroy();
    } catch (err) {
      traceVoice(
        'disconnect_destroy_failed',
        {
          guildId: safeGuildId,
          operationId,
          error: serializeError(err),
          context,
        },
        'ERROR'
      );
    }
  }

  clearTrackedState(safeGuildId, null, 'disconnect_call');
  return { ok: true, operationId };
}

function getStatus(guildId, client) {
  const safeGuildId = String(guildId || '');
  const status = buildStatusSnapshot({ guildId: safeGuildId, client });

  if (!status.connected && !status.connecting) {
    clearTrackedState(safeGuildId, null, 'status_not_connected');
  }

  return {
    connected: status.connected,
    connecting: status.connecting,
    channelId: status.channelId,
    channelName: status.channelName,
    connectionState: status.connectionState,
  };
}

async function connectToChannel({ client, guildId, channelId, selfDeaf = true, context = null }) {
  return runGuildOperation(guildId, () =>
    connectInternal({ client, guildId, channelId, selfDeaf, context })
  );
}

async function disconnect({ guildId, context = null }) {
  return runGuildOperation(guildId, () => disconnectInternal({ guildId, context }));
}

module.exports = {
  getStatus,
  connectToChannel,
  disconnect,
  __internal: {
    reset() {
      for (const queue of operationQueueByGuild.values()) {
        queue.catch(() => {});
      }
      stateByGuild.clear();
      activeConnectionByGuild.clear();
      operationQueueByGuild.clear();
      queueDepthByGuild.clear();
      operationSeq = 0;
    },
    getState(guildId) {
      return stateByGuild.get(String(guildId || '')) || null;
    },
    getQueueSize() {
      return operationQueueByGuild.size;
    },
    getQueueDepth(guildId) {
      return Number(queueDepthByGuild.get(String(guildId || '')) || 0);
    },
    getActiveConnection(guildId) {
      return activeConnectionByGuild.get(String(guildId || '')) || null;
    },
  },
};
