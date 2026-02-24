const db = require('../../database');

function normalizeCommandName(commandName) {
  return String(commandName || '').trim().toLowerCase();
}

async function getAllMessageTemplates() {
  const [rows] = await db.execute(
    'SELECT guild_id, scope, command_name, templates_json, updated_at FROM message_templates'
  );
  return rows || [];
}

async function getMessageTemplatesByGuildId(guildId) {
  const [rows] = await db.execute(
    'SELECT guild_id, scope, command_name, templates_json, updated_at FROM message_templates WHERE guild_id = ?',
    [guildId]
  );
  return rows || [];
}

async function upsertMessageTemplates(guildId, scope, commandName, templatesJson) {
  const cmd = scope === 'command' ? normalizeCommandName(commandName) : '';
  await db.execute(
    `
      INSERT INTO message_templates (guild_id, scope, command_name, templates_json)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        templates_json = VALUES(templates_json),
        updated_at = CURRENT_TIMESTAMP
    `,
    [guildId, scope, cmd, templatesJson]
  );
}

async function deleteMessageTemplates(guildId, scope, commandName = '') {
  const cmd = scope === 'command' ? normalizeCommandName(commandName) : '';
  await db.execute('DELETE FROM message_templates WHERE guild_id = ? AND scope = ? AND command_name = ?', [
    guildId,
    scope,
    cmd,
  ]);
}

module.exports = {
  getAllMessageTemplates,
  getMessageTemplatesByGuildId,
  upsertMessageTemplates,
  deleteMessageTemplates,
};
