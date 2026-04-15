const crypto = require('node:crypto');
const { createMemoryKeyValueStore } = require('../sharedState/memoryStore');

function randomSessionId(randomBytesFn = crypto.randomBytes) {
  return randomBytesFn(24).toString('base64url');
}

function toSessionSummary(record) {
  if (!record || typeof record !== 'object') return null;
  const existingCreatedAt = String(record.createdAt || '').trim();
  const existingExpiresAt = String(record.expiresAt || '').trim();
  if (existingCreatedAt && existingExpiresAt) {
    return {
      id: String(record.id || ''),
      provider: String(record.provider || 'discord_oauth'),
      createdAt: existingCreatedAt,
      expiresAt: existingExpiresAt,
    };
  }

  return {
    id: String(record.id || ''),
    provider: String(record.provider || 'discord_oauth'),
    createdAt: new Date(Number(record.createdAtMs || Date.now())).toISOString(),
    expiresAt: new Date(Number(record.expiresAtMs || Date.now())).toISOString(),
  };
}

function createSessionRepositoryError(reasonCode = 'session_store_unavailable', cause = null) {
  const error = new Error(String(reasonCode || 'session_store_unavailable'));
  error.name = 'SessionRepositoryError';
  error.reasonCode = String(reasonCode || 'session_store_unavailable');
  if (cause) error.cause = cause;
  return error;
}

function buildSessionKey(sessionId = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return null;
  return `auth:session:${normalizedSessionId}`;
}

const SESSION_EXPIRY_CLEANUP_JOB_NAME = 'control_plane_session_expiry_cleanup';

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

function toStoredSessionRecord(rawValue = null) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return {
      id: String(rawValue.id || '').trim(),
      provider: String(rawValue.provider || 'discord_oauth'),
      principal: rawValue.principal || null,
      createdAtMs: Number(rawValue.createdAtMs || 0),
      expiresAtMs: Number(rawValue.expiresAtMs || 0),
    };
  }

  try {
    const parsed = JSON.parse(String(rawValue || ''));
    return toStoredSessionRecord(parsed);
  } catch {
    return null;
  }
}

function createSessionRepositoryFromStateStore({
  stateStore = null,
  sessionTtlMs = 8 * 60 * 60 * 1000,
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

  function resolveSessionTtlMs() {
    const ttlMs = Number(sessionTtlMs);
    return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 8 * 60 * 60 * 1000;
  }

  async function scheduleSessionExpiry(record = {}) {
    if (!schedulerEnabled || !record?.id) return;
    const delayMs = Math.max(0, Number(record.expiresAtMs || 0) - nowMs());
    try {
      await scheduler.replaceDelayedJob({
        jobName: SESSION_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(record.id || ''),
        delayMs,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 5_000,
          maxDelayMs: 30_000,
          backoff: 'exponential',
        },
        metadata: {
          domain: 'control_plane_auth',
          cleanupType: 'session_expiry',
        },
        payload: {
          sessionId: String(record.id || ''),
        },
        handler: async ({ payload }) => {
          const sessionKey = buildSessionKey(payload?.sessionId);
          if (!sessionKey) return;
          try {
            await store.delete(sessionKey);
          } catch {}
        },
      });
    } catch {}
  }

  async function cancelScheduledSessionExpiry(sessionId) {
    if (!schedulerEnabled) return;
    try {
      await scheduler.cancelJob({
        jobName: SESSION_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(sessionId || ''),
      });
    } catch {}
  }

  async function createSession({ principal = null, provider = 'discord_oauth' } = {}) {
    if (!store || typeof store.set !== 'function') {
      throw createSessionRepositoryError('session_store_missing');
    }

    const createdAtMs = nowMs();
    const expiresAtMs = createdAtMs + resolveSessionTtlMs();
    const id = randomSessionId(randomBytesFn);
    const sessionKey = buildSessionKey(id);
    if (!sessionKey) {
      throw createSessionRepositoryError('session_id_invalid');
    }

    const record = {
      id,
      provider: String(provider || 'discord_oauth'),
      principal,
      createdAtMs,
      expiresAtMs,
    };

    try {
      await store.set(sessionKey, record, {
        ttlMs: resolveSessionTtlMs(),
      });
    } catch (error) {
      throw createSessionRepositoryError('session_store_unavailable', error);
    }

    await scheduleSessionExpiry(record);

    return {
      ...record,
      summary: toSessionSummary(record),
    };
  }

  async function getSessionById(sessionId) {
    if (!store || typeof store.get !== 'function') return null;
    const sessionKey = buildSessionKey(sessionId);
    if (!sessionKey) return null;

    let rawRecord = null;
    try {
      rawRecord = await store.get(sessionKey);
    } catch {
      return null;
    }
    const record = toStoredSessionRecord(rawRecord);
    if (!record) return null;

    const expiresAtMs = Number(record.expiresAtMs || 0);
    if (expiresAtMs <= nowMs()) {
      try {
        await store.delete(sessionKey);
      } catch {}
      await cancelScheduledSessionExpiry(record.id);
      return null;
    }

    return {
      ...record,
      summary: toSessionSummary(record),
    };
  }

  async function deleteSessionById(sessionId) {
    if (!store || typeof store.delete !== 'function') return false;
    const sessionKey = buildSessionKey(sessionId);
    if (!sessionKey) return false;
    await cancelScheduledSessionExpiry(sessionId);
    try {
      return await store.delete(sessionKey);
    } catch {
      return false;
    }
  }

  return {
    createSession,
    deleteSessionById,
    getSessionById,
    toSessionSummary,
  };
}

function createInMemorySessionRepository({
  sessionTtlMs = 8 * 60 * 60 * 1000,
  nowFn = Date.now,
  randomBytesFn = crypto.randomBytes,
} = {}) {
  return createSessionRepositoryFromStateStore({
    stateStore: createMemoryKeyValueStore({ nowFn }),
    sessionTtlMs,
    nowFn,
    randomBytesFn,
  });
}

module.exports = {
  createSessionRepositoryFromStateStore,
  createInMemorySessionRepository,
  toSessionSummary,
};
