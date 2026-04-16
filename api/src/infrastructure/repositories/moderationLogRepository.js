const db = require('../../database');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function normalizeLimit(rawLimit = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(String(rawLimit || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeCursor(rawCursor = null) {
  const parsed = Number.parseInt(String(rawCursor || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

function mapModerationLogRow(row = {}) {
  return {
    id: String(row.id || '').trim() || null,
    action: String(row.action_type || '').trim() || null,
    targetUserId: String(row.user_id || '').trim() || null,
    moderatorUserId: String(row.moderator_id || '').trim() || null,
    reason: String(row.reason || '').trim() || null,
    createdAt: toIsoTimestamp(row.created_at),
    expiresAt: null,
    status: null,
  };
}

async function listModerationLogsByGuild({
  guildId = null,
  limit = DEFAULT_LIMIT,
  cursor = null,
} = {}) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) {
    return {
      items: [],
      nextCursor: null,
    };
  }

  const normalizedLimit = normalizeLimit(limit);
  const normalizedCursor = normalizeCursor(cursor);
  const fetchLimit = normalizedLimit + 1;

  const query = normalizedCursor
    ? `SELECT id, action_type, user_id, moderator_id, reason, created_at
       FROM mod_logs
       WHERE guild_id = ?
         AND id < ?
       ORDER BY id DESC
       LIMIT ?`
    : `SELECT id, action_type, user_id, moderator_id, reason, created_at
       FROM mod_logs
       WHERE guild_id = ?
       ORDER BY id DESC
       LIMIT ?`;
  const params = normalizedCursor
    ? [normalizedGuildId, normalizedCursor, fetchLimit]
    : [normalizedGuildId, fetchLimit];

  const [rows] = await db.execute(query, params);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const hasMore = normalizedRows.length > normalizedLimit;
  const pageRows = hasMore ? normalizedRows.slice(0, normalizedLimit) : normalizedRows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(mapModerationLogRow),
    nextCursor: hasMore && lastRow?.id ? String(lastRow.id) : null,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  listModerationLogsByGuild,
};
