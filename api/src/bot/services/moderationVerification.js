'use strict';

const DEFAULT_MODERATION_VERIFY_RETRY_DELAYS_MS = Object.freeze([0, 125, 300]);

function normalizeRetryDelays(retryDelaysMs, fallback = DEFAULT_MODERATION_VERIFY_RETRY_DELAYS_MS) {
  const source = Array.isArray(retryDelaysMs) && retryDelaysMs.length > 0 ? retryDelaysMs : fallback;
  const normalized = source
    .map((value) => Math.max(0, Math.floor(Number(value) || 0)))
    .filter((value) => Number.isFinite(value));

  if (normalized.length === 0) {
    return [...fallback];
  }

  if (normalized[0] !== 0) {
    normalized.unshift(0);
  }

  return normalized;
}

function wait(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function retryModerationVerification({
  runCheck,
  retryDelaysMs = DEFAULT_MODERATION_VERIFY_RETRY_DELAYS_MS,
  shouldRetryResult = (result) => result?.ok !== true,
  shouldRetryError = () => false,
} = {}) {
  if (typeof runCheck !== 'function') {
    throw new TypeError('runCheck must be a function');
  }

  const retrySchedule = normalizeRetryDelays(retryDelaysMs);
  let lastResult = null;

  for (let index = 0; index < retrySchedule.length; index += 1) {
    const attempt = index + 1;
    const attempts = retrySchedule.length;
    const delayMs = retrySchedule[index];
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      const result = await runCheck({ attempt, attempts });
      lastResult =
        result && typeof result === 'object'
          ? { ...result, attempt, attempts }
          : { ok: Boolean(result), attempt, attempts };

      if (!shouldRetryResult(lastResult, { attempt, attempts })) {
        return lastResult;
      }
    } catch (err) {
      if (attempt >= attempts || !shouldRetryError(err, { attempt, attempts })) {
        throw err;
      }
    }
  }

  return lastResult || { ok: false, attempt: retrySchedule.length, attempts: retrySchedule.length };
}

module.exports = {
  DEFAULT_MODERATION_VERIFY_RETRY_DELAYS_MS,
  retryModerationVerification,
  wait,
  __internal: {
    normalizeRetryDelays,
  },
};
