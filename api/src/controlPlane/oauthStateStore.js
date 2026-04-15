const crypto = require('node:crypto');
const { createMemoryKeyValueStore } = require('../sharedState/memoryStore');

function createOauthStateStoreError(reasonCode = 'oauth_state_store_unavailable', cause = null) {
  const error = new Error(String(reasonCode || 'oauth_state_store_unavailable'));
  error.name = 'OauthStateStoreError';
  error.reasonCode = String(reasonCode || 'oauth_state_store_unavailable');
  if (cause) error.cause = cause;
  return error;
}

function buildOauthStateKey(state = '') {
  const normalizedState = String(state || '').trim();
  if (!normalizedState) return null;
  return `auth:oauth-state:${normalizedState}`;
}

const OAUTH_STATE_EXPIRY_CLEANUP_JOB_NAME = 'control_plane_oauth_state_expiry_cleanup';

function resolveExpiryScheduler(expiryScheduler = null) {
  const scheduler =
    expiryScheduler && typeof expiryScheduler === 'object'
      ? expiryScheduler
      : null;
  if (
    !scheduler ||
    typeof scheduler.scheduleDelayedJob !== 'function' ||
    typeof scheduler.replaceDelayedJob !== 'function' ||
    typeof scheduler.cancelJob !== 'function'
  ) {
    return null;
  }
  return scheduler;
}

function toStoredOauthStateRecord(rawValue = null) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return {
      createdAtMs: Number(rawValue.createdAtMs || 0),
      expiresAtMs: Number(rawValue.expiresAtMs || 0),
    };
  }

  try {
    const parsed = JSON.parse(String(rawValue || ''));
    return toStoredOauthStateRecord(parsed);
  } catch {
    return null;
  }
}

function createOauthStateStoreFromStateStore({
  stateStore = null,
  stateTtlMs = 10 * 60 * 1000,
  nowFn = Date.now,
  randomBytesFn = crypto.randomBytes,
  expiryScheduler = null,
  enableScheduledExpiryCleanup = false,
} = {}) {
  const store = stateStore && typeof stateStore === 'object' ? stateStore : null;
  const scheduler = resolveExpiryScheduler(expiryScheduler);
  const schedulerEnabled = Boolean(enableScheduledExpiryCleanup && scheduler);

  function nowMs() {
    const current = Number(nowFn());
    return Number.isFinite(current) ? current : Date.now();
  }

  function resolveStateTtlMs() {
    const ttlMs = Number(stateTtlMs);
    return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 10 * 60 * 1000;
  }

  async function scheduleStateExpiry({ state = null, expiresAtMs = 0 } = {}) {
    if (!schedulerEnabled || !state) return;
    const delayMs = Math.max(0, Number(expiresAtMs || 0) - nowMs());
    try {
      await scheduler.replaceDelayedJob({
        jobName: OAUTH_STATE_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(state || ''),
        delayMs,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 2_500,
          maxDelayMs: 30_000,
          backoff: 'exponential',
        },
        metadata: {
          domain: 'control_plane_auth',
          cleanupType: 'oauth_state_expiry',
        },
        payload: {
          state: String(state || ''),
        },
        handler: async ({ payload }) => {
          const stateKey = buildOauthStateKey(payload?.state);
          if (!stateKey) return;
          try {
            await store.delete(stateKey);
          } catch {}
        },
      });
    } catch {}
  }

  async function cancelScheduledStateExpiry(state) {
    if (!schedulerEnabled || !state) return;
    try {
      await scheduler.cancelJob({
        jobName: OAUTH_STATE_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(state || ''),
      });
    } catch {}
  }

  async function createState() {
    if (!store || typeof store.set !== 'function') {
      throw createOauthStateStoreError('state_store_missing');
    }

    const createdAtMs = nowMs();
    const ttlMs = resolveStateTtlMs();
    const expiresAtMs = createdAtMs + ttlMs;
    const state = randomBytesFn(24).toString('base64url');
    const stateKey = buildOauthStateKey(state);
    if (!stateKey) {
      throw createOauthStateStoreError('state_key_invalid');
    }

    try {
      await store.set(
        stateKey,
        {
          createdAtMs,
          expiresAtMs,
        },
        { ttlMs }
      );
    } catch (error) {
      throw createOauthStateStoreError('oauth_state_store_unavailable', error);
    }

    await scheduleStateExpiry({ state, expiresAtMs });

    return {
      state,
      createdAtMs,
      expiresAtMs,
    };
  }

  async function consumeState(rawState) {
    if (!store || typeof store.getAndDelete !== 'function') {
      return {
        ok: false,
        reasonCode: 'state_store_missing',
      };
    }

    const state = String(rawState || '').trim();
    if (!state) {
      return {
        ok: false,
        reasonCode: 'missing_state',
      };
    }

    const stateKey = buildOauthStateKey(state);
    if (!stateKey) {
      return {
        ok: false,
        reasonCode: 'missing_state',
      };
    }

    let rawRecord = null;
    try {
      rawRecord = await store.getAndDelete(stateKey);
    } catch {
      return {
        ok: false,
        reasonCode: 'state_store_unavailable',
      };
    }
    const record = toStoredOauthStateRecord(rawRecord);
    if (!record) {
      return {
        ok: false,
        reasonCode: 'state_not_found',
      };
    }

    await cancelScheduledStateExpiry(state);

    if (Number(record.expiresAtMs || 0) <= nowMs()) {
      return {
        ok: false,
        reasonCode: 'state_expired',
      };
    }

    return {
      ok: true,
      state,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    };
  }

  return {
    consumeState,
    createState,
  };
}

function createInMemoryOauthStateStore({
  stateTtlMs = 10 * 60 * 1000,
  nowFn = Date.now,
  randomBytesFn = crypto.randomBytes,
} = {}) {
  return createOauthStateStoreFromStateStore({
    stateStore: createMemoryKeyValueStore({ nowFn }),
    stateTtlMs,
    nowFn,
    randomBytesFn,
  });
}

module.exports = {
  createOauthStateStoreFromStateStore,
  createInMemoryOauthStateStore,
};
