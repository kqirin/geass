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

function mapRule(row) {
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    emojiType: row.emoji_type,
    emojiId: row.emoji_id || null,
    emojiName: row.emoji_name || null,
    triggerMode: row.trigger_mode,
    enabled: Boolean(row.enabled),
    cooldownSeconds: Number(row.cooldown_seconds || 0),
    onlyOnce: Boolean(row.only_once),
    groupKey: row.group_key || null,
    allowedRoles: parseJson(row.allowed_roles_json, []),
    excludedRoles: parseJson(row.excluded_roles_json, []),
    actions: parseJson(row.actions_json, []),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listRulesByGuild(guildId) {
  const [rows] = await db.execute('SELECT * FROM reaction_rules WHERE guild_id = ? ORDER BY id DESC', [guildId]);
  return (rows || []).map(mapRule);
}

async function listEnabledRulesByGuild(guildId) {
  const [rows] = await db.execute('SELECT * FROM reaction_rules WHERE guild_id = ? AND enabled = TRUE', [guildId]);
  return (rows || []).map(mapRule);
}

async function getRuleById(id) {
  const [rows] = await db.execute('SELECT * FROM reaction_rules WHERE id = ? LIMIT 1', [Number(id)]);
  const row = rows?.[0];
  return row ? mapRule(row) : null;
}

async function createRule(input) {
  const [result] = await db.execute(
    `INSERT INTO reaction_rules
      (guild_id, channel_id, message_id, emoji_type, emoji_id, emoji_name, trigger_mode, enabled, cooldown_seconds, only_once, group_key, allowed_roles_json, excluded_roles_json, actions_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      input.guildId,
      input.channelId,
      input.messageId,
      input.emojiType,
      input.emojiId || null,
      input.emojiName || null,
      input.triggerMode,
      Boolean(input.enabled),
      Number(input.cooldownSeconds || 0),
      Boolean(input.onlyOnce),
      input.groupKey || null,
      JSON.stringify(input.allowedRoles || []),
      JSON.stringify(input.excludedRoles || []),
      JSON.stringify(input.actions || []),
      input.createdBy || null,
    ]
  );
  return getRuleById(result.insertId);
}

async function updateRule(ruleId, input) {
  await db.execute(
    `UPDATE reaction_rules
       SET channel_id = ?,
           message_id = ?,
           emoji_type = ?,
           emoji_id = ?,
           emoji_name = ?,
           trigger_mode = ?,
           enabled = ?,
           cooldown_seconds = ?,
           only_once = ?,
           group_key = ?,
           allowed_roles_json = ?,
           excluded_roles_json = ?,
           actions_json = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND guild_id = ?`,
    [
      input.channelId,
      input.messageId,
      input.emojiType,
      input.emojiId || null,
      input.emojiName || null,
      input.triggerMode,
      Boolean(input.enabled),
      Number(input.cooldownSeconds || 0),
      Boolean(input.onlyOnce),
      input.groupKey || null,
      JSON.stringify(input.allowedRoles || []),
      JSON.stringify(input.excludedRoles || []),
      JSON.stringify(input.actions || []),
      Number(ruleId),
      input.guildId,
    ]
  );
  return getRuleById(ruleId);
}

async function deleteRule(ruleId, guildId) {
  await db.execute('DELETE FROM reaction_rules WHERE id = ? AND guild_id = ?', [Number(ruleId), guildId]);
}

async function logRuleEvent(input) {
  await db.execute(
    `INSERT INTO reaction_rule_logs
      (guild_id, rule_id, user_id, event_type, status, action_type, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.guildId,
      Number(input.ruleId),
      input.userId,
      input.eventType,
      input.status,
      input.actionType || null,
      input.errorCode || null,
      input.errorMessage ? String(input.errorMessage).slice(0, 255) : null,
    ]
  );
}

function normalizeEventType(eventType) {
  return String(eventType || '').trim().toUpperCase();
}

async function tryBeginOnlyOnceExecution({ guildId, ruleId, userId, eventType }) {
  const normalizedEventType = normalizeEventType(eventType);
  const [result] = await db.execute(
    `INSERT INTO reaction_rule_only_once_executions
      (rule_id, guild_id, user_id, event_type, state)
     VALUES (?, ?, ?, ?, 'PENDING')
     ON CONFLICT DO NOTHING
     RETURNING rule_id, guild_id, user_id, event_type, state`,
    [Number(ruleId), guildId, userId, normalizedEventType]
  );

  if (result.rows?.[0]) {
    return {
      acquired: true,
      state: result.rows[0].state || 'PENDING',
    };
  }

  const [rows] = await db.execute(
    `SELECT state
     FROM reaction_rule_only_once_executions
     WHERE rule_id = ?
       AND user_id = ?
       AND event_type = ?
     LIMIT 1`,
    [Number(ruleId), userId, normalizedEventType]
  );

  return {
    acquired: false,
    state: rows?.[0]?.state || null,
  };
}

async function markOnlyOnceExecutionSuccess({ ruleId, userId, eventType }) {
  const normalizedEventType = normalizeEventType(eventType);
  const [result] = await db.execute(
    `UPDATE reaction_rule_only_once_executions
        SET state = 'SUCCESS',
            updated_at = CURRENT_TIMESTAMP
      WHERE rule_id = ?
        AND user_id = ?
        AND event_type = ?`,
    [Number(ruleId), userId, normalizedEventType]
  );
  if (Number(result.affectedRows || result.rowCount || 0) !== 1) {
    const err = new Error('reaction_only_once_execution_missing');
    err.code = 'REACTION_ONLY_ONCE_EXECUTION_MISSING';
    err.ruleId = Number(ruleId);
    err.userId = userId;
    err.eventType = normalizedEventType;
    throw err;
  }
}

async function releaseOnlyOnceExecution({ ruleId, userId, eventType }) {
  const normalizedEventType = normalizeEventType(eventType);
  await db.execute(
    `DELETE FROM reaction_rule_only_once_executions
      WHERE rule_id = ?
        AND user_id = ?
        AND event_type = ?`,
    [Number(ruleId), userId, normalizedEventType]
  );
}

async function hasSuccessfulExecution(ruleId, userId, eventType = null) {
  const normalizedEventType = eventType ? normalizeEventType(eventType) : null;
  const executionWhere = ['rule_id = ?', 'user_id = ?', 'state = ?'];
  const executionParams = [Number(ruleId), userId, 'SUCCESS'];
  if (normalizedEventType) {
    executionWhere.push('event_type = ?');
    executionParams.push(normalizedEventType);
  }

  const [executionRows] = await db.execute(
    `SELECT rule_id
     FROM reaction_rule_only_once_executions
     WHERE ${executionWhere.join(' AND ')}
     LIMIT 1`,
    executionParams
  );
  if ((executionRows || []).length > 0) return true;

  const where = ['rule_id = ?', 'user_id = ?', 'status = ?'];
  const params = [Number(ruleId), userId, 'SUCCESS'];
  if (normalizedEventType) {
    where.push('event_type = ?');
    params.push(normalizedEventType);
  }

  const [rows] = await db.execute(
    `SELECT id
     FROM reaction_rule_logs
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    params
  );
  return (rows || []).length > 0;
}

module.exports = {
  listRulesByGuild,
  listEnabledRulesByGuild,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  logRuleEvent,
  tryBeginOnlyOnceExecution,
  markOnlyOnceExecutionSuccess,
  releaseOnlyOnceExecution,
  hasSuccessfulExecution,
};
