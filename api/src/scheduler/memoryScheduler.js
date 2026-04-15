function normalizeJobIdentity(jobIdentity = '') {
  const normalized = String(jobIdentity || '').trim();
  return normalized || null;
}

function normalizeRecordTtlMs(ttlMs, fallback = null) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function cloneJobRecord(record = null) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return {
    ...record,
  };
}

function createMemorySchedulerBackend({ nowFn = Date.now } = {}) {
  const records = new Map();

  function nowMs() {
    const value = Number(nowFn());
    return Number.isFinite(value) ? value : Date.now();
  }

  function readRecord(jobIdentity) {
    const entry = records.get(jobIdentity);
    if (!entry) return null;
    const expiresAtMs = Number(entry.expiresAtMs || 0);
    if (expiresAtMs > 0 && expiresAtMs <= nowMs()) {
      records.delete(jobIdentity);
      return null;
    }
    return cloneJobRecord(entry.record);
  }

  async function upsertJobRecord(jobIdentity, record, { ttlMs = null } = {}) {
    const normalizedIdentity = normalizeJobIdentity(jobIdentity);
    if (!normalizedIdentity) return false;
    const expiresInMs = normalizeRecordTtlMs(ttlMs, null);

    records.set(normalizedIdentity, {
      record: cloneJobRecord(record),
      expiresAtMs: expiresInMs ? nowMs() + expiresInMs : null,
    });
    return true;
  }

  async function getJobRecord(jobIdentity) {
    const normalizedIdentity = normalizeJobIdentity(jobIdentity);
    if (!normalizedIdentity) return null;
    return readRecord(normalizedIdentity);
  }

  async function deleteJobRecord(jobIdentity) {
    const normalizedIdentity = normalizeJobIdentity(jobIdentity);
    if (!normalizedIdentity) return false;
    return records.delete(normalizedIdentity);
  }

  async function close() {
    records.clear();
  }

  function getStatus() {
    return {
      provider: 'memory',
      configured: true,
      connected: true,
      reasonCode: null,
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
  createMemorySchedulerBackend,
  normalizeJobIdentity,
};
