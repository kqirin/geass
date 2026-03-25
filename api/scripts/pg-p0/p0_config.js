const path = require('path');

const P0_TABLES = [
  'mod_logs',
  'timed_penalties',
  'timed_penalty_role_snapshots',
  'reaction_rules',
  'reaction_rule_logs',
  'reaction_rule_only_once_executions',
  'private_voice_rooms',
  'text_channel_lock_snapshots',
  'custom_commands',
  'custom_command_audit',
  'private_voice_room_logs',
];

const TABLE_CONFIG = {
  mod_logs: {
    columns: ['id', 'guild_id', 'user_id', 'moderator_id', 'action_type', 'reason', 'duration', 'created_at'],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  timed_penalties: {
    columns: ['id', 'guild_id', 'user_id', 'action_type', 'role_id', 'revoke_at', 'reason', 'active', 'created_at', 'revoked_at'],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  timed_penalty_role_snapshots: {
    columns: ['guild_id', 'user_id', 'roles_json', 'updated_at'],
    orderBy: ['guild_id', 'user_id'],
    sequenceColumn: null,
  },
  reaction_rules: {
    columns: [
      'id',
      'guild_id',
      'channel_id',
      'message_id',
      'emoji_type',
      'emoji_id',
      'emoji_name',
      'trigger_mode',
      'enabled',
      'cooldown_seconds',
      'only_once',
      'group_key',
      'allowed_roles_json',
      'excluded_roles_json',
      'actions_json',
      'created_by',
      'created_at',
      'updated_at',
    ],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  reaction_rule_logs: {
    columns: [
      'id',
      'guild_id',
      'rule_id',
      'user_id',
      'event_type',
      'status',
      'action_type',
      'error_code',
      'error_message',
      'created_at',
    ],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  reaction_rule_only_once_executions: {
    columns: ['rule_id', 'guild_id', 'user_id', 'event_type', 'state', 'created_at', 'updated_at'],
    orderBy: ['rule_id', 'user_id', 'event_type'],
    sequenceColumn: null,
  },
  private_voice_rooms: {
    columns: [
      'id',
      'guild_id',
      'owner_id',
      'voice_channel_id',
      'panel_message_id',
      'locked',
      'lock_snapshot_json',
      'visibility_snapshot_json',
      'whitelist_member_ids_json',
      'last_active_at',
      'created_at',
      'updated_at',
    ],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  text_channel_lock_snapshots: {
    columns: ['guild_id', 'channel_id', 'everyone_role_id', 'snapshot_json', 'created_at', 'updated_at'],
    orderBy: ['guild_id', 'channel_id'],
    sequenceColumn: null,
  },
  custom_commands: {
    columns: ['id', 'guild_id', 'command_name', 'command_response', 'created_at', 'updated_at'],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  custom_command_audit: {
    columns: ['id', 'guild_id', 'command_name', 'action_type', 'actor_user_id', 'note', 'created_at'],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
  private_voice_room_logs: {
    columns: ['id', 'room_id', 'guild_id', 'owner_id', 'action_type', 'target_user_id', 'metadata_json', 'created_at'],
    orderBy: ['id'],
    sequenceColumn: 'id',
  },
};

function artifactBaseDir(rootDir = process.cwd()) {
  return path.join(rootDir, 'artifacts', 'pg-p0');
}

module.exports = {
  P0_TABLES,
  TABLE_CONFIG,
  artifactBaseDir,
};
