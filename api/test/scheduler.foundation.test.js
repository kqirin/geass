const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createJobScheduler,
  buildKeyedJobKey,
} = require('../src/scheduler');
const {
  createSessionRepositoryFromStateStore,
} = require('../src/controlPlane/sessionRepository');
const {
  createOauthStateStoreFromStateStore,
} = require('../src/controlPlane/oauthStateStore');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(predicate, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function createMockRedisClient({ shouldFailConnect = false } = {}) {
  const entries = new Map();

  function readEntry(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    const expiresAtMs = Number(entry.expiresAtMs || 0);
    if (expiresAtMs > 0 && expiresAtMs <= Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  return {
    on: () => {},
    connect: async () => {
      if (!shouldFailConnect) return;
      const error = new Error('connect_failed');
      error.reasonCode = 'redis_connect_failed';
      throw error;
    },
    set: async (key, value, options = {}) => {
      const ttlMs = Number(options?.PX || 0);
      entries.set(key, {
        value,
        expiresAtMs: Number.isFinite(ttlMs) && ttlMs > 0 ? Date.now() + ttlMs : null,
      });
      return 'OK';
    },
    get: async (key) => readEntry(key)?.value || null,
    del: async (key) => (entries.delete(key) ? 1 : 0),
    sendCommand: async (command = []) => {
      const action = String(command[0] || '').toUpperCase();
      const key = String(command[1] || '');
      if (action !== 'GETDEL') throw new Error('unsupported_command');
      const value = await readEntry(key)?.value || null;
      entries.delete(key);
      return value;
    },
    multi: () => {
      const operations = [];
      const chain = {
        get(key) {
          operations.push(['get', key]);
          return chain;
        },
        del(key) {
          operations.push(['del', key]);
          return chain;
        },
        async exec() {
          const output = [];
          for (const [op, key] of operations) {
            if (op === 'get') {
              output.push(await readEntry(key)?.value || null);
              continue;
            }
            if (op === 'del') {
              output.push(entries.delete(key) ? 1 : 0);
            }
          }
          return output;
        },
      };
      return chain;
    },
    quit: async () => {},
    disconnect: async () => {},
  };
}

function createNonTtlStateStore() {
  const entries = new Map();
  return {
    entries,
    async set(key, value) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return false;
      entries.set(normalizedKey, value);
      return true;
    },
    async get(key) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return null;
      return entries.has(normalizedKey) ? entries.get(normalizedKey) : null;
    },
    async delete(key) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return false;
      return entries.delete(normalizedKey);
    },
    async getAndDelete(key) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return null;
      const value = entries.has(normalizedKey) ? entries.get(normalizedKey) : null;
      entries.delete(normalizedKey);
      return value;
    },
  };
}

test('memory scheduler supports dedupe, replace, cancel, and keyed job identity', async () => {
  const scheduler = createJobScheduler({
    schedulerConfig: {
      enabled: true,
      provider: 'memory',
      adoption: {
        authExpiryCleanupEnabled: false,
      },
    },
  });

  try {
    const executions = [];
    const jobKey = buildKeyedJobKey(['guild:1', 'session:abc']);
    assert.equal(jobKey, 'guild:1|session:abc');

    const first = await scheduler.scheduleDelayedJob({
      jobName: 'unit_cleanup_job',
      jobKey,
      delayMs: 80,
      handler: async () => {
        executions.push('first');
      },
    });
    assert.equal(first.ok, true);
    assert.equal(first.accepted, true);

    const duplicate = await scheduler.scheduleDelayedJob({
      jobName: 'unit_cleanup_job',
      jobKey,
      delayMs: 20,
      handler: async () => {
        executions.push('duplicate');
      },
    });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.reasonCode, 'job_already_exists');

    const replacement = await scheduler.replaceDelayedJob({
      jobName: 'unit_cleanup_job',
      jobKey,
      delayMs: 20,
      handler: async () => {
        executions.push('replacement');
      },
    });
    assert.equal(replacement.ok, true);
    assert.equal(replacement.accepted, true);

    const replacedExecuted = await waitForCondition(() => executions.length === 1, {
      timeoutMs: 400,
      intervalMs: 10,
    });
    assert.equal(replacedExecuted, true);
    assert.deepEqual(executions, ['replacement']);

    await scheduler.scheduleDelayedJob({
      jobName: 'unit_cleanup_job',
      jobKey: 'cancel-target',
      delayMs: 80,
      handler: async () => {
        executions.push('cancel-target');
      },
    });
    const cancelled = await scheduler.cancelJob({
      jobName: 'unit_cleanup_job',
      jobKey: 'cancel-target',
    });
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.cancelled, true);

    await sleep(120);
    assert.equal(executions.includes('cancel-target'), false);
  } finally {
    await scheduler.close();
  }
});

