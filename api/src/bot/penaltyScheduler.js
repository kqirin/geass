const db = require('../database');

const timers = new Map();
const MAX_TIMER_MS = 2_147_000_000;
const RECONCILE_INTERVAL_MS = 60_000;
let reconcileTimer = null;

async function markInactive(id) {
  await db.execute('UPDATE timed_penalties SET active = 0, revoked_at = ? WHERE id = ? AND active = 1', [
    Date.now(),
    id,
  ]);
}

async function isPenaltyActive(id) {
  const [rows] = await db.execute('SELECT active FROM timed_penalties WHERE id = ? LIMIT 1', [Number(id)]);
  return Number(rows?.[0]?.active || 0) === 1;
}

function normalizeRoleIds(roleIds) {
  return [...new Set((Array.isArray(roleIds) ? roleIds : []).map((x) => String(x || '').trim()).filter(Boolean))];
}

async function upsertRoleSnapshot(guildId, userId, roleIds) {
  const normalized = normalizeRoleIds(roleIds);
  await db.execute(
    `INSERT INTO timed_penalty_role_snapshots (guild_id, user_id, roles_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE roles_json = VALUES(roles_json)`,
    [guildId, userId, JSON.stringify(normalized)]
  );
}

async function getRoleSnapshot(guildId, userId) {
  const [rows] = await db.execute(
    'SELECT roles_json FROM timed_penalty_role_snapshots WHERE guild_id = ? AND user_id = ? LIMIT 1',
    [guildId, userId]
  );
  const raw = rows?.[0]?.roles_json;
  if (!raw) return [];

  try {
    return normalizeRoleIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function deleteRoleSnapshot(guildId, userId) {
  await db.execute('DELETE FROM timed_penalty_role_snapshots WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

function filterRestorableRoleIds(guild, roleIds, jailRoleId) {
  const me = guild.members.me;
  const botTop = me?.roles?.highest?.position ?? -1;

  return normalizeRoleIds(roleIds).filter((roleId) => {
    if (roleId === guild.id) return false;
    if (jailRoleId && roleId === jailRoleId) return false;

    const role = guild.roles.cache.get(roleId);
    if (!role) return false;
    if (role.managed) return false;
    if (botTop >= 0 && role.position >= botTop) return false;
    return true;
  });
}

async function restoreJailRoles(client, { guildId, userId, jailRoleId = null }, logError = () => {}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    await deleteRoleSnapshot(guildId, userId).catch(() => {});
    return { restored: false, restoredCount: 0 };
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    await deleteRoleSnapshot(guildId, userId).catch(() => {});
    return { restored: false, restoredCount: 0 };
  }

  const snapshot = await getRoleSnapshot(guildId, userId);
  if (!snapshot.length) {
    if (jailRoleId && member.roles.cache.has(jailRoleId)) {
      await member.roles.remove(jailRoleId, 'Jail kaldirildi');
    }
    return { restored: false, restoredCount: 0 };
  }

  const restoreIds = filterRestorableRoleIds(guild, snapshot, jailRoleId);

  try {
    await member.roles.set(restoreIds, 'Jail kaldirildi');
    await deleteRoleSnapshot(guildId, userId).catch(() => {});
    return { restored: true, restoredCount: restoreIds.length };
  } catch (err) {
    logError('jail_restore_failed', err, { guildId, userId });
    throw err;
  }
}

async function applyPenaltyRevoke(client, row, logError = () => {}) {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) {
    await markInactive(row.id);
    return;
  }

  const member = await guild.members.fetch(row.user_id).catch(() => null);
  if (!member) {
    await markInactive(row.id);
    return;
  }

  try {
    if (row.action_type === 'mute' && row.role_id) {
      if (member.roles.cache.has(row.role_id)) await member.roles.remove(row.role_id, 'Sure doldu');
    } else if (row.action_type === 'jail') {
      await restoreJailRoles(
        client,
        { guildId: row.guild_id, userId: row.user_id, jailRoleId: row.role_id || null },
        logError
      );
    } else if (row.action_type === 'vcmute') {
      if (member.voice?.serverMute) await member.voice.setMute(false, 'Sure doldu');
    }
  } catch (err) {
    logError('penalty_revoke_failed', err, {
      penaltyId: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      action: row.action_type,
    });
  } finally {
    await markInactive(row.id);
  }
}

async function executePenalty(client, row, logError = () => {}) {
  clearScheduledById(row.id);
  const stillActive = await isPenaltyActive(row.id).catch((err) => {
    logError('penalty_active_check_failed', err, { penaltyId: row.id });
    return false;
  });
  if (!stillActive) return;

  try {
    await applyPenaltyRevoke(client, row, logError);
  } catch (err) {
    logError('penalty_execute_failed', err, { penaltyId: row.id });
  }
}

function clearScheduledById(penaltyId) {
  const id = Number(penaltyId);
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function scheduleRow(client, row, logError = () => {}) {
  const id = Number(row.id);
  if (!Number.isFinite(id) || id <= 0) return;
  clearScheduledById(id);

  const delay = Number(row.revoke_at) - Date.now();
  if (delay <= 0) {
    void executePenalty(client, row, logError);
    return;
  }

  const boundedDelay = Math.min(delay, MAX_TIMER_MS);
  const timeout = setTimeout(async () => {
    timers.delete(id);

    if (delay > MAX_TIMER_MS) {
      const [rows] = await db.execute('SELECT * FROM timed_penalties WHERE id = ? AND active = 1', [id]);
      if (rows?.[0]) scheduleRow(client, rows[0], logError);
      return;
    }

    await executePenalty(client, row, logError);
  }, boundedDelay);

  timers.set(id, timeout);
}

async function reconcileActivePenalties(client, logError = () => {}) {
  const [rows] = await db.execute('SELECT * FROM timed_penalties WHERE active = 1 ORDER BY revoke_at ASC');
  for (const row of rows || []) scheduleRow(client, row, logError);
  return (rows || []).length;
}

async function bootstrap(client, logError = () => {}) {
  const total = await reconcileActivePenalties(client, logError);

  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(() => {
    reconcileActivePenalties(client, logError).catch((err) => {
      logError('penalty_reconcile_failed', err);
    });
  }, RECONCILE_INTERVAL_MS);

  if (typeof reconcileTimer.unref === 'function') reconcileTimer.unref();

  return total;
}

async function schedulePenalty(client, data, logError = () => {}) {
  const { guildId, userId, actionType, roleId = null, revokeAt, reason = null } = data;
  const [result] = await db.execute(
    'INSERT INTO timed_penalties (guild_id, user_id, action_type, role_id, revoke_at, reason) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, userId, actionType, roleId, Number(revokeAt), reason]
  );

  const id = Number(result.insertId);
  scheduleRow(
    client,
    { id, guild_id: guildId, user_id: userId, action_type: actionType, role_id: roleId, revoke_at: Number(revokeAt) },
    logError
  );
  return id;
}

async function cancelPenalty(guildId, userId, actionType) {
  const [rows] = await db.execute(
    'SELECT id FROM timed_penalties WHERE guild_id = ? AND user_id = ? AND action_type = ? AND active = 1',
    [guildId, userId, actionType]
  );

  for (const row of rows || []) clearScheduledById(row.id);

  await db.execute(
    'UPDATE timed_penalties SET active = 0, revoked_at = ? WHERE guild_id = ? AND user_id = ? AND action_type = ? AND active = 1',
    [Date.now(), guildId, userId, actionType]
  );
}

function shutdown() {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }

  for (const timeout of timers.values()) clearTimeout(timeout);
  timers.clear();
}

module.exports = {
  bootstrap,
  schedulePenalty,
  cancelPenalty,
  upsertRoleSnapshot,
  getRoleSnapshot,
  deleteRoleSnapshot,
  restoreJailRoles,
  shutdown,
  __internal: {
    normalizeRoleIds,
    filterRestorableRoleIds,
  },
};

