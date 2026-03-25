const db = require('./database');
const cache = require('./utils/cache');
const moderationBot = require('./bot/moderation');
const penaltyScheduler = require('./bot/penaltyScheduler');
const { createReactionActionService } = require('./application/reactionActions/service');
const { createTagRoleFeature } = require('./features/tagRole');
const { runMigrations } = require('./migrations');
const { config } = require('./config');

const { logSystem, logError } = require('./logger');
const { createDiscordClient } = require('./discordClient');
const { createHttpApp } = require('./httpApp');
const { createPrivateRoomService } = require('./voice/privateRoomService');
const { createBotPresenceManager } = require('./bot/presenceManager');
const { validateConfig } = require('./bootstrap/validateConfig');
const { validateStaticConfig } = require('./bootstrap/validateStaticConfig');
const { getTagRoleConfig } = require('./config/static');
const { withRetry, isTransientError } = require('./utils/retry');
const {
  isDiagModeEnabled,
  logDiag,
  serializeError,
  installTimerRegistry,
  logTimerRegistryReport,
  createListenerLeakWatcher,
} = require('./diagnostics');
const perfMonitor = require('./utils/perfMonitor');

const BOT_INSTANCE_LOCK_NAME = 'auri_discord_gateway_lock';
const PG_LOCK_KEY_SQL = "('x' || substr(md5(?), 1, 16))::bit(64)::bigint";
let startupPhase = 'bootstrap_init';

function setStartupPhase(phase, logSystem = () => {}) {
  startupPhase = String(phase || 'unknown_phase');
  logSystem(`startup_phase=${startupPhase}`, 'INFO');
}

async function acquireBotInstanceLock() {
  const lockConn = await db.getConnection();
  try {
    const [rows] = await lockConn.query(`SELECT pg_try_advisory_lock(${PG_LOCK_KEY_SQL}) AS acquired`, [
      BOT_INSTANCE_LOCK_NAME,
    ]);
    const acquired = rows?.[0]?.acquired === true;
    if (!acquired) {
      lockConn.release();
      return null;
    }
    return lockConn;
  } catch (err) {
    lockConn.release();
    throw err;
  }
}

async function releaseBotInstanceLock(lockConn, logError = () => { }) {
  if (!lockConn) return;
  try {
    await lockConn.query(`SELECT pg_advisory_unlock(${PG_LOCK_KEY_SQL})`, [BOT_INSTANCE_LOCK_NAME]);
  } catch (err) {
    logError('bot_instance_lock_release_failed', err, { lockName: BOT_INSTANCE_LOCK_NAME });
  }
  try {
    lockConn.release();
  } catch (err) {
    logError('bot_instance_lock_connection_release_failed', err, { lockName: BOT_INSTANCE_LOCK_NAME });
  }
}

function buildStartupRetryOptions(logSystem, logError, { attempts, baseDelayMs, maxDelayMs }) {
  return {
    attempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio: 0.2,
    shouldRetry: isTransientError,
    onRetry: ({ taskName, attempt, attempts: totalAttempts, delayMs, code }) => {
      const nextAttempt = Math.min(attempt + 1, totalAttempts);
      logSystem(
        `${taskName} yeniden denenecek (sonraki deneme ${nextAttempt}/${totalAttempts}), ${delayMs}ms sonra [${String(
          code || 'unknown'
        )}]`,
        'WARN'
      );
    },
    onFinalFailure: ({ taskName, attempt, attempts: totalAttempts, err, code, retryable }) => {
      logError('startup_retry_exhausted', err, {
        feature: 'startup',
        action: taskName,
        attempt,
        attempts: totalAttempts,
        code: code || 'unknown',
        retryable: Boolean(retryable),
      });
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt, { baseDelayMs = 1000, maxDelayMs = 30_000, jitterRatio = 0.2 } = {}) {
  const exp = Math.min(Math.max(Number(attempt || 1) - 1, 0), 8);
  const base = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exp));
  const ratio = Math.min(Math.max(Number(jitterRatio) || 0, 0), 1);
  if (!ratio) return Math.round(base);
  const jitter = (Math.random() * 2 - 1) * base * ratio;
  return Math.max(0, Math.round(base + jitter));
}

