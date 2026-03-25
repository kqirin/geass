const db = require('../database');

const timers = new Map();
const executingPenaltyIds = new Set();
const MAX_TIMER_MS = 2_147_000_000;
const RECONCILE_INTERVAL_MS = Math.max(30_000, Math.min(Number(process.env.PENALTY_RECONCILE_INTERVAL_MS) || 60_000, 300_000));
let reconcileTimer = null;

function getDiscordErrorCode(err) {
  return Number(err?.code || err?.rawError?.code || 0);
}

function isMissingGuildError(err) {
  return new Set([10004, 50001]).has(getDiscordErrorCode(err));
}

function isMissingMemberError(err) {
  return getDiscordErrorCode(err) === 10007;
}

async function markInactive(id) {
  await db.execute('UPDATE timed_penalties SET active = FALSE, revoked_at = ? WHERE id = ? AND active = TRUE', [
    Date.now(),
    id,
  ]);
}

async function getActivePenaltyById(id) {
  const [rows] = await db.execute(
    'SELECT id, guild_id, user_id, action_type, role_id, revoke_at FROM timed_penalties WHERE id = ? AND active = TRUE LIMIT 1',
    [Number(id)]
  );
  return rows?.[0] || null;
}

function normalizeRoleIds(roleIds) {
  return [...new Set((Array.isArray(roleIds) ? roleIds : []).map((x) => String(x || '').trim()).filter(Boolean))];
}

async function upsertRoleSnapshot(guildId, userId, roleIds) {
  const normalized = normalizeRoleIds(roleIds);
  await db.execute(
    `INSERT INTO timed_penalty_role_snapshots (guild_id, user_id, roles_json)
     VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       roles_json = EXCLUDED.roles_json,
       updated_at = CURRENT_TIMESTAMP`,
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

async function restoreJailRoles(client, { guildId, userId, jailRoleId = null }, logError = () => { }) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    await deleteRoleSnapshot(guildId, userId).catch(() => { });
    return { restored: false, restoredCount: 0 };
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    await deleteRoleSnapshot(guildId, userId).catch(() => { });
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
    await deleteRoleSnapshot(guildId, userId).catch(() => { });
    return { restored: true, restoredCount: restoreIds.length };
  } catch (err) {
    logError('jail_restore_failed', err, { guildId, userId });
    throw err;
  }
}

async function applyPenaltyRevoke(client, row, logError = () => { }) {
  let guild = client.guilds.cache.get(row.guild_id) || null;
  if (!guild) {
    try {
      guild = await client.guilds.fetch(row.guild_id);
    } catch (err) {
      if (isMissingGuildError(err)) {
        await markInactive(row.id);
        return { ok: true, inactiveMarked: true, skipped: 'guild_missing' };
      }

      logError('penalty_revoke_guild_fetch_failed', err, {
        penaltyId: row.id,
        guildId: row.guild_id,
      });
      return {
        ok: false,
        inactiveMarked: false,
        errorCode: 'guild_fetch_failed',
      };
    }
  }
  if (!guild) {
    await markInactive(row.id);
    return { ok: true, inactiveMarked: true, skipped: 'guild_missing' };
  }

  let member = null;
  try {
    member = await guild.members.fetch(row.user_id);
  } catch (err) {
    if (isMissingMemberError(err)) {
      await markInactive(row.id);
      return { ok: true, inactiveMarked: true, skipped: 'member_missing' };
    }

    logError('penalty_revoke_member_fetch_failed', err, {
      penaltyId: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
    });
    return {
      ok: false,
      inactiveMarked: false,
      errorCode: 'member_fetch_failed',
    };
  }

  if (!member) {
    await markInactive(row.id);
    return { ok: true, inactiveMarked: true, skipped: 'member_missing' };
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
    await markInactive(row.id);
    return { ok: true, inactiveMarked: true };
  } catch (err) {
    logError('penalty_revoke_failed', err, {
      penaltyId: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      action: row.action_type,
    });
    return {
      ok: false,
      inactiveMarked: false,
      errorCode: String(err?.code || err?.message || 'penalty_revoke_failed'),
    };
  }
}

