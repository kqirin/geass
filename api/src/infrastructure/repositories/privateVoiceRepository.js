const db = require('../../database');
const { getPrivateVoiceConfig } = require('../../config/static');

function parseWhitelist(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return normalizeWhitelist(rawValue);
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return normalizeWhitelist(parsed);
  } catch {
    return [];
  }
}

function normalizeWhitelist(ids) {
  const out = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    const clean = String(id || '').trim().replace(/[^\d]/g, '');
    if (clean) out.add(clean);
  }
  return [...out];
}

function normalizeLockStateValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'allow' || raw === 'deny' || raw === 'inherit') return raw;
  return 'inherit';
}

function normalizeLockSnapshot(rawValue) {
  if (!rawValue) return null;
  let parsed = rawValue;

  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const memberStates = {};
  const rawMemberStates =
    parsed.memberConnectStatesBeforeLock && typeof parsed.memberConnectStatesBeforeLock === 'object'
      ? parsed.memberConnectStatesBeforeLock
      : {};
  for (const [memberId, state] of Object.entries(rawMemberStates)) {
    const cleanId = String(memberId || '').trim();
    if (!cleanId) continue;
    memberStates[cleanId] = normalizeLockStateValue(state);
  }

  const roleStates = {};
  const rawRoleStates =
    parsed.roleConnectStatesBeforeLock && typeof parsed.roleConnectStatesBeforeLock === 'object'
      ? parsed.roleConnectStatesBeforeLock
      : {};
  for (const [roleId, state] of Object.entries(rawRoleStates)) {
    const cleanId = String(roleId || '').trim();
    if (!cleanId) continue;
    roleStates[cleanId] = normalizeLockStateValue(state);
  }

  const snapshot = {
    everyoneRoleId: String(parsed.everyoneRoleId || '').trim() || null,
    everyoneConnectStateBeforeLock: normalizeLockStateValue(parsed.everyoneConnectStateBeforeLock),
    memberConnectStatesBeforeLock: memberStates,
    roleConnectStatesBeforeLock: roleStates,
    managedAllowMemberIds: normalizeWhitelist(parsed.managedAllowMemberIds),
    managedDenyMemberIds: normalizeWhitelist(parsed.managedDenyMemberIds),
    managedAllowRoleIds: normalizeWhitelist(parsed.managedAllowRoleIds),
    managedDenyRoleIds: normalizeWhitelist(parsed.managedDenyRoleIds),
    fallbackMode: Boolean(parsed.fallbackMode),
  };

  if (!snapshot.everyoneRoleId) return null;
  return snapshot;
}

function normalizeVisibilityStateValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'allow' || raw === 'deny' || raw === 'inherit') return raw;
  return 'inherit';
}

function normalizeVisibilitySnapshot(rawValue) {
  if (!rawValue) return null;
  let parsed = rawValue;

  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const roleStates = {};
  const rawRoleStates =
    parsed.roleViewStatesBeforeHide && typeof parsed.roleViewStatesBeforeHide === 'object'
      ? parsed.roleViewStatesBeforeHide
      : {};
  for (const [roleId, state] of Object.entries(rawRoleStates)) {
    const cleanId = String(roleId || '').trim();
    if (!cleanId) continue;
    roleStates[cleanId] = normalizeVisibilityStateValue(state);
  }

  const snapshot = {
    everyoneRoleId: String(parsed.everyoneRoleId || '').trim() || null,
    everyoneViewStateBeforeHide: normalizeVisibilityStateValue(parsed.everyoneViewStateBeforeHide),
    roleViewStatesBeforeHide: roleStates,
    managedDenyRoleIds: normalizeWhitelist(parsed.managedDenyRoleIds),
  };

  if (!snapshot.everyoneRoleId) return null;
  return snapshot;
}

function mapRoom(row) {
  if (!row) return null;
  const permitMemberIds = parseWhitelist(row.whitelist_member_ids_json);
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    ownerId: row.owner_id,
    voiceChannelId: row.voice_channel_id,
    panelMessageId: row.panel_message_id || null,
    locked: Boolean(row.locked),
    lockSnapshot: normalizeLockSnapshot(row.lock_snapshot_json),
    visibilitySnapshot: normalizeVisibilitySnapshot(row.visibility_snapshot_json),
    whitelistMemberIds: permitMemberIds,
    permitMemberIds,
    permitRoleIds: parseWhitelist(row.permit_role_ids_json),
    rejectMemberIds: parseWhitelist(row.reject_member_ids_json),
    rejectRoleIds: parseWhitelist(row.reject_role_ids_json),
    lastActiveAt: Number(row.last_active_at || 0),
  };
}

async function getGuildConfig(guildId) {
  return getPrivateVoiceConfig(guildId);
}

async function listAllRooms() {
  const [rows] = await db.execute('SELECT * FROM private_voice_rooms');
  return (rows || []).map(mapRoom);
}

async function getRoomByOwner(guildId, ownerId) {
  const [rows] = await db.execute(
    'SELECT * FROM private_voice_rooms WHERE guild_id = ? AND owner_id = ? LIMIT 1',
    [guildId, ownerId]
  );
  return mapRoom(rows?.[0]);
}

async function getRoomByChannel(guildId, voiceChannelId) {
  const [rows] = await db.execute(
    'SELECT * FROM private_voice_rooms WHERE guild_id = ? AND voice_channel_id = ? LIMIT 1',
    [guildId, voiceChannelId]
  );
  return mapRoom(rows?.[0]);
}

