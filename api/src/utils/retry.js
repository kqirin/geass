const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_PACKETS_OUT_OF_ORDER',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '55P03', // lock_not_available
  '57P01', // admin_shutdown
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
]);

function isTransientError(err) {
  const code = String(err?.code || '').trim();
  if (!code) return false;
  return TRANSIENT_ERROR_CODES.has(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function applyJitter(delayMs, jitterRatio) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;
  const ratio = Math.min(Math.max(Number(jitterRatio) || 0, 0), 1);
  if (ratio <= 0) return Math.round(delayMs);

  const delta = delayMs * ratio;
  const jitter = (Math.random() * 2 - 1) * delta;
  return Math.max(0, Math.round(delayMs + jitter));
}

async function withRetry(taskName, fn, options = {}) {
  const attempts = Math.max(1, Math.floor(toFiniteNumber(options.attempts, 3)));
  const baseDelayMs = Math.max(0, toFiniteNumber(options.baseDelayMs, 250));
  const maxDelayMs = Math.max(baseDelayMs, toFiniteNumber(options.maxDelayMs, 5000));
  const jitterRatio = Math.min(Math.max(toFiniteNumber(options.jitterRatio, 0), 0), 1);
  const shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : isTransientError;
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;
  const onFinalFailure = typeof options.onFinalFailure === 'function' ? options.onFinalFailure : null;

  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = shouldRetry(err);
      if (!retryable || attempt >= attempts) {
        if (onFinalFailure) {
          onFinalFailure({
            taskName,
            attempt,
            attempts,
            err,
            code: err?.code || null,
            message: err?.message || String(err),
            retryable,
          });
        }
        break;
      }

      const baseDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const delayMs = applyJitter(baseDelay, jitterRatio);
      if (onRetry) {
        onRetry({
          taskName,
          attempt,
          attempts,
          delayMs,
          code: err?.code || null,
          message: err?.message || String(err),
        });
      }
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

module.exports = {
  isTransientError,
  withRetry,
};
