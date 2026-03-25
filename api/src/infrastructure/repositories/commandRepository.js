const db = require('../../database');

async function getGuildCommands(guildId) {
  const [rows] = await db.execute('SELECT * FROM custom_commands WHERE guild_id = ?', [guildId]);
  return rows || [];
}

async function upsertGuildCommand(guildId, commandName, commandResponse) {
  await db.execute(
    `INSERT INTO custom_commands (guild_id, command_name, command_response)
     VALUES (?, ?, ?)
     ON CONFLICT (guild_id, command_name)
     DO UPDATE SET
      command_response = EXCLUDED.command_response,
      updated_at = CURRENT_TIMESTAMP`,
    [guildId, commandName, commandResponse]
  );
}

async function deleteGuildCommand(guildId, commandName) {
  await db.execute('DELETE FROM custom_commands WHERE guild_id = ? AND command_name = ?', [guildId, commandName]);
}

async function insertCommandAudit(guildId, commandName, actionType, actorUserId, note) {
  await db.execute(
    'INSERT INTO custom_command_audit (guild_id, command_name, action_type, actor_user_id, note) VALUES (?, ?, ?, ?, ?)',
    [guildId, commandName, actionType, actorUserId, note]
  );
}

module.exports = {
  getGuildCommands,
  upsertGuildCommand,
  deleteGuildCommand,
  insertCommandAudit,
};

