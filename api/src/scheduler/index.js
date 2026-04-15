const crypto = require('node:crypto');
const {
  createSchedulerBackendSelector,
  normalizeSchedulerConfig,
} = require('./schedulerBackendSelector');

const MAX_DELAY_MS = 2_147_483_647;

function normalizeJobSegment(value = '') {
  return String(value || '').trim();
}

function createJobIdentity(jobName = '', jobKey = '') {
  const normalizedJobName = normalizeJobSegment(jobName);
  const normalizedJobKey = normalizeJobSegment(jobKey);
  if (!normalizedJobName || !normalizedJobKey) return null;
  return `${normalizedJobName}:${normalizedJobKey}`;
}

function buildKeyedJobKey(parts = []) {
  const values = Array.isArray(parts) ? parts : [parts];
  const normalized = values
    .map((value) => normalizeJobSegment(value))
    .filter(Boolean)
    .map((value) => value.replace(/[|]/g, '_'));
  if (!normalized.length) return null;
  return normalized.join('|');
}

function normalizeDelayMs(delayMs, fallback = 0) {
  const value = Number(delayMs);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), MAX_DELAY_MS);
}

function normalizeRetryPolicy(retry = {}) {
  const source = retry && typeof retry === 'object' ? retry : {};
  const maxAttemptsRaw = Number(source.maxAttempts);
  const maxAttempts =
    Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0
      ? Math.min(Math.floor(maxAttemptsRaw), 20)
      : 1;
  const baseDelayRaw = Number(source.baseDelayMs);
  const baseDelayMs =
    Number.isFinite(baseDelayRaw) && baseDelayRaw >= 0
      ? Math.min(Math.floor(baseDelayRaw), 60 * 60 * 1000)
      : 5_000;
  const maxDelayRaw = Number(source.maxDelayMs);
  const maxDelayMs =
    Number.isFinite(maxDelayRaw) && maxDelayRaw >= baseDelayMs
      ? Math.min(Math.floor(maxDelayRaw), 60 * 60 * 1000)
      : Math.max(baseDelayMs, 30_000);
  const backoff = String(source.backoff || 'fixed').trim().toLowerCase() || 'fixed';

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    backoff: backoff === 'exponential' ? 'exponential' : 'fixed',
  };
}

function computeRetryDelayMs(retryPolicy = {}, attemptNumber = 1) {
  const normalizedPolicy = normalizeRetryPolicy(retryPolicy);
  const attempt = Math.max(1, Math.floor(Number(attemptNumber) || 1));
  if (normalizedPolicy.backoff !== 'exponential') {
    return normalizeDelayMs(normalizedPolicy.baseDelayMs, 0);
  }
  const exp = Math.min(attempt - 1, 8);
  const delay = normalizedPolicy.baseDelayMs * Math.pow(2, exp);
  return normalizeDelayMs(Math.min(delay, normalizedPolicy.maxDelayMs), 0);
}

function createJobId(jobIdentity = '', randomBytesFn = crypto.randomBytes) {
  let token = '';
  try {
    token = randomBytesFn(8).toString('base64url');
  } catch {
    token = crypto.randomBytes(8).toString('base64url');
  }
  return `${jobIdentity}:${token}`;
}

