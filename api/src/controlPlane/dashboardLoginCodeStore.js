const crypto = require('node:crypto');
const { createMemoryKeyValueStore } = require('../sharedState/memoryStore');

function createDashboardLoginCodeStoreError(
  reasonCode = 'dashboard_login_code_store_unavailable',
  cause = null
) {
  const error = new Error(
    String(reasonCode || 'dashboard_login_code_store_unavailable')
  );
  error.name = 'DashboardLoginCodeStoreError';
  error.reasonCode = String(reasonCode || 'dashboard_login_code_store_unavailable');
  if (cause) error.cause = cause;
  return error;
}

function buildDashboardLoginCodeKey(code = '') {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return null;
  return `auth:dashboard-login-code:${normalizedCode}`;
}

function randomDashboardLoginCode(randomBytesFn = crypto.randomBytes) {
  return randomBytesFn(24).toString('base64url');
}

const DASHBOARD_LOGIN_CODE_EXPIRY_CLEANUP_JOB_NAME =
  'control_plane_dashboard_login_code_expiry_cleanup';

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

function toStoredDashboardLoginCodeRecord(rawValue = null) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return {
      createdAtMs: Number(rawValue.createdAtMs || 0),
      expiresAtMs: Number(rawValue.expiresAtMs || 0),
      principal: rawValue.principal || null,
      session: rawValue.session || null,
    };
  }

  try {
    const parsed = JSON.parse(String(rawValue || ''));
    return toStoredDashboardLoginCodeRecord(parsed);
  } catch {
    return null;
  }
}

function createDashboardLoginCodeStoreFromStateStore({
  stateStore = null,
  codeTtlMs = 2 * 60 * 1000,
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

  function resolveCodeTtlMs() {
    const ttlMs = Number(codeTtlMs);
    return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 2 * 60 * 1000;
  }

  async function scheduleDashboardLoginCodeExpiry({
    code = null,
    expiresAtMs = 0,
  } = {}) {
    if (!schedulerEnabled || !code) return;
    const delayMs = Math.max(0, Number(expiresAtMs || 0) - nowMs());
    try {
      await scheduler.replaceDelayedJob({
        jobName: DASHBOARD_LOGIN_CODE_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(code || ''),
        delayMs,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 2_500,
          maxDelayMs: 30_000,
          backoff: 'exponential',
        },
        metadata: {
          domain: 'control_plane_auth',
          cleanupType: 'dashboard_login_code_expiry',
        },
        payload: {
          code: String(code || ''),
        },
        handler: async ({ payload }) => {
          const codeKey = buildDashboardLoginCodeKey(payload?.code);
          if (!codeKey) return;
          try {
            await store.delete(codeKey);
          } catch {}
        },
      });
    } catch {}
  }

  async function cancelScheduledDashboardLoginCodeExpiry(code) {
    if (!schedulerEnabled || !code) return;
    try {
      await scheduler.cancelJob({
        jobName: DASHBOARD_LOGIN_CODE_EXPIRY_CLEANUP_JOB_NAME,
        jobKey: String(code || ''),
      });
    } catch {}
  }

  async function createCode({ principal = null, session = null } = {}) {
    if (!store || typeof store.set !== 'function') {
      throw createDashboardLoginCodeStoreError('dashboard_login_code_store_missing');
    }

    const createdAtMs = nowMs();
    const ttlMs = resolveCodeTtlMs();
    const expiresAtMs = createdAtMs + ttlMs;
    const code = randomDashboardLoginCode(randomBytesFn);
    const codeKey = buildDashboardLoginCodeKey(code);
    if (!codeKey) {
      throw createDashboardLoginCodeStoreError('dashboard_login_code_invalid');
    }

    try {
      await store.set(
        codeKey,
        {
          createdAtMs,
          expiresAtMs,
          principal: principal || null,
          session: session || null,
        },
        { ttlMs }
      );
    } catch (error) {
      throw createDashboardLoginCodeStoreError(
        'dashboard_login_code_store_unavailable',
        error
      );
    }

    await scheduleDashboardLoginCodeExpiry({
      code,
      expiresAtMs,
    });

    return {
      code,
      createdAtMs,
      expiresAtMs,
    };
  }

  async function consumeCode(rawCode = '') {
    if (!store || typeof store.getAndDelete !== 'function') {
      return {
        ok: false,
        reasonCode: 'dashboard_login_code_store_missing',
      };
    }

    const code = String(rawCode || '').trim();
    if (!code) {
      return {
        ok: false,
        reasonCode: 'missing_code',
      };
    }

    const codeKey = buildDashboardLoginCodeKey(code);
    if (!codeKey) {
      return {
        ok: false,
        reasonCode: 'missing_code',
      };
    }

    let rawRecord = null;
    try {
      rawRecord = await store.getAndDelete(codeKey);
    } catch {
      return {
        ok: false,
        reasonCode: 'dashboard_login_code_store_unavailable',
      };
    }
    const record = toStoredDashboardLoginCodeRecord(rawRecord);
    if (!record) {
      return {
        ok: false,
        reasonCode: 'code_not_found',
      };
    }

    await cancelScheduledDashboardLoginCodeExpiry(code);

    if (Number(record.expiresAtMs || 0) <= nowMs()) {
      return {
        ok: false,
        reasonCode: 'code_expired',
      };
    }

    return {
      ok: true,
      code,
      principal: record.principal || null,
      session: record.session || null,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    };
  }

  return {
    createCode,
    consumeCode,
  };
}

function createInMemoryDashboardLoginCodeStore({
  codeTtlMs = 2 * 60 * 1000,
  nowFn = Date.now,
  randomBytesFn = crypto.randomBytes,
} = {}) {
  return createDashboardLoginCodeStoreFromStateStore({
    stateStore: createMemoryKeyValueStore({ nowFn }),
    codeTtlMs,
    nowFn,
    randomBytesFn,
  });
}

module.exports = {
  buildDashboardLoginCodeKey,
  createDashboardLoginCodeStoreFromStateStore,
  createInMemoryDashboardLoginCodeStore,
};
