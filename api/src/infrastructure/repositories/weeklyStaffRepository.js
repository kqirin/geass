const db = require('../../database');

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function getConfig(guildId) {
  const [rows] = await db.execute('SELECT * FROM weekly_staff_config WHERE guild_id = ? LIMIT 1', [guildId]);
  const row = rows?.[0];
  if (!row) return null;

  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    awardRoleId: row.award_role_id || null,
    announcementChannelId: row.announcement_channel_id || null,
    announcementMessage: row.announcement_message || null,
    timezone: row.timezone || 'Europe/Istanbul',
    weekStartDow: Number(row.week_start_dow || 1),
    minimumPoints: Number(row.minimum_points || 20),
    tieBreakMode: row.tie_break_mode || 'moderation_first',
    eligibleRoles: parseJson(row.eligible_roles_json, []),
    excludedRoles: parseJson(row.excluded_roles_json, []),
    weights: parseJson(row.weights_json, {}),
    spamGuard: parseJson(row.spam_guard_json, {}),
  };
}

async function upsertConfig(guildId, cfg) {
  await db.execute(
    `INSERT INTO weekly_staff_config
      (guild_id, enabled, award_role_id, announcement_channel_id, announcement_message, timezone, week_start_dow, minimum_points, tie_break_mode, eligible_roles_json, excluded_roles_json, weights_json, spam_guard_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       award_role_id = VALUES(award_role_id),
       announcement_channel_id = VALUES(announcement_channel_id),
       announcement_message = VALUES(announcement_message),
       timezone = VALUES(timezone),
       week_start_dow = VALUES(week_start_dow),
       minimum_points = VALUES(minimum_points),
       tie_break_mode = VALUES(tie_break_mode),
       eligible_roles_json = VALUES(eligible_roles_json),
       excluded_roles_json = VALUES(excluded_roles_json),
       weights_json = VALUES(weights_json),
       spam_guard_json = VALUES(spam_guard_json)`,
    [
      guildId,
      cfg.enabled ? 1 : 0,
      cfg.awardRoleId || null,
      cfg.announcementChannelId || null,
      cfg.announcementMessage || null,
      cfg.timezone || 'Europe/Istanbul',
      Number(cfg.weekStartDow || 1),
      Number(cfg.minimumPoints || 20),
      cfg.tieBreakMode || 'moderation_first',
      JSON.stringify(cfg.eligibleRoles || []),
      JSON.stringify(cfg.excludedRoles || []),
      JSON.stringify(cfg.weights || {}),
      JSON.stringify(cfg.spamGuard || {}),
    ]
  );
}

async function listEnabledConfigs() {
  const [rows] = await db.execute('SELECT guild_id FROM weekly_staff_config WHERE enabled = 1');
  return (rows || []).map((r) => r.guild_id);
}

async function insertEvent(row) {
  await db.execute(
    'INSERT INTO weekly_staff_events (guild_id, user_id, event_type, command_name, points_delta, occurred_at, week_start, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      row.guildId,
      row.userId,
      row.eventType,
      row.commandName || null,
      Number(row.pointsDelta || 0),
      Number(row.occurredAt),
      Number(row.weekStart),
      row.metadata ? JSON.stringify(row.metadata) : null,
    ]
  );
}

async function getScoreRow(guildId, userId, weekStart) {
  const [rows] = await db.execute(
    'SELECT * FROM weekly_staff_scores WHERE guild_id = ? AND user_id = ? AND week_start = ? LIMIT 1',
    [guildId, userId, Number(weekStart)]
  );
  return rows?.[0] || null;
}

