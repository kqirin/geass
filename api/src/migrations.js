const db = require('./database');
const { ensureDatabaseHardening } = require('./databaseHardening');

function isIgnorableAlterError(err) {
  return err?.code === 'ER_DUP_FIELDNAME';
}

async function safeAlter(sql, logError = () => {}) {
  try {
    await db.execute(sql);
  } catch (err) {
    if (isIgnorableAlterError(err)) return;
    logError('db_migration_alter_failed', err, { sql: String(sql).slice(0, 180) });
    throw err;
  }
}

async function runMigrations(logSystem = () => {}, logError = () => {}) {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        guild_id VARCHAR(32) NOT NULL PRIMARY KEY,
        prefix VARCHAR(3) NOT NULL DEFAULT '.',
        custom_messages TEXT NULL,
        log_enabled TINYINT(1) NOT NULL DEFAULT 1,
        log_role VARCHAR(32) NULL,
        log_safe_list TEXT NULL,
        log_limit INT NOT NULL DEFAULT 25,
        warn_enabled TINYINT(1) NOT NULL DEFAULT 1,
        warn_role VARCHAR(32) NULL,
        warn_safe_list TEXT NULL,
        warn_limit INT NOT NULL DEFAULT 0,
        mute_enabled TINYINT(1) NOT NULL DEFAULT 1,
        mute_role VARCHAR(32) NULL,
        mute_penalty_role VARCHAR(32) NULL,
        mute_safe_list TEXT NULL,
        mute_limit INT NOT NULL DEFAULT 25,
        kick_enabled TINYINT(1) NOT NULL DEFAULT 1,
        kick_role VARCHAR(32) NULL,
        kick_safe_list TEXT NULL,
        kick_limit INT NOT NULL DEFAULT 5,
        jail_enabled TINYINT(1) NOT NULL DEFAULT 1,
        jail_role VARCHAR(32) NULL,
        jail_penalty_role VARCHAR(32) NULL,
        jail_safe_list TEXT NULL,
        jail_limit INT NOT NULL DEFAULT 5,
        ban_enabled TINYINT(1) NOT NULL DEFAULT 1,
        ban_role VARCHAR(32) NULL,
        ban_safe_list TEXT NULL,
        ban_limit INT NOT NULL DEFAULT 5,
        clear_enabled TINYINT(1) NOT NULL DEFAULT 1,
        clear_role VARCHAR(32) NULL,
        clear_safe_list TEXT NULL,
        clear_limit INT NOT NULL DEFAULT 25,
        tag_enabled TINYINT(1) NOT NULL DEFAULT 0,
        tag_role VARCHAR(32) NULL,
        tag_text VARCHAR(64) NULL,
        vcmute_enabled TINYINT(1) NOT NULL DEFAULT 1,
        vcmute_role VARCHAR(32) NULL,
        vcmute_safe_list TEXT NULL,
        vcmute_limit INT NOT NULL DEFAULT 25,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Backfill old installations where log_* columns did not exist yet.
    await safeAlter('ALTER TABLE settings ADD COLUMN log_enabled TINYINT(1) NOT NULL DEFAULT 1', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN log_role VARCHAR(32) NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN log_safe_list TEXT NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN log_limit INT NOT NULL DEFAULT 25', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN tag_enabled TINYINT(1) NOT NULL DEFAULT 0', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN tag_role VARCHAR(32) NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN tag_text VARCHAR(64) NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN private_vc_enabled TINYINT(1) NOT NULL DEFAULT 0', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN private_vc_hub_channel VARCHAR(32) NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN private_vc_required_role VARCHAR(32) NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN private_vc_category VARCHAR(32) NULL', logError);
    await safeAlter('ALTER TABLE settings ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', logError);
    await safeAlter(
      'ALTER TABLE settings ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
      logError
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS timed_penalties (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        action_type VARCHAR(16) NOT NULL,
        role_id VARCHAR(32) NULL,
        revoke_at BIGINT NOT NULL,
        reason VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at BIGINT NULL,
        KEY idx_active_revoke (active, revoke_at),
        KEY idx_lookup (guild_id, user_id, action_type, active)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS timed_penalty_role_snapshots (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        roles_json TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS weekly_staff_config (
        guild_id VARCHAR(32) NOT NULL PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        award_role_id VARCHAR(32) NULL,
        announcement_channel_id VARCHAR(32) NULL,
        announcement_message TEXT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul',
        week_start_dow TINYINT NOT NULL DEFAULT 1,
        minimum_points INT NOT NULL DEFAULT 20,
        tie_break_mode VARCHAR(16) NOT NULL DEFAULT 'moderation_first',
        eligible_roles_json JSON NOT NULL,
        excluded_roles_json JSON NOT NULL,
        weights_json JSON NOT NULL,
        spam_guard_json JSON NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      ALTER TABLE weekly_staff_config
      ADD COLUMN IF NOT EXISTS announcement_message TEXT NULL
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS weekly_staff_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        command_name VARCHAR(32) NULL,
        points_delta INT NOT NULL,
        occurred_at BIGINT NOT NULL,
        week_start BIGINT NOT NULL,
        metadata_json JSON NULL,
        KEY idx_wse_week_guild_user (week_start, guild_id, user_id),
        KEY idx_wse_guild_time (guild_id, occurred_at),
        KEY idx_wse_guild_user_cmd_time (guild_id, user_id, command_name, occurred_at)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS weekly_staff_scores (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        week_start BIGINT NOT NULL,
        week_end BIGINT NOT NULL,
        points INT NOT NULL DEFAULT 0,
        moderation_actions INT NOT NULL DEFAULT 0,
        command_count INT NOT NULL DEFAULT 0,
        breakdown_json JSON NOT NULL,
        finalized TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, week_start),
        KEY idx_wss_week_guild_points (week_start, guild_id, points),
        KEY idx_wss_guild_finalized (guild_id, finalized, week_start)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS weekly_staff_winners (
        guild_id VARCHAR(32) NOT NULL,
        week_start BIGINT NOT NULL,
        week_end BIGINT NOT NULL,
        winner_user_id VARCHAR(32) NOT NULL,
        points INT NOT NULL,
        moderation_actions INT NOT NULL DEFAULT 0,
        awarded_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        tie_info_json JSON NULL,
        PRIMARY KEY (guild_id, week_start, winner_user_id),
        KEY idx_wsw_active_expiry (active, expires_at),
        KEY idx_wsw_guild_active (guild_id, active)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS reaction_rules (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        message_id VARCHAR(32) NOT NULL,
        emoji_type ENUM('unicode','custom') NOT NULL,
        emoji_id VARCHAR(64) NULL,
        emoji_name VARCHAR(128) NULL,
        trigger_mode ENUM('ADD','REMOVE','TOGGLE') NOT NULL DEFAULT 'TOGGLE',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        cooldown_seconds INT NOT NULL DEFAULT 5,
        only_once TINYINT(1) NOT NULL DEFAULT 0,
        group_key VARCHAR(64) NULL,
        allowed_roles_json JSON NULL,
        excluded_roles_json JSON NULL,
        actions_json JSON NOT NULL,
        created_by VARCHAR(32) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_rr_guild_enabled (guild_id, enabled),
        KEY idx_rr_lookup (guild_id, message_id, emoji_type, emoji_id, emoji_name)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS reaction_rule_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        rule_id BIGINT UNSIGNED NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        event_type ENUM('ADD','REMOVE') NOT NULL,
        status ENUM('SUCCESS','SKIPPED','ERROR') NOT NULL,
        action_type VARCHAR(32) NULL,
        error_code VARCHAR(64) NULL,
        error_message VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_rrl_rule_time (rule_id, created_at),
        KEY idx_rrl_guild_time (guild_id, created_at)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS private_voice_rooms (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        owner_id VARCHAR(32) NOT NULL,
        voice_channel_id VARCHAR(32) NOT NULL,
        panel_message_id VARCHAR(32) NULL,
        locked TINYINT(1) NOT NULL DEFAULT 0,
        whitelist_member_ids_json JSON NOT NULL,
        last_active_at BIGINT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_private_room_owner (guild_id, owner_id),
        UNIQUE KEY uq_private_room_channel (guild_id, voice_channel_id),
        KEY idx_private_room_last_active (last_active_at)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS private_voice_room_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        room_id BIGINT UNSIGNED NOT NULL,
        guild_id VARCHAR(32) NOT NULL,
        owner_id VARCHAR(32) NOT NULL,
        action_type VARCHAR(64) NOT NULL,
        target_user_id VARCHAR(32) NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_pvrl_room_time (room_id, created_at),
        KEY idx_pvrl_guild_owner_time (guild_id, owner_id, created_at)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS message_templates (
        guild_id VARCHAR(32) NOT NULL,
        scope ENUM('global','command') NOT NULL,
        command_name VARCHAR(32) NOT NULL DEFAULT '',
        templates_json JSON NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, scope, command_name),
        KEY idx_mt_guild_scope (guild_id, scope)
      )
    `);

    await ensureDatabaseHardening(logSystem, logError);
    logSystem('DB migrations tamamlandi', 'INFO');
  } catch (err) {
    logError('db_migrations_failed', err);
    throw err;
  }
}

module.exports = { runMigrations };

