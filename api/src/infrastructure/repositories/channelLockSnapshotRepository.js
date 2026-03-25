'use strict';

const db = require('../../database');

function normalizeSnapshot(rawValue) {
  if (!rawValue) return null;
  if (rawValue && typeof rawValue === 'object' && Array.isArray(rawValue.overwriteEntries)) {
    return rawValue;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || !Array.isArray(parsed.overwriteEntries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getSnapshot(guildId, channelId) {
  const [rows] = await db.execute(
    `SELECT guild_id, channel_id, everyone_role_id, snapshot_json
     FROM text_channel_lock_snapshots
     WHERE guild_id = ? AND channel_id = ?
     LIMIT 1`,
    [guildId, channelId]
  );

  const row = rows?.[0];
  if (!row) return null;

  const snapshot = normalizeSnapshot(row.snapshot_json);
  if (!snapshot) return null;

  return {
    guildId: String(row.guild_id || ''),
    channelId: String(row.channel_id || ''),
    everyoneRoleId: String(row.everyone_role_id || ''),
    snapshot,
  };
}

async function upsertSnapshot({ guildId, channelId, everyoneRoleId, snapshot }) {
  const serialized = JSON.stringify(snapshot || null);
  await db.execute(
    `INSERT INTO text_channel_lock_snapshots (guild_id, channel_id, everyone_role_id, snapshot_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, channel_id)
     DO UPDATE SET
       everyone_role_id = EXCLUDED.everyone_role_id,
       snapshot_json = EXCLUDED.snapshot_json,
       updated_at = CURRENT_TIMESTAMP`,
    [guildId, channelId, everyoneRoleId, serialized]
  );
}

async function deleteSnapshot(guildId, channelId) {
  await db.execute(
    'DELETE FROM text_channel_lock_snapshots WHERE guild_id = ? AND channel_id = ?',
    [guildId, channelId]
  );
}

module.exports = {
  getSnapshot,
  upsertSnapshot,
  deleteSnapshot,
};
