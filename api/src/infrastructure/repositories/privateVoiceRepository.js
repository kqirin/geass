const db = require('../../database');

function parseWhitelist(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue.map((x) => String(x || '').trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x || '').trim()).filter(Boolean);
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

function mapRoom(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    ownerId: row.owner_id,
    voiceChannelId: row.voice_channel_id,
    panelMessageId: row.panel_message_id || null,
    locked: Boolean(row.locked),
    whitelistMemberIds: parseWhitelist(row.whitelist_member_ids_json),
    lastActiveAt: Number(row.last_active_at || 0),
  };
}

async function getGuildConfig(guildId) {
  const [rows] = await db.execute(
    `SELECT private_vc_enabled, private_vc_hub_channel, private_vc_required_role, private_vc_category
     FROM settings
     WHERE guild_id = ?
     LIMIT 1`,
    [guildId]
  );
  const row = rows?.[0];
  return {
    enabled: Boolean(row?.private_vc_enabled),
    hubChannelId: row?.private_vc_hub_channel || null,
    requiredRoleId: row?.private_vc_required_role || null,
    categoryId: row?.private_vc_category || null,
  };
}

async function upsertGuildConfig(guildId, config) {
  await db.execute(
    `INSERT INTO settings
      (guild_id, private_vc_enabled, private_vc_hub_channel, private_vc_required_role, private_vc_category)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      private_vc_enabled = VALUES(private_vc_enabled),
      private_vc_hub_channel = VALUES(private_vc_hub_channel),
      private_vc_required_role = VALUES(private_vc_required_role),
      private_vc_category = VALUES(private_vc_category)`,
    [
      guildId,
      config.enabled ? 1 : 0,
      config.hubChannelId || null,
      config.requiredRoleId || null,
      config.categoryId || null,
    ]
  );
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
  whitelistMemberIds = [],
  lastActiveAt = Date.now(),
}) {
  const normalizedWhitelist = normalizeWhitelist(whitelistMemberIds);
  const [result] = await db.execute(
    `INSERT INTO private_voice_rooms
      (guild_id, owner_id, voice_channel_id, panel_message_id, locked, whitelist_member_ids_json, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      ownerId,
      voiceChannelId,
      panelMessageId || null,
      locked ? 1 : 0,
      JSON.stringify(normalizedWhitelist),
      Number(lastActiveAt),
    ]
  );
  const [rows] = await db.execute('SELECT * FROM private_voice_rooms WHERE id = ? LIMIT 1', [result.insertId]);
  return mapRoom(rows?.[0]);
}

async function updateRoom(roomId, patch) {
  const updates = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(patch, 'panelMessageId')) {
    updates.push('panel_message_id = ?');
    values.push(patch.panelMessageId || null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'locked')) {
    updates.push('locked = ?');
    values.push(patch.locked ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'whitelistMemberIds')) {
    updates.push('whitelist_member_ids_json = ?');
    values.push(JSON.stringify(normalizeWhitelist(patch.whitelistMemberIds)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastActiveAt')) {
    updates.push('last_active_at = ?');
    values.push(Number(patch.lastActiveAt || Date.now()));
  }

  if (updates.length === 0) return null;

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
  upsertGuildConfig,
  listAllRooms,
  getRoomByOwner,
  getRoomByChannel,
  createRoom,
  updateRoom,
  deleteRoomById,
  insertRoomLog,
  normalizeWhitelist,
};
