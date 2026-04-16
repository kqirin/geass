export const DEFAULT_LOGS_UNAVAILABLE_MESSAGE =
  'Bu log t\u00fcr\u00fc i\u00e7in kay\u0131t kayna\u011f\u0131 hen\u00fcz aktif de\u011fil.';

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toSafeLimit(rawLimit = 25) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return 25;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

function toSafeCursor(value = null) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toSafeString(value = null) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function normalizeReadonlyLogsPayload(rawPayload = null, { guildId = null } = {}) {
  const payload =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? rawPayload
      : {};
  const pagination =
    payload.pagination &&
    typeof payload.pagination === 'object' &&
    !Array.isArray(payload.pagination)
      ? payload.pagination
      : {};
  const available = Boolean(payload.available);
  const reasonCode = toSafeString(payload.reasonCode);
  const explanation = toSafeString(payload.explanation);

  return {
    contractVersion: Number(payload.contractVersion || 1),
    guildId: toSafeString(payload.guildId) || toSafeString(guildId),
    available,
    items: toSafeArray(payload.items),
    pagination: {
      limit: toSafeLimit(pagination.limit),
      nextCursor: toSafeCursor(pagination.nextCursor),
    },
    reasonCode,
    explanation:
      explanation ||
      (available ? null : DEFAULT_LOGS_UNAVAILABLE_MESSAGE),
  };
}

export function resolveLogsCategoryState({
  payload = null,
  error = null,
  isLoading = false,
} = {}) {
  if (isLoading && !payload && !error) return 'loading';
  if (error) return 'error';
  if (!payload) return 'loading';
  if (!payload.available) return 'unavailable';

  const items = toSafeArray(payload.items);
  if (items.length === 0) return 'empty';
  return 'ready';
}

export function getUnavailableLogsMessage(payload = null) {
  const normalized = normalizeReadonlyLogsPayload(payload);
  return normalized.explanation || DEFAULT_LOGS_UNAVAILABLE_MESSAGE;
}
