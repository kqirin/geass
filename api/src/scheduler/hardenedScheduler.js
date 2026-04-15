const { createSharedStateBackendSelector } = require('../sharedState/stateBackendSelector');

function normalizeNumber(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function normalizeHardenedSchedulerConfig(hardenedConfig = {}) {
  const source =
    hardenedConfig && typeof hardenedConfig === 'object' ? hardenedConfig : {};
  const redis = source.redis && typeof source.redis === 'object' ? source.redis : {};

  return {
    defaultRecordTtlMs: normalizeNumber(
      source.defaultRecordTtlMs,
      24 * 60 * 60 * 1000,
      { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 }
    ),
    redis: {
      url: String(redis.url || '').trim() || null,
      keyPrefix: String(redis.keyPrefix || 'cp:scheduler').trim() || 'cp:scheduler',
      connectTimeoutMs: normalizeNumber(redis.connectTimeoutMs, 1500, {
        min: 200,
        max: 30_000,
      }),
      fallbackToMemory: redis.fallbackToMemory !== false,
    },
  };
}

function buildSchedulerRecordKey(jobIdentity = '') {
  const normalizedIdentity = String(jobIdentity || '').trim();
  if (!normalizedIdentity) return null;
  return `scheduler:record:${normalizedIdentity}`;
}

function createHardenedSchedulerBackend({
  hardenedConfig = {},
  nowFn = Date.now,
  redisClientFactory = null,
} = {}) {
  const resolvedConfig = normalizeHardenedSchedulerConfig(hardenedConfig);
  const sharedStateSelector = createSharedStateBackendSelector({
    sharedStateConfig: {
      enabled: true,
      provider: 'redis',
      redis: {
        url: resolvedConfig.redis.url,
        keyPrefix: resolvedConfig.redis.keyPrefix,
        connectTimeoutMs: resolvedConfig.redis.connectTimeoutMs,
        fallbackToMemory: resolvedConfig.redis.fallbackToMemory,
      },
    },
    nowFn,
    redisClientFactory,
  });
  const store = sharedStateSelector.store;

  async function upsertJobRecord(jobIdentity, record, { ttlMs = null } = {}) {
    const recordKey = buildSchedulerRecordKey(jobIdentity);
    if (!recordKey) return false;
    const resolvedTtlMs = normalizeNumber(
      ttlMs,
      resolvedConfig.defaultRecordTtlMs,
      { min: 1000, max: 7 * 24 * 60 * 60 * 1000 }
    );
    await store.set(recordKey, record, { ttlMs: resolvedTtlMs });
    return true;
  }

  async function getJobRecord(jobIdentity) {
    const recordKey = buildSchedulerRecordKey(jobIdentity);
    if (!recordKey) return null;
    return store.get(recordKey);
  }

  async function deleteJobRecord(jobIdentity) {
    const recordKey = buildSchedulerRecordKey(jobIdentity);
    if (!recordKey) return false;
    return store.delete(recordKey);
  }

  async function close() {
    await sharedStateSelector.close();
  }

  function getStatus() {
    const summary = sharedStateSelector.getSummary();
    return {
      provider: 'hardened',
      configured: Boolean(summary?.redisConfigured),
      connected: String(summary?.activeProvider || '') === 'redis',
      reasonCode:
        summary?.reasonCode === undefined || summary?.reasonCode === null
          ? null
          : String(summary.reasonCode || '') || null,
      activeStoreProvider: String(summary?.activeProvider || 'memory'),
      requestedStoreProvider: String(summary?.requestedProvider || 'redis'),
      fallbackUsed: Boolean(summary?.fallbackUsed),
      redisFallbackToMemory: Boolean(summary?.redisFallbackToMemory),
    };
  }

  return {
    upsertJobRecord,
    getJobRecord,
    deleteJobRecord,
    close,
    getStatus,
  };
}

module.exports = {
  createHardenedSchedulerBackend,
  normalizeHardenedSchedulerConfig,
};
