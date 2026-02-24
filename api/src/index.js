const db = require('./database');
const cache = require('./utils/cache');
const moderationBot = require('./bot/moderation');
const { registerActionListener } = require('./bot/moderation.logs');
const penaltyScheduler = require('./bot/penaltyScheduler');
const { createWeeklyStaffTracker } = require('./application/weeklyStaff/tracker');
const { createWeeklyStaffScheduler } = require('./application/weeklyStaff/scheduler');
const { createReactionActionService } = require('./application/reactionActions/service');
const { createTagRoleFeature } = require('./features/tagRole');
const { runMigrations } = require('./migrations');
const { config } = require('./config');

const { logSystem, logError } = require('./logger');
const { createDiscordClient } = require('./discordClient');
const { createHttpApp } = require('./httpApp');
const { createPrivateRoomService } = require('./voice/privateRoomService');
const { validateConfig } = require('./bootstrap/validateConfig');
const { withRetry, isTransientError } = require('./utils/retry');

const BOT_INSTANCE_LOCK_NAME = 'auri_discord_gateway_lock';

async function acquireBotInstanceLock() {
  const lockConn = await db.getConnection();
  try {
    const [rows] = await lockConn.query('SELECT GET_LOCK(?, 0) AS acquired', [BOT_INSTANCE_LOCK_NAME]);
    const acquired = Number(rows?.[0]?.acquired || 0) === 1;
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

async function releaseBotInstanceLock(lockConn, logError = () => {}) {
  if (!lockConn) return;
  try {
    await lockConn.query('SELECT RELEASE_LOCK(?)', [BOT_INSTANCE_LOCK_NAME]);
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

async function main() {
  validateConfig(logSystem, logError);
  await withRetry(
    'run_migrations',
    () => runMigrations(logSystem, logError),
    buildStartupRetryOptions(logSystem, logError, {
      attempts: 4,
      baseDelayMs: 500,
      maxDelayMs: 4000,
    })
  );

  let weeklyStaffTracker = null;
  let weeklyStaffScheduler = null;
  let reactionActionService = null;
  let tagRoleFeature = null;
  let privateRoomService = null;

  const getTagRoleConfig = (guildId) => {
    const settings = cache.getSettings(guildId) || {};
    return {
      enabled: settings.tag_enabled === true || settings.tag_enabled === 1 || settings.tag_enabled === '1',
      roleId: String(settings.tag_role || '').trim(),
    };
  };

  const client = createDiscordClient({
    cache,
    moderationBot,
    getWeeklyStaffTracker: () => weeklyStaffTracker,
    getReactionActionService: () => reactionActionService,
    getTagRoleFeature: () => tagRoleFeature,
    getPrivateRoomService: () => privateRoomService,
    logSystem,
    logError,
  });
  privateRoomService = createPrivateRoomService({ client, logSystem, logError });
  weeklyStaffTracker = createWeeklyStaffTracker({ client, logError });
  weeklyStaffScheduler = createWeeklyStaffScheduler({ client, logSystem, logError });
  reactionActionService = createReactionActionService({ client, logSystem, logError });
  tagRoleFeature = createTagRoleFeature({
    client,
    getTagRoleConfig,
    logSystem,
    logError,
    targetGuildId: config.discord.targetGuildId || null,
  });
  moderationBot.setWeeklyStaffTracker(weeklyStaffTracker);

  registerActionListener((event) => {
    weeklyStaffTracker
      .trackEvent({
        guildId: event.guildId,
        userId: event.moderatorId,
        eventType: event.action,
        commandName: event.action,
        occurredAt: Date.now(),
        metadata: { caseId: event.caseId },
      })
      .catch((err) => logError('weekly_staff_action_track_failed', err));
  });

  const app = createHttpApp({
    client,
    weeklyStaffScheduler,
    reactionActionService,
    tagRoleFeature,
    privateRoomService,
    logSystem,
    logError,
  });

  const port = config.port;
  let server = null;
  let botInstanceLockConn = await withRetry(
    'acquire_bot_instance_lock',
    acquireBotInstanceLock,
    buildStartupRetryOptions(logSystem, logError, {
      attempts: 3,
      baseDelayMs: 400,
      maxDelayMs: 2000,
    })
  );
  if (!botInstanceLockConn) {
    throw new Error(`${BOT_INSTANCE_LOCK_NAME}_not_acquired`);
  }
  logSystem('Bot instance lock alindi', 'INFO');

  let shuttingDown = false;
  async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
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
      weeklyStaffScheduler?.stop();
    } catch (err) {
      logError('weekly_staff_scheduler_shutdown_failed', err);
    }
    try {
      privateRoomService?.shutdown();
    } catch (err) {
      logError('private_room_scheduler_shutdown_failed', err);
    }

    try {
      await client.destroy();
    } catch (err) {
      logError('discord_client_shutdown_failed', err);
    }
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

    process.exit(exitCode);
  }

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logError('unhandled_rejection', err);
    shutdown('unhandledRejection', 1).catch((shutdownErr) => {
      logError('unhandled_rejection_shutdown_failed', shutdownErr);
      process.exit(1);
    });
  });
  process.on('uncaughtException', (err) => {
    logError('uncaught_exception', err);
    shutdown('uncaughtException', 1).catch((shutdownErr) => {
      logError('uncaught_exception_shutdown_failed', shutdownErr);
      process.exit(1);
    });
  });

  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));

  await client.login(config.discord.token);
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
  weeklyStaffScheduler.start();
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
  logSystem('Weekly staff scheduler hazir', 'INFO');

  server = app.listen(port, () => logSystem(`Web API: ${port} portunda hazir.`, 'INFO'));
}

main().catch((err) => {
  logError('startup_failed', err);
  process.exit(1);
});