async function createRoom({
  guildId,
  ownerId,
  voiceChannelId,
  panelMessageId = null,
  locked = false,
  lockSnapshot = null,
  visibilitySnapshot = null,
  whitelistMemberIds = [],
  permitMemberIds = undefined,
  permitRoleIds = [],
  rejectMemberIds = [],
  rejectRoleIds = [],
  lastActiveAt = Date.now(),
}) {
  const normalizedWhitelist = normalizeWhitelist(
    permitMemberIds !== undefined ? permitMemberIds : whitelistMemberIds
  );
  const normalizedPermitRoles = normalizeWhitelist(permitRoleIds);
  const normalizedRejectMembers = normalizeWhitelist(rejectMemberIds);
  const normalizedRejectRoles = normalizeWhitelist(rejectRoleIds);
  const normalizedLockSnapshot = normalizeLockSnapshot(lockSnapshot);
  const normalizedVisibilitySnapshot = normalizeVisibilitySnapshot(visibilitySnapshot);
  const [result] = await db.execute(
    `INSERT INTO private_voice_rooms
      (guild_id, owner_id, voice_channel_id, panel_message_id, locked, lock_snapshot_json, visibility_snapshot_json, whitelist_member_ids_json, permit_role_ids_json, reject_member_ids_json, reject_role_ids_json, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      guildId,
      ownerId,
      voiceChannelId,
      panelMessageId || null,
      Boolean(locked),
      normalizedLockSnapshot ? JSON.stringify(normalizedLockSnapshot) : null,
      normalizedVisibilitySnapshot ? JSON.stringify(normalizedVisibilitySnapshot) : null,
      JSON.stringify(normalizedWhitelist),
      JSON.stringify(normalizedPermitRoles),
      JSON.stringify(normalizedRejectMembers),
      JSON.stringify(normalizedRejectRoles),
      Number(lastActiveAt),
    ]
  );
  return mapRoom(result.rows?.[0]);
}

async function updateRoom(roomId, patch) {
  const updates = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(patch, 'panelMessageId')) {
    updates.push('panel_message_id = ?');
    values.push(patch.panelMessageId || null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ownerId')) {
    updates.push('owner_id = ?');
    values.push(String(patch.ownerId || '').trim() || null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'locked')) {
    updates.push('locked = ?');
    values.push(Boolean(patch.locked));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lockSnapshot')) {
    updates.push('lock_snapshot_json = ?');
    const normalizedLockSnapshot = normalizeLockSnapshot(patch.lockSnapshot);
    values.push(normalizedLockSnapshot ? JSON.stringify(normalizedLockSnapshot) : null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'visibilitySnapshot')) {
    updates.push('visibility_snapshot_json = ?');
    const normalizedVisibilitySnapshot = normalizeVisibilitySnapshot(patch.visibilitySnapshot);
    values.push(normalizedVisibilitySnapshot ? JSON.stringify(normalizedVisibilitySnapshot) : null);
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'whitelistMemberIds') ||
    Object.prototype.hasOwnProperty.call(patch, 'permitMemberIds')
  ) {
    updates.push('whitelist_member_ids_json = ?');
    const nextPermitMembers = Object.prototype.hasOwnProperty.call(patch, 'permitMemberIds')
      ? patch.permitMemberIds
      : patch.whitelistMemberIds;
    values.push(JSON.stringify(normalizeWhitelist(nextPermitMembers)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'permitRoleIds')) {
    updates.push('permit_role_ids_json = ?');
    values.push(JSON.stringify(normalizeWhitelist(patch.permitRoleIds)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rejectMemberIds')) {
    updates.push('reject_member_ids_json = ?');
    values.push(JSON.stringify(normalizeWhitelist(patch.rejectMemberIds)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rejectRoleIds')) {
    updates.push('reject_role_ids_json = ?');
    values.push(JSON.stringify(normalizeWhitelist(patch.rejectRoleIds)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastActiveAt')) {
    updates.push('last_active_at = ?');
    values.push(Number(patch.lastActiveAt || Date.now()));
  }

  if (updates.length === 0) return null;

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(Number(roomId));
  await db.execute(`UPDATE private_voice_rooms SET ${updates.join(', ')} WHERE id = ?`, values);
  const [rows] = await db.execute('SELECT * FROM private_voice_rooms WHERE id = ? LIMIT 1', [Number(roomId)]);
  return mapRoom(rows?.[0]);
}

async function deleteRoomById(roomId) {
  await db.execute('DELETE FROM private_voice_rooms WHERE id = ?', [Number(roomId)]);
}

async function insertRoomLog({
  roomId,
  guildId,
  ownerId,
  actionType,
  targetUserId = null,
  metadata = null,
}) {
  await db.execute(
    `INSERT INTO private_voice_room_logs
      (room_id, guild_id, owner_id, action_type, target_user_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      Number(roomId),
      guildId,
      ownerId,
      String(actionType || '').slice(0, 64),
      targetUserId || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

module.exports = {
  getGuildConfig,
  listAllRooms,
  getRoomByOwner,
  getRoomByChannel,
  createRoom,
  updateRoom,
  deleteRoomById,
  insertRoomLog,
  normalizeWhitelist,
  normalizeLockSnapshot,
  normalizeVisibilitySnapshot,
};
