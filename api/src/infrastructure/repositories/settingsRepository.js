const db = require('../../database');

async function getSettingsByGuildId(guildId) {
  const [rows] = await db.execute('SELECT * FROM settings WHERE guild_id = ?', [guildId]);
  return rows || [];
}

async function hasSettingsRow(guildId) {
  const [rows] = await db.execute('SELECT guild_id FROM settings WHERE guild_id = ?', [guildId]);
  return (rows || []).length > 0;
}

async function updateSettings(guildId, keys, values) {
  const updates = keys.map((k) => `${k} = ?`).join(', ');
  await db.execute(`UPDATE settings SET ${updates} WHERE guild_id = ?`, [...values, guildId]);
}

async function insertSettings(guildId, keys, values) {
  const placeholders = keys.map(() => '?').join(', ');
  await db.execute(`INSERT INTO settings (guild_id, ${keys.join(', ')}) VALUES (?, ${placeholders})`, [guildId, ...values]);
}

async function getSettingsColumns() {
  const [rows] = await db.execute('SHOW COLUMNS FROM settings');
  return new Set((rows || []).map((r) => r.Field));
}

module.exports = {
  getSettingsByGuildId,
  hasSettingsRow,
  updateSettings,
  insertSettings,
  getSettingsColumns,
};