async function upsertScoreDelta({ guildId, userId, weekStart, weekEnd, pointsDelta, commandDelta, moderationDelta, breakdownKey }) {
  const row = await getScoreRow(guildId, userId, weekStart);
  if (!row) {
    const breakdown = {};
    if (breakdownKey) breakdown[breakdownKey] = Number(pointsDelta || 0);
    await db.execute(
      `INSERT INTO weekly_staff_scores
       (guild_id, user_id, week_start, week_end, points, moderation_actions, command_count, breakdown_json, finalized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        guildId,
        userId,
        Number(weekStart),
        Number(weekEnd),
        Number(pointsDelta || 0),
        Number(moderationDelta || 0),
        Number(commandDelta || 0),
        JSON.stringify(breakdown),
      ]
    );
    return;
  }

  const breakdown = parseJson(row.breakdown_json, {});
  if (breakdownKey) {
    breakdown[breakdownKey] = Number(breakdown[breakdownKey] || 0) + Number(pointsDelta || 0);
  }

  await db.execute(
    `UPDATE weekly_staff_scores
      SET week_end = ?,
          points = points + ?,
          moderation_actions = moderation_actions + ?,
          command_count = command_count + ?,
          breakdown_json = ?
     WHERE guild_id = ? AND user_id = ? AND week_start = ?`,
    [
      Number(weekEnd),
      Number(pointsDelta || 0),
      Number(moderationDelta || 0),
      Number(commandDelta || 0),
      JSON.stringify(breakdown),
      guildId,
      userId,
      Number(weekStart),
    ]
  );
}

async function getWeekScores(guildId, weekStart) {
  const [rows] = await db.execute(
    'SELECT * FROM weekly_staff_scores WHERE guild_id = ? AND week_start = ? ORDER BY points DESC, moderation_actions DESC, command_count DESC',
    [guildId, Number(weekStart)]
  );
  return rows || [];
}

async function finalizeWeek(guildId, weekStart) {
  await db.execute('UPDATE weekly_staff_scores SET finalized = 1 WHERE guild_id = ? AND week_start = ?', [guildId, Number(weekStart)]);
}

async function deactivateActiveWinners(guildId) {
  await db.execute('UPDATE weekly_staff_winners SET active = 0 WHERE guild_id = ? AND active = 1', [guildId]);
}

async function insertWinner(row) {
  await db.execute(
    `INSERT INTO weekly_staff_winners
      (guild_id, week_start, week_end, winner_user_id, points, moderation_actions, awarded_at, expires_at, active, tie_info_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      row.guildId,
      Number(row.weekStart),
      Number(row.weekEnd),
      row.winnerUserId,
      Number(row.points || 0),
      Number(row.moderationActions || 0),
      Number(row.awardedAt),
      Number(row.expiresAt),
      row.tieInfo ? JSON.stringify(row.tieInfo) : null,
    ]
  );
}

async function getActiveWinners(guildId) {
  const [rows] = await db.execute('SELECT * FROM weekly_staff_winners WHERE guild_id = ? AND active = 1', [guildId]);
  return rows || [];
}

async function getExpiredActiveWinners(nowPseudo) {
  const [rows] = await db.execute('SELECT * FROM weekly_staff_winners WHERE active = 1 AND expires_at <= ?', [Number(nowPseudo)]);
  return rows || [];
}

async function deactivateWinner(guildId, weekStart, userId) {
  await db.execute(
    'UPDATE weekly_staff_winners SET active = 0 WHERE guild_id = ? AND week_start = ? AND winner_user_id = ?',
    [guildId, Number(weekStart), userId]
  );
}

async function getLeaderboard(guildId, weekStart, limit = 20) {
  const [rows] = await db.execute(
    'SELECT * FROM weekly_staff_scores WHERE guild_id = ? AND week_start = ? ORDER BY points DESC, moderation_actions DESC LIMIT ?',
    [guildId, Number(weekStart), Number(limit)]
  );
  return rows || [];
}

async function getWinnerHistory(guildId, limit = 20) {
  const [rows] = await db.execute(
    'SELECT * FROM weekly_staff_winners WHERE guild_id = ? ORDER BY week_start DESC LIMIT ?',
    [guildId, Number(limit)]
  );
  return rows || [];
}

async function getWinnerForWeek(guildId, weekStart) {
  const [rows] = await db.execute(
    'SELECT * FROM weekly_staff_winners WHERE guild_id = ? AND week_start = ? ORDER BY points DESC LIMIT 1',
    [guildId, Number(weekStart)]
  );
  return rows?.[0] || null;
}

module.exports = {
  getConfig,
  upsertConfig,
  listEnabledConfigs,
  insertEvent,
  upsertScoreDelta,
  getWeekScores,
  finalizeWeek,
  deactivateActiveWinners,
  insertWinner,
  getActiveWinners,
  getExpiredActiveWinners,
  deactivateWinner,
  getLeaderboard,
  getWinnerHistory,
  getWinnerForWeek,
};
