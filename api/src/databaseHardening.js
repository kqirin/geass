const db = require('./database');

function isIgnorableAlterError(err) {
  return (
    err?.code === 'ER_DUP_FIELDNAME' ||
    err?.code === 'ER_DUP_KEYNAME' ||
    err?.code === 'ER_CANT_DROP_FIELD_OR_KEY'
  );
}

async function safeExecute(sql, params = [], logError = () => {}) {
  try {
    await db.execute(sql, params);
  } catch (err) {
    if (isIgnorableAlterError(err)) return;
    logError('db_hardening_query_failed', err, { sql: String(sql).slice(0, 180) });
    throw err;
  }
}

async function ensureDatabaseHardening(logSystem = () => {}, logError = () => {}) {
  await safeExecute(
    `CREATE TABLE IF NOT EXISTS mod_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      moderator_id VARCHAR(32) NOT NULL,
      action_type VARCHAR(32) NOT NULL,
      reason VARCHAR(255) NOT NULL DEFAULT 'Yok',
      duration VARCHAR(32) NOT NULL DEFAULT 'Suresiz',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    [],
    logError
  );

  await safeExecute(
    'ALTER TABLE mod_logs ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    [],
    logError
  );

  await safeExecute(
    'CREATE INDEX idx_mod_logs_guild_user_id ON mod_logs (guild_id, user_id, id)',
    [],
    logError
  );
  await safeExecute(
    'CREATE INDEX idx_mod_logs_guild_action_created ON mod_logs (guild_id, action_type, created_at)',
    [],
    logError
  );

  await safeExecute(
    `CREATE TABLE IF NOT EXISTS custom_commands (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      command_name VARCHAR(32) NOT NULL,
      command_response VARCHAR(500) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    [],
    logError
  );

  await safeExecute(
    'ALTER TABLE custom_commands MODIFY command_name VARCHAR(32) NOT NULL',
    [],
    logError
  );
  await safeExecute(
    'ALTER TABLE custom_commands MODIFY command_response VARCHAR(500) NOT NULL',
    [],
    logError
  );

  await safeExecute(
    'CREATE UNIQUE INDEX uq_custom_commands_guild_command ON custom_commands (guild_id, command_name)',
    [],
    logError
  );
  await safeExecute(
    'CREATE INDEX idx_custom_commands_guild ON custom_commands (guild_id)',
    [],
    logError
  );

  await safeExecute(
    `CREATE TABLE IF NOT EXISTS custom_command_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      command_name VARCHAR(32) NOT NULL,
      action_type VARCHAR(16) NOT NULL,
      actor_user_id VARCHAR(32) NULL,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    [],
    logError
  );

  await safeExecute(
    'CREATE INDEX idx_custom_command_audit_guild_command_created ON custom_command_audit (guild_id, command_name, created_at)',
    [],
    logError
  );
  await safeExecute(
    'CREATE INDEX idx_custom_command_audit_actor_created ON custom_command_audit (actor_user_id, created_at)',
    [],
    logError
  );

  logSystem('DB hardening tamamlandi: mod_logs/custom_commands index + audit hazir', 'INFO');
}

module.exports = { ensureDatabaseHardening };

