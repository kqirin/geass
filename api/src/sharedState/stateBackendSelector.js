const { createMemoryKeyValueStore } = require('./memoryStore');
const { createRedisKeyValueStore } = require('./redisStore');

function normalizeProvider(provider = 'memory') {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!normalized) return 'memory';
  return normalized;
}

function normalizeSharedStateConfig(sharedStateConfig = {}) {
  const source =
    sharedStateConfig && typeof sharedStateConfig === 'object'
      ? sharedStateConfig
      : {};
  const redis =
    source.redis && typeof source.redis === 'object' ? source.redis : {};

  return {
    enabled: Boolean(source.enabled),
    provider: normalizeProvider(source.provider),
    redis: {
      url: String(redis.url || '').trim() || null,
      keyPrefix: String(redis.keyPrefix || 'cp:ss').trim() || 'cp:ss',
      connectTimeoutMs: Number(redis.connectTimeoutMs || 1500),
      fallbackToMemory: redis.fallbackToMemory !== false,
    },
  };
}

function createSharedStateBackendSelector({
  config = {},
  sharedStateConfig = null,
  nowFn = Date.now,
  redisClientFactory = null,
} = {}) {
  const resolvedConfig = normalizeSharedStateConfig(
    sharedStateConfig || config?.controlPlane?.sharedState || {}
  );
  const memoryStore = createMemoryKeyValueStore({ nowFn });

  let activeProvider = 'memory';
  let fallbackUsed = false;
  let fallbackReasonCode = null;

  if (!resolvedConfig.enabled) {
    fallbackReasonCode = 'shared_state_disabled';
  }

  if (resolvedConfig.enabled && resolvedConfig.provider !== 'redis') {
    fallbackReasonCode = 'provider_not_supported';
  }

  const redisStore =
    resolvedConfig.enabled && resolvedConfig.provider === 'redis'
      ? createRedisKeyValueStore({
          redisUrl: resolvedConfig.redis.url,
          keyPrefix: resolvedConfig.redis.keyPrefix,
          connectTimeoutMs: resolvedConfig.redis.connectTimeoutMs,
          redisClientFactory,
        })
      : null;

  if (redisStore) {
    const redisStatus = redisStore.getStatus();
    if (!redisStatus.configured) {
      fallbackUsed = true;
      fallbackReasonCode = redisStatus.reasonCode || 'redis_not_configured';
    } else {
      activeProvider = 'redis';
    }
  }

  function getActiveStore() {
    if (activeProvider === 'redis' && redisStore) return redisStore;
    return memoryStore;
  }

  async function executeWithOptionalFallback(operationName, args = []) {
    const activeStore = getActiveStore();
    const handler = activeStore?.[operationName];
    if (typeof handler !== 'function') {
      throw new Error('shared_state_operation_unsupported');
    }

    try {
      return await handler(...args);
    } catch (error) {
      if (
        activeProvider !== 'redis' ||
        !resolvedConfig.redis.fallbackToMemory ||
        !redisStore
      ) {
        throw error;
      }

      fallbackUsed = true;
      fallbackReasonCode =
        String(error?.reasonCode || '').trim() || 'redis_runtime_failed';
      activeProvider = 'memory';
      return memoryStore[operationName](...args);
    }
  }

  async function close() {
    await memoryStore.close();
    if (redisStore) {
      await redisStore.close();
    }
  }

  function getSummary() {
    return {
      enabled: resolvedConfig.enabled,
      requestedProvider: resolvedConfig.provider,
      activeProvider,
      fallbackUsed,
      reasonCode: fallbackReasonCode || null,
      redisConfigured: Boolean(resolvedConfig.redis.url),
      redisFallbackToMemory: Boolean(resolvedConfig.redis.fallbackToMemory),
    };
  }

  return {
    store: {
      async set(...args) {
        return executeWithOptionalFallback('set', args);
      },
      async get(...args) {
        return executeWithOptionalFallback('get', args);
      },
      async delete(...args) {
        return executeWithOptionalFallback('delete', args);
      },
      async getAndDelete(...args) {
        return executeWithOptionalFallback('getAndDelete', args);
      },
    },
    close,
    getSummary,
  };
}

module.exports = {
  createSharedStateBackendSelector,
  normalizeSharedStateConfig,
};
