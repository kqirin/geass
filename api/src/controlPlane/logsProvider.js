const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  listModerationLogsByGuild,
} = require('../infrastructure/repositories/moderationLogRepository');

const UNAVAILABLE_EXPLANATION =
  'Bu log t\u00fcr\u00fc i\u00e7in kay\u0131t kayna\u011f\u0131 hen\u00fcz aktif de\u011fil.';

function normalizeLimit(rawLimit = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(String(rawLimit || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeOffsetCursor(rawCursor = null) {
  const parsed = Number.parseInt(String(rawCursor || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeCursor(rawCursor = null) {
  const value = String(rawCursor || '').trim();
  return value || null;
}

function toIsoTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  const parsedMs = Date.parse(String(value));
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(parsedMs).toISOString();
}

function sanitizeString(value, { maxLength = 255, fallback = null } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function resolveGuildId(routeContext = {}) {
  const fromScope = String(routeContext?.requestContext?.guildScope?.guildId || '').trim();
  if (fromScope) return fromScope;
  const fromQuery = String(routeContext?.query?.guildId || '').trim();
  return fromQuery || null;
}

function createBaseLogsPayload({
  guildId = null,
  available = true,
  items = [],
  limit = DEFAULT_LIMIT,
  nextCursor = null,
  reasonCode = null,
  explanation = null,
} = {}) {
  return {
    contractVersion: 1,
    guildId: String(guildId || '').trim() || null,
    available: Boolean(available),
    items: Array.isArray(items) ? items : [],
    pagination: {
      limit: normalizeLimit(limit),
      nextCursor: normalizeCursor(nextCursor),
    },
    reasonCode: reasonCode === null ? null : sanitizeString(reasonCode, { maxLength: 96 }),
    explanation: explanation === null ? null : sanitizeString(explanation, { maxLength: 255 }),
  };
}

function createUnavailablePayload({
  guildId = null,
  limit = DEFAULT_LIMIT,
  reasonCode = 'logs_not_available',
  explanation = UNAVAILABLE_EXPLANATION,
} = {}) {
  return createBaseLogsPayload({
    guildId,
    available: false,
    items: [],
    limit,
    nextCursor: null,
    reasonCode,
    explanation,
  });
}

function sanitizeModerationItem(item = {}) {
  return {
    id: sanitizeString(item.id, { maxLength: 64 }),
    action: sanitizeString(item.action, { maxLength: 64 }),
    targetUserId: sanitizeString(item.targetUserId, { maxLength: 32 }),
    moderatorUserId: sanitizeString(item.moderatorUserId, { maxLength: 32 }),
    reason: sanitizeString(item.reason, { maxLength: 255 }),
    createdAt: toIsoTimestamp(item.createdAt),
    expiresAt: toIsoTimestamp(item.expiresAt),
    status: sanitizeString(item.status, { maxLength: 48 }),
  };
}

function sanitizeCommandItem(item = {}) {
  return {
    id: sanitizeString(item.id, { maxLength: 64 }),
    commandName: sanitizeString(item.commandName, { maxLength: 64 }),
    userId: sanitizeString(item.userId, { maxLength: 32 }),
    channelId: sanitizeString(item.channelId, { maxLength: 32 }),
    status: sanitizeString(item.status, { maxLength: 48 }),
    createdAt: toIsoTimestamp(item.createdAt),
  };
}

function sanitizeSystemItem(item = {}) {
  return {
    id: sanitizeString(item.id, { maxLength: 96 }),
    eventType: sanitizeString(item.eventType, { maxLength: 96 }),
    actorUserId: sanitizeString(item.actorUserId, { maxLength: 32 }),
    actorType: sanitizeString(item.actorType, { maxLength: 32 }),
    requestId: sanitizeString(item.requestId, { maxLength: 96 }),
    path: sanitizeString(item.path, { maxLength: 120 }),
    method: sanitizeString(item.method, { maxLength: 16 }),
    result: sanitizeString(item.result, { maxLength: 48 }),
    reasonCode: sanitizeString(item.reasonCode, { maxLength: 96 }),
    createdAt: toIsoTimestamp(item.createdAt),
  };
}

function isSourceUnavailableError(error = null) {
  const code = String(error?.code || '').trim().toUpperCase();
  const reasonCode = String(error?.reasonCode || '').trim().toLowerCase();
  return code === '42P01' || reasonCode === 'source_not_available';
}

function createModerationLogsProvider({
  moderationLogSource = null,
} = {}) {
  const source =
    moderationLogSource && typeof moderationLogSource.listByGuildCursor === 'function'
      ? moderationLogSource
      : {
          listByGuildCursor: listModerationLogsByGuild,
        };

  return async function getModerationLogs(routeContext = {}) {
    const guildId = resolveGuildId(routeContext);
    const limit = normalizeLimit(routeContext?.query?.limit);
    const cursor = normalizeCursor(routeContext?.query?.cursor);

    if (!source || typeof source.listByGuildCursor !== 'function') {
      return createUnavailablePayload({
        guildId,
        limit,
        reasonCode: 'moderation_logs_not_available',
      });
    }

    try {
      const result = await source.listByGuildCursor({
        guildId,
        limit,
        cursor,
      });
      const items = Array.isArray(result?.items)
        ? result.items.map((item) => sanitizeModerationItem(item))
        : [];

      return createBaseLogsPayload({
        guildId,
        available: true,
        items,
        limit,
        nextCursor: normalizeCursor(result?.nextCursor),
        reasonCode: null,
        explanation: null,
      });
    } catch (error) {
      if (isSourceUnavailableError(error)) {
        return createUnavailablePayload({
          guildId,
          limit,
          reasonCode: 'moderation_logs_not_available',
        });
      }

      return createUnavailablePayload({
        guildId,
        limit,
        reasonCode: 'moderation_logs_not_available',
      });
    }
  };
}

function createCommandLogsProvider({
  commandLogSource = null,
} = {}) {
  const source =
    commandLogSource && typeof commandLogSource.listByGuildCursor === 'function'
      ? commandLogSource
      : null;

  return async function getCommandLogs(routeContext = {}) {
    const guildId = resolveGuildId(routeContext);
    const limit = normalizeLimit(routeContext?.query?.limit);
    const cursor = normalizeCursor(routeContext?.query?.cursor);

    if (!source) {
      return createUnavailablePayload({
        guildId,
        limit,
        reasonCode: 'command_logs_not_available',
      });
    }

    try {
      const result = await source.listByGuildCursor({
        guildId,
        limit,
        cursor,
      });
      const items = Array.isArray(result?.items)
        ? result.items.map((item) => sanitizeCommandItem(item))
        : [];

      return createBaseLogsPayload({
        guildId,
        available: true,
        items,
        limit,
        nextCursor: normalizeCursor(result?.nextCursor),
        reasonCode: null,
        explanation: null,
      });
    } catch {
      return createUnavailablePayload({
        guildId,
        limit,
        reasonCode: 'command_logs_not_available',
      });
    }
  };
}

function createMutationAuditSystemLogSource({
  mutationAuditRecorder = null,
} = {}) {
  if (
    !mutationAuditRecorder ||
    typeof mutationAuditRecorder.listRecent !== 'function'
  ) {
    return null;
  }

  return {
    async listByGuildCursor({ guildId = null, limit = DEFAULT_LIMIT, cursor = null } = {}) {
      const normalizedGuildId = String(guildId || '').trim();
      const normalizedLimit = normalizeLimit(limit);
      const offset = normalizeOffsetCursor(cursor);

      const sourceEntries = mutationAuditRecorder.listRecent({
        limit: Math.min(500, offset + normalizedLimit + 1),
      });
      const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
      const filtered = entries.filter(
        (entry) => String(entry?.scope?.guildId || '').trim() === normalizedGuildId
      );
      const descending = filtered.slice().reverse();
      const paged = descending.slice(offset, offset + normalizedLimit + 1);
      const hasMore = paged.length > normalizedLimit;
      const pageItems = hasMore ? paged.slice(0, normalizedLimit) : paged;

      return {
        items: pageItems.map((entry, index) => ({
          id: sanitizeString(
            `${String(entry?.requestId || 'mutation')}:${offset + index + 1}`,
            { maxLength: 96 }
          ),
          eventType: sanitizeString(entry?.mutationType, {
            maxLength: 96,
            fallback: 'unknown_mutation',
          }),
          actorUserId: sanitizeString(entry?.actorId, { maxLength: 32 }),
          actorType: sanitizeString(entry?.actorType, { maxLength: 32 }),
          requestId: sanitizeString(entry?.requestId, { maxLength: 96 }),
          path: sanitizeString(entry?.scope?.path, { maxLength: 120 }),
          method: sanitizeString(entry?.scope?.method, { maxLength: 16 }),
          result: sanitizeString(entry?.result, { maxLength: 48 }),
          reasonCode: sanitizeString(entry?.reasonCode, { maxLength: 96 }),
          createdAt: toIsoTimestamp(entry?.timestamp),
        })),
        nextCursor: hasMore ? String(offset + normalizedLimit) : null,
      };
    },
  };
}

function createSystemLogsProvider({
  systemLogSource = null,
} = {}) {
  const source =
    systemLogSource && typeof systemLogSource.listByGuildCursor === 'function'
      ? systemLogSource
      : null;

  return async function getSystemLogs(routeContext = {}) {
    const guildId = resolveGuildId(routeContext);
    const limit = normalizeLimit(routeContext?.query?.limit);
    const cursor = normalizeCursor(routeContext?.query?.cursor);

    if (!source) {
      return createUnavailablePayload({
        guildId,
        limit,
        reasonCode: 'system_logs_not_available',
      });
    }

    try {
      const result = await source.listByGuildCursor({
        guildId,
        limit,
        cursor,
      });
      const items = Array.isArray(result?.items)
        ? result.items.map((item) => sanitizeSystemItem(item))
        : [];

      return createBaseLogsPayload({
        guildId,
        available: true,
        items,
        limit,
        nextCursor: normalizeCursor(result?.nextCursor),
        reasonCode: null,
        explanation: null,
      });
    } catch {
      return createUnavailablePayload({
        guildId,
        limit,
        reasonCode: 'system_logs_not_available',
      });
    }
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  UNAVAILABLE_EXPLANATION,
  createBaseLogsPayload,
  createCommandLogsProvider,
  createModerationLogsProvider,
  createMutationAuditSystemLogSource,
  createSystemLogsProvider,
};
