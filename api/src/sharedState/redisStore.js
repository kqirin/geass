function createRedisStoreError(reasonCode = 'redis_operation_failed', message = null, cause = null) {
  const error = new Error(message || String(reasonCode || 'redis_operation_failed'));
  error.name = 'RedisStoreError';
  error.reasonCode = String(reasonCode || 'redis_operation_failed');
  if (cause) error.cause = cause;
  return error;
}

function normalizeStoreKey(key) {
  const normalized = String(key || '').trim();
  return normalized || null;
}

function normalizeTtlMs(ttlMs, fallback = null) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function withTimeout(promise, timeoutMs, reasonCode = 'redis_connect_timeout') {
  const normalizedTimeoutMs = normalizeTtlMs(timeoutMs, null);
  if (!normalizedTimeoutMs) return promise;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(createRedisStoreError(reasonCode));
      }, normalizedTimeoutMs);
      timer.unref?.();
    }),
  ]);
}

function resolveRedisClientFactory(redisClientFactory = null) {
  if (typeof redisClientFactory === 'function') {
    return {
      factory: redisClientFactory,
      reasonCode: null,
    };
  }

  try {
    // Optional dependency: the runtime may operate fully in memory mode.
    const redisModule = require('redis');
    if (typeof redisModule?.createClient !== 'function') {
      return {
        factory: null,
        reasonCode: 'redis_client_factory_missing',
      };
    }
    return {
      factory: redisModule.createClient,
      reasonCode: null,
    };
  } catch {
    return {
      factory: null,
      reasonCode: 'redis_module_missing',
    };
  }
}

function buildRedisStoreKey(keyPrefix = '', key = '') {
  const prefix = String(keyPrefix || '').trim();
  const normalizedKey = normalizeStoreKey(key);
  if (!normalizedKey) return null;
  if (!prefix) return normalizedKey;
  return `${prefix}:${normalizedKey}`;
}

function serializeRedisValue(value) {
  return JSON.stringify({
    value,
  });
}

function parseRedisValue(serializedValue) {
  if (serializedValue === null || serializedValue === undefined) return null;

  try {
    const parsed = JSON.parse(String(serializedValue || ''));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed.value === undefined ? null : parsed.value;
  } catch {
    return null;
  }
}

function parseMultiExecResult(execResult) {
  if (!Array.isArray(execResult) || execResult.length === 0) {
    return null;
  }

  const first = execResult[0];
  if (Array.isArray(first)) return first[1] || null;
  if (first && typeof first === 'object' && Object.prototype.hasOwnProperty.call(first, 'value')) {
    return first.value;
  }
  return first || null;
}

function createRedisKeyValueStore({
  redisUrl = null,
  keyPrefix = 'cp:ss',
  connectTimeoutMs = 1500,
  redisClientFactory = null,
} = {}) {
  const normalizedRedisUrl = String(redisUrl || '').trim() || null;
  const resolvedFactory = resolveRedisClientFactory(redisClientFactory);
  const isConfigured = Boolean(normalizedRedisUrl && resolvedFactory.factory);

  let client = null;
  let connected = false;
  let connectPromise = null;
  let reasonCode = !normalizedRedisUrl
    ? 'redis_url_missing'
    : resolvedFactory.reasonCode;

  async function resolveClient() {
    if (!isConfigured) {
      throw createRedisStoreError(reasonCode || 'redis_not_configured');
    }

    if (client && connected) return client;
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
      try {
        client = resolvedFactory.factory({
          url: normalizedRedisUrl,
          socket: {
            connectTimeout: normalizeTtlMs(connectTimeoutMs, 1500),
          },
        });
      } catch (error) {
        reasonCode = 'redis_client_create_failed';
        throw createRedisStoreError(reasonCode, null, error);
      }

      if (!client || typeof client.connect !== 'function') {
        reasonCode = 'redis_client_invalid';
        throw createRedisStoreError(reasonCode);
      }

      if (typeof client.on === 'function') {
        client.on('error', () => {});
      }

      try {
        await withTimeout(client.connect(), connectTimeoutMs, 'redis_connect_timeout');
        connected = true;
        reasonCode = null;
        return client;
      } catch (error) {
        reasonCode =
          String(error?.reasonCode || '').trim() || 'redis_connect_failed';
        connected = false;
        try {
          await client.quit?.();
        } catch {}
        try {
          await client.disconnect?.();
        } catch {}
        throw createRedisStoreError(reasonCode, null, error);
      } finally {
        connectPromise = null;
      }
    })();

    return connectPromise;
  }

  function resolveRedisKeyOrThrow(key) {
    const redisKey = buildRedisStoreKey(keyPrefix, key);
    if (!redisKey) {
      throw createRedisStoreError('invalid_store_key');
    }
    return redisKey;
  }

  async function setValue(key, value, { ttlMs = null } = {}) {
    const redisKey = resolveRedisKeyOrThrow(key);
    const resolvedClient = await resolveClient();
    const serializedValue = serializeRedisValue(value);
    const ttl = normalizeTtlMs(ttlMs, null);
    if (ttl) {
      await resolvedClient.set(redisKey, serializedValue, { PX: ttl });
    } else {
      await resolvedClient.set(redisKey, serializedValue);
    }
    return true;
  }

  async function getValue(key) {
    const redisKey = resolveRedisKeyOrThrow(key);
    const resolvedClient = await resolveClient();
    const rawValue = await resolvedClient.get(redisKey);
    return parseRedisValue(rawValue);
  }

  async function deleteValue(key) {
    const redisKey = resolveRedisKeyOrThrow(key);
    const resolvedClient = await resolveClient();
    const deletedCount = await resolvedClient.del(redisKey);
    return Number(deletedCount || 0) > 0;
  }

  async function getAndDeleteValue(key) {
    const redisKey = resolveRedisKeyOrThrow(key);
    const resolvedClient = await resolveClient();

    if (typeof resolvedClient.sendCommand === 'function') {
      try {
        const rawValue = await resolvedClient.sendCommand(['GETDEL', redisKey]);
        return parseRedisValue(rawValue);
      } catch {
        // Older Redis servers may not support GETDEL; fallback below.
      }
    }

    if (typeof resolvedClient.multi === 'function') {
      const execResult = await resolvedClient.multi().get(redisKey).del(redisKey).exec();
      return parseRedisValue(parseMultiExecResult(execResult));
    }

    const rawValue = await resolvedClient.get(redisKey);
    await resolvedClient.del(redisKey);
    return parseRedisValue(rawValue);
  }

  async function close() {
    if (!client) return;
    connected = false;
    try {
      await client.quit?.();
    } catch {}
    try {
      await client.disconnect?.();
    } catch {}
    client = null;
  }

  function getStatus() {
    return {
      provider: 'redis',
      configured: isConfigured,
      connected,
      reasonCode: reasonCode || null,
    };
  }

  return {
    set: setValue,
    get: getValue,
    delete: deleteValue,
    getAndDelete: getAndDeleteValue,
    close,
    getStatus,
  };
}

module.exports = {
  createRedisKeyValueStore,
  createRedisStoreError,
};