async function executePenalty(client, row, logError = () => { }) {
  clearScheduledById(row.id);
  const penaltyId = Number(row.id);
  if (!Number.isFinite(penaltyId) || penaltyId <= 0) return;
  if (executingPenaltyIds.has(penaltyId)) return;

  executingPenaltyIds.add(penaltyId);
  try {
    const activeRow = await getActivePenaltyById(penaltyId).catch((err) => {
      logError('penalty_active_row_load_failed', err, { penaltyId });
      return null;
    });
    if (!activeRow) return;

    const revokeAt = Number(activeRow.revoke_at || 0);
    if (revokeAt > Date.now()) {
      scheduleRow(client, activeRow, logError);
      return;
    }

    await applyPenaltyRevoke(client, activeRow, logError);
  } catch (err) {
    logError('penalty_execute_failed', err, { penaltyId });
  } finally {
    executingPenaltyIds.delete(penaltyId);
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

function scheduleRow(client, row, logError = () => { }) {
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
      const [rows] = await db.execute('SELECT * FROM timed_penalties WHERE id = ? AND active = TRUE', [id]);
      if (rows?.[0]) scheduleRow(client, rows[0], logError);
      return;
    }

    await executePenalty(client, row, logError);
  }, boundedDelay);

  timers.set(id, timeout);
}

async function reconcileActivePenalties(client, logError = () => { }) {
  const [rows] = await db.execute('SELECT id, guild_id, user_id, action_type, role_id, revoke_at FROM timed_penalties WHERE active = TRUE ORDER BY revoke_at ASC');
  for (const row of rows || []) scheduleRow(client, row, logError);
  return (rows || []).length;
}

async function bootstrap(client, logError = () => { }) {
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

async function schedulePenalty(client, data, logError = () => { }) {
  const { guildId, userId, actionType, roleId = null, revokeAt, reason = null } = data;
  const [result] = await db.execute(
    `INSERT INTO timed_penalties
      (guild_id, user_id, action_type, role_id, revoke_at, reason, active, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, NULL)
     ON CONFLICT (guild_id, user_id, action_type) WHERE active = TRUE
     DO UPDATE SET
       role_id = EXCLUDED.role_id,
       revoke_at = EXCLUDED.revoke_at,
       reason = EXCLUDED.reason,
       active = TRUE,
       revoked_at = NULL
     RETURNING id, guild_id, user_id, action_type, role_id, revoke_at`,
    [guildId, userId, actionType, roleId, Number(revokeAt), reason]
  );

  let row = result.rows?.[0] || null;
  if (!row?.id) {
    const [rows] = await db.execute(
      `SELECT id, guild_id, user_id, action_type, role_id, revoke_at
       FROM timed_penalties
       WHERE guild_id = ?
         AND user_id = ?
         AND action_type = ?
         AND active = TRUE
       LIMIT 1`,
      [guildId, userId, actionType]
    );
    row = rows?.[0] || null;
  }

  const id = Number(row?.id || result.insertId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('timed_penalty_upsert_missing_id');
    err.code = 'TIMED_PENALTY_UPSERT_MISSING_ID';
    throw err;
  }
  scheduleRow(
    client,
    row || { id, guild_id: guildId, user_id: userId, action_type: actionType, role_id: roleId, revoke_at: Number(revokeAt) },
    logError
  );
  return id;
}

async function cancelPenalty(guildId, userId, actionType) {
  const [result] = await db.execute(
    `UPDATE timed_penalties
        SET active = FALSE,
            revoked_at = ?
      WHERE guild_id = ?
        AND user_id = ?
        AND action_type = ?
        AND active = TRUE
      RETURNING id`,
    [Date.now(), guildId, userId, actionType]
  );

  for (const row of result.rows || []) clearScheduledById(row.id);
  return Number(result.rowCount || result.rows?.length || 0);
}

function shutdown() {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }

  for (const timeout of timers.values()) clearTimeout(timeout);
  timers.clear();
  executingPenaltyIds.clear();
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
    applyPenaltyRevoke,
    getDiscordErrorCode,
  },
};

