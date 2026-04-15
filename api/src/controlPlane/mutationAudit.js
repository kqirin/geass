function sanitizeString(value, fallback = null, { maxLength = 128 } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function sanitizeScope(scope = {}) {
  return {
    guildId: sanitizeString(scope?.guildId, null, { maxLength: 32 }),
    path: sanitizeString(scope?.path, null, { maxLength: 120 }),
    method: sanitizeString(scope?.method, null, { maxLength: 16 }),
  };
}

function sanitizeAuditEntry(entry = {}, nowMs = Date.now()) {
  const timestampMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  return {
    mutationType: sanitizeString(entry?.mutationType, 'unknown_mutation', {
      maxLength: 96,
    }),
    actorId: sanitizeString(entry?.actorId, null, { maxLength: 64 }),
    actorType: sanitizeString(entry?.actorType, null, { maxLength: 32 }),
    requestId: sanitizeString(entry?.requestId, null, { maxLength: 96 }),
    scope: sanitizeScope(entry?.scope),
    result: sanitizeString(entry?.result, 'unknown', { maxLength: 48 }),
    reasonCode: sanitizeString(entry?.reasonCode, null, { maxLength: 96 }),
    timestamp: new Date(timestampMs).toISOString(),
  };
}

function createInMemoryMutationAuditRecorder({
  nowFn = Date.now,
  maxEntries = 500,
  logFn = null,
} = {}) {
  const entries = [];
  const normalizedMaxEntries = Number.isFinite(Number(maxEntries)) && Number(maxEntries) > 0
    ? Number(maxEntries)
    : 500;

  async function record(entry = {}) {
    const auditEntry = sanitizeAuditEntry(entry, nowFn());
    entries.push(auditEntry);
    while (entries.length > normalizedMaxEntries) {
      entries.shift();
    }

    if (typeof logFn === 'function') {
      try {
        logFn('control_plane_mutation_audit', auditEntry);
      } catch {
        // Audit logging must never fail request handling.
      }
    }

    return auditEntry;
  }

  function listRecent({ limit = 50 } = {}) {
    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : 50;
    return entries.slice(-normalizedLimit);
  }

  return {
    record,
    listRecent,
  };
}

module.exports = {
  createInMemoryMutationAuditRecorder,
  sanitizeAuditEntry,
};