function createJobScheduler({
  config = {},
  schedulerConfig = null,
  backendSelector = null,
  nowFn = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  randomBytesFn = crypto.randomBytes,
  sharedStateRedisClientFactory = null,
  logError = null,
  recentJobLimit = 100,
} = {}) {
  const selector =
    backendSelector ||
    createSchedulerBackendSelector({
      config,
      schedulerConfig,
      nowFn,
      sharedStateRedisClientFactory,
    });
  const backend = selector.backend;
  const jobHandles = new Map();
  const recentJobs = [];
  const maxRecentJobs =
    Number.isFinite(Number(recentJobLimit)) && Number(recentJobLimit) > 0
      ? Math.min(Math.floor(Number(recentJobLimit)), 500)
      : 100;

  function nowMs() {
    const value = Number(nowFn());
    return Number.isFinite(value) ? value : Date.now();
  }

  function pushRecentJob(entry = {}) {
    recentJobs.push({
      ...entry,
      timestamp: new Date(nowMs()).toISOString(),
    });
    while (recentJobs.length > maxRecentJobs) {
      recentJobs.shift();
    }
  }

  function clearTimer(jobIdentity) {
    const handleEntry = jobHandles.get(jobIdentity);
    if (!handleEntry?.timer) return;
    clearTimeoutFn(handleEntry.timer);
    handleEntry.timer = null;
  }

  function armTimer(jobIdentity, delayMs) {
    const handleEntry = jobHandles.get(jobIdentity);
    if (!handleEntry) return;
    clearTimer(jobIdentity);
    const timer = setTimeoutFn(() => {
      void executeDueJob(jobIdentity);
    }, normalizeDelayMs(delayMs, 0));
    timer?.unref?.();
    handleEntry.timer = timer;
  }

  function toSafeErrorCode(error) {
    const reasonCode = String(error?.reasonCode || '').trim();
    if (reasonCode) return reasonCode.slice(0, 96);
    const code = String(error?.code || '').trim();
    if (code) return code.slice(0, 96);
    return 'job_failed';
  }

  function toSafeErrorMessage(error) {
    const message = String(error?.message || '').trim();
    if (!message) return null;
    return message.slice(0, 160);
  }

  function computeRecordTtlMs(record = {}) {
    const runAtMs = Number(record.runAtMs || nowMs());
    const now = nowMs();
    const baseTtlMs = Math.max(0, runAtMs - now);
    const retentionMs = 24 * 60 * 60 * 1000;
    return normalizeDelayMs(baseTtlMs + retentionMs, 24 * 60 * 60 * 1000);
  }

  function mapJobRecordSummary(record = null, localHandle = null) {
    if (!record || typeof record !== 'object') return null;
    const attempts = Number(record.attempts || 0);
    const maxAttempts = Number(record.maxAttempts || 1);
    return {
      jobId: String(record.jobId || ''),
      jobName: String(record.jobName || ''),
      jobKey: String(record.jobKey || ''),
      status: String(record.status || 'scheduled'),
      attempts,
      maxAttempts,
      runAt: new Date(Number(record.runAtMs || nowMs())).toISOString(),
      scheduledAt: new Date(Number(record.scheduledAtMs || nowMs())).toISOString(),
      lastErrorCode:
        record.lastErrorCode === undefined || record.lastErrorCode === null
          ? null
          : String(record.lastErrorCode || '') || null,
      localTimerArmed: Boolean(localHandle?.timer),
    };
  }

  async function executeDueJob(jobIdentity) {
    const handleEntry = jobHandles.get(jobIdentity);
    if (!handleEntry) return;

    clearTimer(jobIdentity);

    let record = null;
    try {
      record = await backend.getJobRecord(jobIdentity);
    } catch (error) {
      if (typeof logError === 'function') {
        logError('scheduler_job_lookup_failed', error, {
          feature: 'scheduler',
          jobIdentity,
        });
      }
      jobHandles.delete(jobIdentity);
      return;
    }

    if (!record || typeof record !== 'object') {
      jobHandles.delete(jobIdentity);
      return;
    }

    if (String(record.scheduleToken || '') !== String(handleEntry.scheduleToken || '')) {
      jobHandles.delete(jobIdentity);
      return;
    }

    const attempt = Number(record.attempts || 0) + 1;
    const updatedRecord = {
      ...record,
      attempts: attempt,
      status: 'running',
      lastAttemptAtMs: nowMs(),
    };

    try {
      await backend.upsertJobRecord(jobIdentity, updatedRecord, {
        ttlMs: computeRecordTtlMs(updatedRecord),
      });
    } catch {}

    try {
      await handleEntry.handler({
        jobId: String(record.jobId || ''),
        jobIdentity,
        jobName: String(record.jobName || ''),
        jobKey: String(record.jobKey || ''),
        payload: record.payload ?? null,
        metadata: record.metadata ?? null,
        attempt,
        maxAttempts: Number(record.maxAttempts || 1),
      });

      await backend.deleteJobRecord(jobIdentity).catch(() => {});
      jobHandles.delete(jobIdentity);
      pushRecentJob({
        jobId: String(record.jobId || ''),
        jobName: String(record.jobName || ''),
        jobKey: String(record.jobKey || ''),
        status: 'succeeded',
        attempts: attempt,
      });
      return;
    } catch (error) {
      const maxAttempts = Number(record.maxAttempts || 1);
      const safeErrorCode = toSafeErrorCode(error);
      const safeErrorMessage = toSafeErrorMessage(error);
      if (attempt < maxAttempts) {
        const retryDelayMs = computeRetryDelayMs(record.retryPolicy, attempt);
        const retryRecord = {
          ...updatedRecord,
          status: 'scheduled',
          runAtMs: nowMs() + retryDelayMs,
          lastErrorCode: safeErrorCode,
          lastErrorMessage: safeErrorMessage,
        };
        try {
          await backend.upsertJobRecord(jobIdentity, retryRecord, {
            ttlMs: computeRecordTtlMs(retryRecord),
          });
          armTimer(jobIdentity, retryDelayMs);
        } catch {}
        if (typeof logError === 'function') {
          logError('scheduler_job_retry_scheduled', error, {
            feature: 'scheduler',
            jobIdentity,
            jobName: String(record.jobName || ''),
            jobKey: String(record.jobKey || ''),
            attempt,
            maxAttempts,
            retryDelayMs,
            reasonCode: safeErrorCode,
          });
        }
        pushRecentJob({
          jobId: String(record.jobId || ''),
          jobName: String(record.jobName || ''),
          jobKey: String(record.jobKey || ''),
          status: 'retry_scheduled',
          attempts: attempt,
          reasonCode: safeErrorCode,
        });
        return;
      }

      await backend.deleteJobRecord(jobIdentity).catch(() => {});
      jobHandles.delete(jobIdentity);
      if (typeof logError === 'function') {
        logError('scheduler_job_failed', error, {
          feature: 'scheduler',
          jobIdentity,
          jobName: String(record.jobName || ''),
          jobKey: String(record.jobKey || ''),
          attempt,
          maxAttempts,
          reasonCode: safeErrorCode,
        });
      }
      pushRecentJob({
        jobId: String(record.jobId || ''),
        jobName: String(record.jobName || ''),
        jobKey: String(record.jobKey || ''),
        status: 'failed',
        attempts: attempt,
        reasonCode: safeErrorCode,
      });
    }
  }

  async function scheduleDelayedJob({
    jobName = '',
    jobKey = '',
    delayMs = 0,
    handler = null,
    payload = null,
    metadata = null,
    replaceExisting = false,
    retry = {},
  } = {}) {
    const backendSummary = selector.getSummary();
    if (!backendSummary?.enabled) {
      return {
        ok: false,
        accepted: false,
        reasonCode: 'scheduler_disabled',
      };
    }

    const jobIdentity = createJobIdentity(jobName, jobKey);
    if (!jobIdentity) {
      return {
        ok: false,
        accepted: false,
        reasonCode: 'job_identity_invalid',
      };
    }

    if (typeof handler !== 'function') {
      return {
        ok: false,
        accepted: false,
        reasonCode: 'handler_required',
      };
    }

    let existingRecord = null;
    try {
      existingRecord = await backend.getJobRecord(jobIdentity);
    } catch {}
    if (existingRecord && !replaceExisting) {
      return {
        ok: true,
        accepted: false,
        reasonCode: 'job_already_exists',
        jobIdentity,
        jobId: String(existingRecord.jobId || ''),
      };
    }

    if (replaceExisting) {
      await cancelJob({ jobName, jobKey });
    }

    const normalizedDelayMs = normalizeDelayMs(delayMs, 0);
    const scheduledAtMs = nowMs();
    const runAtMs = scheduledAtMs + normalizedDelayMs;
    const retryPolicy = normalizeRetryPolicy(retry);
    const scheduleToken = createJobId(jobIdentity, randomBytesFn).slice(-16);
    const jobId = createJobId(jobIdentity, randomBytesFn);
    const record = {
      jobId,
      jobName: normalizeJobSegment(jobName),
      jobKey: normalizeJobSegment(jobKey),
      scheduledAtMs,
      runAtMs,
      attempts: 0,
      maxAttempts: retryPolicy.maxAttempts,
      retryPolicy,
      status: 'scheduled',
      payload: payload ?? null,
      metadata: metadata ?? null,
      scheduleToken,
      lastErrorCode: null,
      lastErrorMessage: null,
    };

    await backend.upsertJobRecord(jobIdentity, record, {
      ttlMs: computeRecordTtlMs(record),
    });

    jobHandles.set(jobIdentity, {
      timer: null,
      handler,
      scheduleToken,
      jobId,
      jobName: String(record.jobName || ''),
      jobKey: String(record.jobKey || ''),
    });

    armTimer(jobIdentity, normalizedDelayMs);

    return {
      ok: true,
      accepted: true,
      reasonCode: null,
      jobIdentity,
      jobId,
      runAt: new Date(runAtMs).toISOString(),
    };
  }

  async function replaceDelayedJob(options = {}) {
    return scheduleDelayedJob({
      ...options,
      replaceExisting: true,
    });
  }

  async function cancelJob({ jobName = '', jobKey = '' } = {}) {
    const jobIdentity = createJobIdentity(jobName, jobKey);
    if (!jobIdentity) {
      return {
        ok: false,
        cancelled: false,
        reasonCode: 'job_identity_invalid',
      };
    }
    const localHandle = jobHandles.get(jobIdentity);
    if (localHandle) {
      clearTimer(jobIdentity);
      jobHandles.delete(jobIdentity);
    }

    let backendDeleted = false;
    try {
      backendDeleted = await backend.deleteJobRecord(jobIdentity);
    } catch {}

    return {
      ok: true,
      cancelled: Boolean(localHandle || backendDeleted),
      reasonCode: null,
      jobIdentity,
    };
  }

  async function getJobStatus({ jobName = '', jobKey = '' } = {}) {
    const jobIdentity = createJobIdentity(jobName, jobKey);
    if (!jobIdentity) {
      return {
        exists: false,
        reasonCode: 'job_identity_invalid',
      };
    }
    const record = await backend.getJobRecord(jobIdentity).catch(() => null);
    const localHandle = jobHandles.get(jobIdentity) || null;
    if (!record) {
      return {
        exists: false,
        reasonCode: 'job_not_found',
      };
    }

    return {
      exists: true,
      jobIdentity,
      job: mapJobRecordSummary(record, localHandle),
    };
  }

  function getSummary() {
    return {
      scheduler: selector.getSummary(),
      activeLocalJobCount: jobHandles.size,
      recentJobs: recentJobs.slice(-maxRecentJobs),
    };
  }

  async function close() {
    for (const jobIdentity of jobHandles.keys()) {
      clearTimer(jobIdentity);
    }
    jobHandles.clear();
    await selector.close();
  }

  return {
    scheduleDelayedJob,
    replaceDelayedJob,
    cancelJob,
    getJobStatus,
    getSummary,
    close,
  };
}

module.exports = {
  createJobScheduler,
  createJobIdentity,
  buildKeyedJobKey,
  normalizeRetryPolicy,
  normalizeSchedulerConfig,
};
