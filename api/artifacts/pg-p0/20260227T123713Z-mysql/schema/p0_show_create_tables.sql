-- settings
CREATE TABLE `settings` (
  `guild_id` varchar(255) NOT NULL,
  `prefix` varchar(10) DEFAULT '!',
  `warn_enabled` tinyint(1) DEFAULT 1,
  `warn_role` varchar(255) DEFAULT NULL,
  `warn_safe_list` text DEFAULT NULL,
  `warn_limit` int(11) DEFAULT 0,
  `mute_enabled` tinyint(1) DEFAULT 1,
  `mute_role` varchar(255) DEFAULT NULL,
  `mute_penalty_role` varchar(255) DEFAULT NULL,
  `mute_safe_list` text DEFAULT NULL,
  `mute_limit` int(11) DEFAULT 25,
  `kick_enabled` tinyint(1) DEFAULT 1,
  `kick_role` varchar(255) DEFAULT NULL,
  `kick_safe_list` text DEFAULT NULL,
  `kick_limit` int(11) DEFAULT 5,
  `jail_enabled` tinyint(1) DEFAULT 1,
  `jail_role` varchar(255) DEFAULT NULL,
  `jail_penalty_role` varchar(255) DEFAULT NULL,
  `jail_safe_list` text DEFAULT NULL,
  `jail_limit` int(11) DEFAULT 5,
  `ban_enabled` tinyint(1) DEFAULT 1,
  `ban_role` varchar(255) DEFAULT NULL,
  `ban_safe_list` text DEFAULT NULL,
  `ban_limit` int(11) DEFAULT 5,
  `custom_messages` longtext DEFAULT NULL,
  `clear_enabled` tinyint(1) DEFAULT 1,
  `clear_role` varchar(255) DEFAULT NULL,
  `clear_safe_list` text DEFAULT NULL,
  `clear_limit` int(11) DEFAULT 10,
  `vcmute_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `vcmute_role` varchar(32) DEFAULT NULL,
  `vcmute_safe_list` text DEFAULT NULL,
  `vcmute_limit` int(11) NOT NULL DEFAULT 5,
  `log_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `log_role` varchar(32) DEFAULT NULL,
  `log_safe_list` text DEFAULT NULL,
  `log_limit` int(11) NOT NULL DEFAULT 25,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tag_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `tag_role` varchar(32) DEFAULT NULL,
  `tag_text` varchar(64) DEFAULT NULL,
  `private_vc_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `private_vc_hub_channel` varchar(32) DEFAULT NULL,
  `private_vc_required_role` varchar(32) DEFAULT NULL,
  `private_vc_category` varchar(32) DEFAULT NULL,
  `staff_hierarchy_roles` text DEFAULT NULL,
  PRIMARY KEY (`guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- mod_logs
CREATE TABLE `mod_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `guild_id` varchar(255) DEFAULT NULL,
  `user_id` varchar(255) DEFAULT NULL,
  `action_type` varchar(50) DEFAULT NULL,
  `timestamp` datetime DEFAULT current_timestamp(),
  `reason` text DEFAULT NULL,
  `duration` varchar(50) DEFAULT 'Süresiz',
  `moderator_id` varchar(50) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mod_logs_guild_user_id` (`guild_id`,`user_id`,`id`),
  KEY `idx_mod_logs_guild_action_created` (`guild_id`,`action_type`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=134 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- timed_penalties
CREATE TABLE `timed_penalties` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `guild_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `action_type` varchar(16) NOT NULL,
  `role_id` varchar(32) DEFAULT NULL,
  `revoke_at` bigint(20) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `revoked_at` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_active_revoke` (`active`,`revoke_at`),
  KEY `idx_lookup` (`guild_id`,`user_id`,`action_type`,`active`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- timed_penalty_role_snapshots
CREATE TABLE `timed_penalty_role_snapshots` (
  `guild_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `roles_json` text NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`guild_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- reaction_rules
CREATE TABLE `reaction_rules` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `guild_id` varchar(32) NOT NULL,
  `channel_id` varchar(32) NOT NULL,
  `message_id` varchar(32) NOT NULL,
  `emoji_type` enum('unicode','custom') NOT NULL,
  `emoji_id` varchar(64) DEFAULT NULL,
  `emoji_name` varchar(128) DEFAULT NULL,
  `trigger_mode` enum('ADD','REMOVE','TOGGLE') NOT NULL DEFAULT 'TOGGLE',
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `cooldown_seconds` int(11) NOT NULL DEFAULT 5,
  `only_once` tinyint(1) NOT NULL DEFAULT 0,
  `group_key` varchar(64) DEFAULT NULL,
  `allowed_roles_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`allowed_roles_json`)),
  `excluded_roles_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`excluded_roles_json`)),
  `actions_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`actions_json`)),
  `created_by` varchar(32) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rr_guild_enabled` (`guild_id`,`enabled`),
  KEY `idx_rr_lookup` (`guild_id`,`message_id`,`emoji_type`,`emoji_id`,`emoji_name`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- reaction_rule_logs
CREATE TABLE `reaction_rule_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `guild_id` varchar(32) NOT NULL,
  `rule_id` bigint(20) unsigned NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `event_type` enum('ADD','REMOVE') NOT NULL,
  `status` enum('SUCCESS','SKIPPED','ERROR') NOT NULL,
  `action_type` varchar(32) DEFAULT NULL,
  `error_code` varchar(64) DEFAULT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rrl_rule_time` (`rule_id`,`created_at`),
  KEY `idx_rrl_guild_time` (`guild_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- message_templates
CREATE TABLE `message_templates` (
  `guild_id` varchar(32) NOT NULL,
  `scope` enum('global','command') NOT NULL,
  `command_name` varchar(32) NOT NULL DEFAULT '',
  `templates_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`templates_json`)),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`guild_id`,`scope`,`command_name`),
  KEY `idx_mt_guild_scope` (`guild_id`,`scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- private_voice_rooms
CREATE TABLE `private_voice_rooms` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `guild_id` varchar(32) NOT NULL,
  `owner_id` varchar(32) NOT NULL,
  `voice_channel_id` varchar(32) NOT NULL,
  `panel_message_id` varchar(32) DEFAULT NULL,
  `locked` tinyint(1) NOT NULL DEFAULT 0,
  `whitelist_member_ids_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`whitelist_member_ids_json`)),
  `last_active_at` bigint(20) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_private_room_owner` (`guild_id`,`owner_id`),
  UNIQUE KEY `uq_private_room_channel` (`guild_id`,`voice_channel_id`),
  KEY `idx_private_room_last_active` (`last_active_at`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