async function waitForStartupGate(
  taskName,
  fn,
  logSystem = () => {},
  logError = () => {},
  { baseDelayMs = 1500, maxDelayMs = 30_000, jitterRatio = 0.2 } = {}
) {
  let attempt = 0;
  while (true) {
    try {
      const result = await fn();
      if (attempt > 0) {
        logSystem(`${taskName} basarili (toplam deneme: ${attempt + 1})`, 'INFO');
      }
      return result;
    } catch (err) {
      attempt += 1;
      const delayMs = computeBackoffMs(attempt, { baseDelayMs, maxDelayMs, jitterRatio });
      logError('startup_retry_scheduled', err, {
        feature: 'startup',
        action: taskName,
        attempt,
        nextRetryMs: delayMs,
        code: err?.code || 'unknown',
      });
      logSystem(`${taskName} gecici olarak basarisiz. ${delayMs}ms sonra tekrar denenecek.`, 'WARN');
      await sleep(delayMs);
    }
  }
}

function buildProcessDiagContext(extra = {}) {
  const memory = process.memoryUsage?.() || {};
  return {
    pid: process.pid,
    ppid: process.ppid,
    uptimeSec: Number(process.uptime().toFixed(3)),
    memory: {
      rss: Number(memory.rss || 0),
      heapTotal: Number(memory.heapTotal || 0),
      heapUsed: Number(memory.heapUsed || 0),
      external: Number(memory.external || 0),
    },
    ...extra,
  };
}

