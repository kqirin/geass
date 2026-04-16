const crypto = require('node:crypto');
const { createMemoryKeyValueStore } = require('../sharedState/memoryStore');
const { toSessionSummary } = require('./sessionRepository');

function createAccessTokenRepositoryError(
  reasonCode = 'access_token_store_unavailable',
  cause = null
) {
  const error = new Error(String(reasonCode || 'access_token_store_unavailable'));
  error.name = 'AccessTokenRepositoryError';
  error.reasonCode = String(reasonCode || 'access_token_store_unavailable');
  if (cause) error.cause = cause;
  return error;
}

function randomAccessToken(randomBytesFn = crypto.randomBytes) {
  return randomBytesFn(32).toString('base64url');
}

function buildAccessTokenKey(accessToken = '') {
  const normalizedAccessToken = String(accessToken || '').trim();
  if (!normalizedAccessToken) return null;
  return `auth:access-token:${normalizedAccessToken}`;
}

const ACCESS_TOKEN_EXPIRY_CLEANUP_JOB_NAME =
  'control_plane_access_token_expiry_cleanup';

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

function toStoredAccessTokenRecord(rawValue = null) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return {
      provider: String(rawValue.provider || 'dashboard_exchange'),
      principal: rawValue.principal || null,
      session: rawValue.session || null,
      createdAtMs: Number(rawValue.createdAtMs || 0),
      expiresAtMs: Number(rawValue.expiresAtMs || 0),
    };
  }

  try {
    const parsed = JSON.parse(String(rawValue || ''));
    return toStoredAccessTokenRecord(parsed);
  } catch {
    return null;
  }
}

function createAccessTokenRepositoryFromStateStore({
  stateStore = null,
  accessTokenTtlMs = 15 * 60 * 1000,
  nowFn = Date.now,
  randomBytesFn = crypto.randomBytes,
  expiryScheduler = null,
  enableScheduledExpiryCleanup = false,
} = {}) {
  const store = stateStore && typeof stateStore === 'object' ? stateStore : null;
  const scheduler = resolveExpiryScheduler(expiryScheduler);
  const schedulerEnabled = Boolean(enableScheduledExpiryCleanup && scheduler);

  function nowMs() {
    const value = Number(nowFn());
    return Number.isFinite(value) ? value : Date.now();
  }

  function resolveAccessTokenTtlMs() {
    const ttlMs = Number(accessTokenTtlMs);
    return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 15 * 60 * 1000;
  }

  async function scheduleAccessTokenExpiry({
    accessToken = null,
    expiresAtMs = 0,
  } = {}) {
    if (!schedulerEnabled || !accessToken) return;
    const delayMs = Math.max(0, Number(expiresAtMs || 0) - nowMs());
    try {
      await scheduler.replaceDelayedJob({
        jobName: ACCESS_TOKEN_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(accessToken || ''),
        delayMs,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 2_500,
          maxDelayMs: 30_000,
          backoff: 'exponential',
        },
        metadata: {
          domain: 'control_plane_auth',
          cleanupType: 'access_token_expiry',
        },
        payload: {
          accessToken: String(accessToken || ''),
        },
        handler: async ({ payload }) => {
          const accessTokenKey = buildAccessTokenKey(payload?.accessToken);
          if (!accessTokenKey) return;
          try {
            await store.delete(accessTokenKey);
          } catch {}
        },
      });
    } catch {}
  }

  async function cancelScheduledAccessTokenExpiry(accessToken) {
    if (!schedulerEnabled || !accessToken) return;
    try {
      await scheduler.cancelJob({
        jobName: ACCESS_TOKEN_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(accessToken || ''),
      });
    } catch {}
  }

  async function createAccessToken({
    principal = null,
    session = null,
    provider = 'dashboard_exchange',
  } = {}) {
    if (!store || typeof store.set !== 'function') {
      throw createAccessTokenRepositoryError('access_token_store_missing');
    }

    const createdAtMs = nowMs();
    const ttlMs = resolveAccessTokenTtlMs();
    const expiresAtMs = createdAtMs + ttlMs;
    const accessToken = randomAccessToken(randomBytesFn);
    const accessTokenKey = buildAccessTokenKey(accessToken);
    if (!accessTokenKey) {
      throw createAccessTokenRepositoryError('access_token_invalid');
    }

    const sessionSummary = toSessionSummary(session);
    const record = {
      provider: String(provider || 'dashboard_exchange'),
      principal: principal || null,
      session: sessionSummary,
      createdAtMs,
      expiresAtMs,
    };

    try {
      await store.set(accessTokenKey, record, { ttlMs });
    } catch (error) {
      throw createAccessTokenRepositoryError('access_token_store_unavailable', error);
    }

    await scheduleAccessTokenExpiry({
      accessToken,
      expiresAtMs,
    });

    return {
      accessToken,
      createdAtMs,
      expiresAtMs,
      principal: record.principal,
      session: record.session,
      provider: record.provider,
    };
  }

  async function getAccessToken(accessToken = '') {
    if (!store || typeof store.get !== 'function') return null;
    const accessTokenKey = buildAccessTokenKey(accessToken);
    if (!accessTokenKey) return null;

    let rawRecord = null;
    try {
      rawRecord = await store.get(accessTokenKey);
    } catch {
      return null;
    }
    const record = toStoredAccessTokenRecord(rawRecord);
    if (!record) return null;

    if (Number(record.expiresAtMs || 0) <= nowMs()) {
      try {
        await store.delete(accessTokenKey);
      } catch {}
      await cancelScheduledAccessTokenExpiry(accessToken);
      return null;
    }

    return {
      accessToken: String(accessToken || ''),
      provider: record.provider,
      principal: record.principal || null,
      session: toSessionSummary(record.session),
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    };
  }

  async function deleteAccessToken(accessToken = '') {
    if (!store || typeof store.delete !== 'function') return false;
    const accessTokenKey = buildAccessTokenKey(accessToken);
    if (!accessTokenKey) return false;
    await cancelScheduledAccessTokenExpiry(accessToken);
    try {
      return await store.delete(accessTokenKey);
    } catch {
      return false;
    }
  }

  return {
    createAccessToken,
    deleteAccessToken,
    getAccessToken,
  };
}

function createInMemoryAccessTokenRepository({
  accessTokenTtlMs = 15 * 60 * 1000,
  nowFn = Date.now,
  randomBytesFn = crypto.randomBytes,
} = {}) {
  return createAccessTokenRepositoryFromStateStore({
    stateStore: createMemoryKeyValueStore({ nowFn }),
    accessTokenTtlMs,
    nowFn,
    randomBytesFn,
  });
}

module.exports = {
  buildAccessTokenKey,
  createAccessTokenRepositoryFromStateStore,
  createInMemoryAccessTokenRepository,
};
