function normalizeStoreKey(key) {
  const normalized = String(key || '').trim();
  return normalized || null;
}

function normalizeTtlMs(ttlMs, fallback = null) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function createMemoryKeyValueStore({ nowFn = Date.now } = {}) {
  const store = new Map();

  function nowMs() {
    const current = Number(nowFn());
    return Number.isFinite(current) ? current : Date.now();
  }

  function pruneExpiredForKey(key) {
    const record = store.get(key);
    if (!record) return null;

    const expiresAtMs = Number(record.expiresAtMs || 0);
    if (expiresAtMs > 0 && expiresAtMs <= nowMs()) {
      store.delete(key);
      return null;
    }

    return record;
  }

  async function setValue(key, value, { ttlMs = null } = {}) {
    const normalizedKey = normalizeStoreKey(key);
    if (!normalizedKey) return false;
    const expiresInMs = normalizeTtlMs(ttlMs, null);
    const expiresAtMs = expiresInMs ? nowMs() + expiresInMs : null;

    store.set(normalizedKey, {
      value,
      expiresAtMs,
    });
    return true;
  }

  async function getValue(key) {
    const normalizedKey = normalizeStoreKey(key);
    if (!normalizedKey) return null;
    const record = pruneExpiredForKey(normalizedKey);
    return record ? record.value : null;
  }

  async function deleteValue(key) {
    const normalizedKey = normalizeStoreKey(key);
    if (!normalizedKey) return false;
    return store.delete(normalizedKey);
  }

  async function getAndDeleteValue(key) {
    const normalizedKey = normalizeStoreKey(key);
    if (!normalizedKey) return null;
    const record = pruneExpiredForKey(normalizedKey);
    if (!record) return null;
    store.delete(normalizedKey);
    return record.value;
  }

  async function close() {
    store.clear();
  }

  function getStatus() {
    return {
      provider: 'memory',
      connected: true,
      configured: true,
      reasonCode: null,
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
  createMemoryKeyValueStore,
  normalizeStoreKey,
};