async function main() {
  setStartupPhase('main_entered', logSystem);
  perfMonitor.start();

  const diagEnabled = isDiagModeEnabled();
  if (diagEnabled) {
    installTimerRegistry();
  }

  const diagLeakWatchers = [];
  if (diagEnabled) {
    diagLeakWatchers.push(
      createListenerLeakWatcher({
        emitter: process,
        name: 'process',
        threshold: 25,
        intervalMs: 30_000,
      })
    );
  }

  setStartupPhase('config_validate', logSystem);
  validateConfig(logSystem, logError);
  setStartupPhase('db_migrations', logSystem);
  await waitForStartupGate(
    'run_migrations',
    () => runMigrations(logSystem, logError),
    logSystem,
    logError,
    { baseDelayMs: 1000, maxDelayMs: 30_000, jitterRatio: 0.2 }
  );

  let reactionActionService = null;
  let tagRoleFeature = null;
  let privateRoomService = null;
  let botPresenceManager = null;

  const client = createDiscordClient({
    cache,
    moderationBot,
    getReactionActionService: () => reactionActionService,
    getTagRoleFeature: () => tagRoleFeature,
    getPrivateRoomService: () => privateRoomService,
    getBotPresenceManager: () => botPresenceManager,
    logSystem,
    logError,
  });
  if (diagEnabled) {
    diagLeakWatchers.push(
      createListenerLeakWatcher({
        emitter: client,
        name: 'discord_client',
        threshold: 25,
        intervalMs: 30_000,
      })
    );
  }
  botPresenceManager = createBotPresenceManager({ client, logSystem, logError });
  privateRoomService = createPrivateRoomService({ client, logSystem, logError });
  reactionActionService = createReactionActionService({ client, logSystem, logError });
  tagRoleFeature = createTagRoleFeature({
    client,
    getTagRoleConfig,
    logSystem,
    logError,
    targetGuildId: config.discord.targetGuildId || null,
  });

  const app = createHttpApp({
    client,
    moderationBot,
    reactionActionService,
    tagRoleFeature,
    privateRoomService,
    botPresenceManager,
    logSystem,
    logError,
  });

  const port = config.port;
  let server = null;
  setStartupPhase('bot_instance_lock_acquire', logSystem);
  let botInstanceLockConn = await waitForStartupGate(
    'acquire_bot_instance_lock',
    async () => {
      const lock = await acquireBotInstanceLock();
      if (lock) return lock;
      const err = new Error(`${BOT_INSTANCE_LOCK_NAME}_not_acquired`);
      err.code = 'BOT_INSTANCE_LOCK_NOT_ACQUIRED';
      throw err;
    },
    logSystem,
    logError,
    { baseDelayMs: 1500, maxDelayMs: 20_000, jitterRatio: 0.2 }
  );
  logSystem('Bot instance lock alindi', 'INFO');

  let shuttingDown = false;
  async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logDiag('process.shutdown_start', buildProcessDiagContext({ signal, exitCode }), 'WARN');
    logSystem(`Kapanis sinyali alindi: ${signal}`, 'INFO');

    if (server) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        server.close(() => {
          logSystem('HTTP server kapatildi', 'INFO');
          finish();
        });

        setTimeout(finish, 5000).unref();
      });
    }

    try {
      penaltyScheduler.shutdown();
    } catch (err) {
      logError('penalty_scheduler_shutdown_failed', err);
    }
    try {
      privateRoomService?.shutdown();
    } catch (err) {
      logError('private_room_scheduler_shutdown_failed', err);
    }
    try {
      botPresenceManager?.shutdown?.();
    } catch (err) {
      logError('bot_presence_shutdown_failed', err);
    }

    try {
      await client.destroy();
    } catch (err) {
      logError('discord_client_shutdown_failed', err);
    }

    for (const watcher of diagLeakWatchers) {
      try {
        watcher?.stop?.('shutdown');
      } catch (err) {
        logError('diag_listener_watcher_shutdown_failed', err);
      }
    }

    logTimerRegistryReport('shutdown');

    await releaseBotInstanceLock(botInstanceLockConn, logError);
    botInstanceLockConn = null;

    try {
      await db.end();
    } catch (err) {
      logError('db_shutdown_failed', err);
    }

    if (exitCode !== 0) {
      logSystem('Process non-zero kod ile cikiyor. PM2/systemd/docker restart policy aktif olmali.', 'WARN');
    }

    logDiag('process.shutdown_exit', buildProcessDiagContext({ signal, exitCode }), exitCode === 0 ? 'INFO' : 'ERROR');
    process.exit(exitCode);
  }

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logDiag(
      'process.unhandled_rejection',
      buildProcessDiagContext({
        reasonType: typeof reason,
        reason: serializeError(err),
      }),
      'ERROR'
    );
    logError('unhandled_rejection', err);
    shutdown('unhandledRejection', 1).catch((shutdownErr) => {
      logError('unhandled_rejection_shutdown_failed', shutdownErr);
      process.exit(1);
    });
  });
  process.on('uncaughtException', (err) => {
    logDiag(
      'process.uncaught_exception',
      buildProcessDiagContext({
        error: serializeError(err),
      }),
      'ERROR'
    );
    logError('uncaught_exception', err);
    shutdown('uncaughtException', 1).catch((shutdownErr) => {
      logError('uncaught_exception_shutdown_failed', shutdownErr);
      process.exit(1);
    });
  });

  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));

  setStartupPhase('discord_login', logSystem);
  try {
    await client.login(config.discord.token);
  } catch (err) {
    logError('discord_login_failed', err, {
      phase: startupPhase,
      tokenConfigured: Boolean(config.discord.token),
      tokenLength: String(config.discord.token || '').length,
    });
    throw err;
  }
  setStartupPhase('static_config_validate', logSystem);
  await withRetry(
    'static_config_validate',
    () => validateStaticConfig(client, logSystem, logError),
    buildStartupRetryOptions(logSystem, logError, {
      attempts: 3,
      baseDelayMs: 700,
      maxDelayMs: 4000,
    })
  );
  try {
    const loaded = await withRetry(
      'penalty_scheduler_bootstrap',
      () => penaltyScheduler.bootstrap(client, logError),
      buildStartupRetryOptions(logSystem, logError, {
        attempts: 4,
        baseDelayMs: 500,
        maxDelayMs: 5000,
      })
    );
    logSystem(`Timed penalty scheduler hazir: ${loaded} aktif kayit`, 'INFO');
  } catch (err) {
    logError('penalty_scheduler_bootstrap_failed', err);
  }
  try {
    const loadedPrivateRooms = await withRetry(
      'private_room_bootstrap',
      () => privateRoomService.bootstrap(),
      buildStartupRetryOptions(logSystem, logError, {
        attempts: 4,
        baseDelayMs: 500,
        maxDelayMs: 5000,
      })
    );
    logSystem(`Ozel oda servisi hazir: ${loadedPrivateRooms} aktif oda`, 'INFO');
  } catch (err) {
    logError('private_room_bootstrap_failed', err);
  }
  await withRetry(
    'reaction_action_refresh_all_rules',
    () => reactionActionService.refreshAllRules(),
    buildStartupRetryOptions(logSystem, logError, {
      attempts: 4,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    })
  ).catch((err) => {
    logError('reaction_action_refresh_all_rules_failed', err);
  });
  await withRetry(
    'tag_role_startup_sync',
    () => tagRoleFeature.syncAllGuilds('startup'),
    buildStartupRetryOptions(logSystem, logError, {
      attempts: 3,
      baseDelayMs: 700,
      maxDelayMs: 4000,
    })
  ).catch((err) => {
    logError('tag_role_startup_sync_failed', err);
  });
  logSystem('Reaction actions servisi hazir', 'INFO');
  logSystem('Tag role feature hazir', 'INFO');

  setStartupPhase('http_listen', logSystem);
  server = app.listen(port, () => logSystem(`Web API: ${port} portunda hazir.`, 'INFO'));
  setStartupPhase('startup_completed', logSystem);
}

main().catch((err) => {
  logError('startup_failed', err, {
    phase: startupPhase,
    tokenConfigured: Boolean(config.discord.token),
    tokenLength: String(config.discord.token || '').length,
  });
  process.exit(1);
});