test('scheduler retry model re-runs failed jobs until success or max attempts', async () => {
  const scheduler = createJobScheduler({
    schedulerConfig: {
      enabled: true,
      provider: 'memory',
    },
  });

  try {
    let attempts = 0;
    const scheduled = await scheduler.scheduleDelayedJob({
      jobName: 'retry_ready_job',
      jobKey: 'alpha',
      delayMs: 10,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 15,
        maxDelayMs: 15,
        backoff: 'fixed',
      },
      handler: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('temporary_failure');
          error.reasonCode = 'temporary_failure';
          throw error;
        }
      },
    });
    assert.equal(scheduled.ok, true);
    assert.equal(scheduled.accepted, true);

    const reachedExpectedAttempts = await waitForCondition(() => attempts === 3, {
      timeoutMs: 1000,
      intervalMs: 10,
    });
    assert.equal(reachedExpectedAttempts, true);

    const status = await scheduler.getJobStatus({
      jobName: 'retry_ready_job',
      jobKey: 'alpha',
    });
    assert.equal(status.exists, false);

    const summary = scheduler.getSummary();
    assert.equal(summary.scheduler.enabled, true);
    const retryEntries = summary.recentJobs.filter(
      (entry) => entry.jobName === 'retry_ready_job' && entry.jobKey === 'alpha'
    );
    assert.equal(retryEntries.length > 0, true);
    const latestRetryEntry = retryEntries[retryEntries.length - 1];
    assert.equal(latestRetryEntry.status, 'succeeded');
    assert.equal(latestRetryEntry.attempts, 3);
  } finally {
    await scheduler.close();
  }
});

test('hardened scheduler backend runs with explicit memory fallback when redis connect fails', async () => {
  const scheduler = createJobScheduler({
    schedulerConfig: {
      enabled: true,
      provider: 'hardened',
      fallbackToMemory: true,
      adoption: {
        authExpiryCleanupEnabled: true,
      },
      hardened: {
        redis: {
          url: 'redis://scheduler-unavailable.local:6379',
          keyPrefix: 'cp:scheduler:test',
          fallbackToMemory: true,
        },
      },
    },
    sharedStateRedisClientFactory: () =>
      createMockRedisClient({ shouldFailConnect: true }),
  });

  try {
    let ran = false;
    const scheduled = await scheduler.scheduleDelayedJob({
      jobName: 'hardened_mode_job',
      jobKey: 'fallback-check',
      delayMs: 10,
      handler: async () => {
        ran = true;
      },
    });
    assert.equal(scheduled.ok, true);
    assert.equal(scheduled.accepted, true);

    const executed = await waitForCondition(() => ran === true, {
      timeoutMs: 500,
      intervalMs: 10,
    });
    assert.equal(executed, true);

    const summary = scheduler.getSummary();
    assert.equal(summary.scheduler.enabled, true);
    assert.equal(summary.scheduler.requestedProvider, 'hardened');
    assert.equal(summary.scheduler.activeProvider, 'hardened');
    assert.equal(summary.scheduler.hardened.activeStoreProvider, 'memory');
    assert.equal(summary.scheduler.hardened.fallbackUsed, true);
    assert.equal(summary.scheduler.hardened.reasonCode, 'redis_connect_failed');
    assert.equal(
      summary.scheduler.adoption.authExpiryCleanupEnabled,
      true
    );
  } finally {
    await scheduler.close();
  }
});

test('auth session and oauth state stores can opt into scheduler-driven expiry cleanup', async () => {
  const scheduler = createJobScheduler({
    schedulerConfig: {
      enabled: true,
      provider: 'memory',
      adoption: {
        authExpiryCleanupEnabled: true,
      },
    },
  });

  try {
    const stateStore = createNonTtlStateStore();
    const randomBytesFn = () => Buffer.alloc(24, 4);

    const sessionRepository = createSessionRepositoryFromStateStore({
      stateStore,
      sessionTtlMs: 30,
      randomBytesFn,
      expiryScheduler: scheduler,
      enableScheduledExpiryCleanup: true,
    });
    const session = await sessionRepository.createSession({
      principal: { type: 'discord_user', id: '100', provider: 'discord_oauth' },
    });
    const sessionKey = `auth:session:${session.id}`;
    assert.equal(Boolean(await stateStore.get(sessionKey)), true);

    const oauthStateStore = createOauthStateStoreFromStateStore({
      stateStore,
      stateTtlMs: 30,
      randomBytesFn,
      expiryScheduler: scheduler,
      enableScheduledExpiryCleanup: true,
    });
    const oauthState = await oauthStateStore.createState();
    const oauthStateKey = `auth:oauth-state:${oauthState.state}`;
    assert.equal(Boolean(await stateStore.get(oauthStateKey)), true);

    await sleep(120);
    assert.equal(await stateStore.get(sessionKey), null);
    assert.equal(await stateStore.get(oauthStateKey), null);
  } finally {
    await scheduler.close();
  }
});
