# Bot Feature Inventory

Generated from repository inspection on 2026-04-16 (read-only analysis).

## Scope Snapshot
- Bot command handlers found in `api/src/bot/commands`: 14 unique handlers.
- Command aliases wired in dispatch: `yardim`, `yardım`.
- Declared but not wired to handler module: `vcmute`, `vcunmute` (present in builtin name list).
- Dynamic command surface also exists via `custom_commands` table + cache lookup.

## Command Inventory

| Command | Aliases | Domain | Runtime behavior | Actor gate (effective) | Destructive/risky | Dashboard-suitable control | Suggested dashboard control |
|---|---|---|---|---|---|---|---|
| `log` | none | Moderation audit | Reads paginated user disciplinary history from `mod_logs` | `verifyPermission('log')` -> `ModerateMembers` + command policy checks | Low | Yes | Enable/disable, limit, safe-list, read-only log preview |
| `warn` | none | Moderation | Adds warn record to `mod_logs`; sends templates/DM | `ModerateMembers` + policy checks | Medium | Yes | Enable/disable, rate limit, safe-list |
| `mute` | none | Moderation timeout | Applies native timeout, verifies, optional voice disconnect rollback | `ModerateMembers` + target hierarchy + bot capability checks | High | Yes, guarded | Enable/disable, limit, safe-list, default duration (future), safety banners |
| `unmute` | none | Moderation timeout | Clears native timeout and verifies | `ModerateMembers` (via mute bucket) + hierarchy/capability checks | High | Yes, guarded | Enable/disable, limit, safe-list |
| `kick` | none | Moderation | Kicks target and logs action | `KickMembers` + hierarchy checks | High | Yes, guarded | Enable/disable, limit, safe-list |
| `jail` | none | Moderation role penalty | Moves target to jail role, snapshots/restores roles via scheduler | `BanMembers` + role manage/hierarchy checks + `jail_penalty_role` | High | Yes, guarded | Enable/disable, limit, safe-list, jail role selection |
| `unjail` | none | Moderation role penalty | Restores jailed target roles and cancels jail penalty | `BanMembers` (jail bucket) + role checks | High | Yes, guarded | Enable/disable, limit, safe-list |
| `ban` | none | Moderation guild ban | Bans member/ID with authoritative ban checks and lock | `BanMembers` + hierarchy and ban-state checks | High | Yes, guarded | Enable/disable, limit, safe-list |
| `unban` | none | Moderation guild ban | Removes ban by ID with authoritative checks and lock | `BanMembers` (ban bucket) | High | Yes, guarded | Enable/disable, limit, safe-list |
| `lock` | none | Channel lock | Locks current text channel send perms with snapshot+verify | Policy-enabled path: lock policy checks; fallback path: `ManageChannels` or `Administrator` | High | Yes, guarded | Enable/disable lock policy, lock role, safe-list, limit; audit preview |
| `unlock` | none | Channel lock | Restores channel lock snapshot / fallback unlock | Same as `lock` | High | Yes, guarded | Same as `lock` |
| `embed` | none | Messaging utility | Interactive embed builder (button+modal) and send to channel | Requires `ManageMessages` in command logic | Medium | Yes (later) | Command toggle + role restriction (new model), optional channel allow-list |
| `durum` | none | System info | Shows bot health/status embed; supports compact/legacy mode and enabled flag from bot settings repo | Requires guild `Administrator` in command logic | Low | Already yes | Existing: enabled + detailMode (`legacy`/`compact`) |
| `yardim` | `yardım` | Help/info | Sends help embed with command usage | No explicit permission gate | Low | Optional | Usually read-only visibility; no urgent write control needed |

### Command-adjacent surfaces
- Declared builtin names: `vcmute`, `vcunmute` in `api/src/bot/builtinCommands.js` and action normalization, but no command handler modules in `api/src/bot/commands`.
- Dynamic custom commands:
  - Data: `custom_commands`, `custom_command_audit`.
  - Runtime: `api/src/utils/cache.js` + `api/src/discordClient.js` fallback after builtin handler.
  - Dashboard recommendation: read-only inventory first, then guarded CRUD.

## Services / Domains Inventory

| Domain | Key files | Current behavior | Dashboard relevance |
|---|---|---|---|
| Prefix command dispatch | `api/src/bot/moderation.js` | Parses prefix, resolves target, routes handler | Central for command policy UI and command catalog |
| Moderation permissions + limits | `api/src/bot/services/permissionService.js` | Action buckets, native permission checks, safe-list, hard-protected roles/users, rate limit | High relevance for moderation settings page |
| Moderation execution pipeline | `api/src/bot/services/actionExecution.js` | Mutation lock, receipt commit/rollback, side-effect handling | Needed for safe guardrail design |
| Native timeout system | `api/src/bot/services/nativeTimeoutService.js` | Timeout apply/clear, retries, verification, voice disconnect | Needed for mute/unmute dashboard policy |
| Guild ban state verification | `api/src/bot/services/guildBanState.js` | Ban cache + authoritative checks + mutation lock | Needed for guarded ban controls |
| Timed penalties scheduler | `api/src/bot/penaltyScheduler.js` | Schedules unjail and related timed actions; role snapshots | Needed for jail configuration and observability |
| Channel lock snapshot system | `api/src/bot/commands/channelLock.helpers.js`, `channelLockSnapshotRepository.js` | Snapshot/restore channel overwrites with verification | Needs strong guardrails in dashboard |
| Private room voice system | `api/src/voice/privateRoomService.js`, `privateVoiceRepository.js` | Hub channel creates rooms, panel actions, inactivity cleanup, ownership transfer | Major setup wizard target |
| Startup voice auto-join | `api/src/voice/startupVoiceAutoJoiner.js`, `voiceManager.js` | Safe startup join with retry and permission checks | Good candidate for read-only then guarded write |
| Reaction action engine | `api/src/application/reactionActions/service.js`, `reactionRuleRepository.js` | Reaction rule evaluation, role add/remove, cooldown, only-once | Good candidate for read-only health first |
| Tag role feature | `api/src/features/tagRole.js` | Syncs role by user primary guild identity | Candidate for setup + diagnostics |
| Bot presence manager | `api/src/bot/presenceManager.js` | Static-config-backed presence apply; read-only source | Future dashboard control with care |
| Static config model | `api/src/config/static/*` | Guild settings/bindings defaults + authoritative resolver | Migration-critical for wizard/settings |
| Static config validation | `api/src/bootstrap/validateStaticConfig.js` | Validates role/channel/category/emoji bindings and config integrity | Reuse in dashboard validation endpoints |
| Control-plane auth + guild scope | `api/src/controlPlane/auth*`, `guildScope.js`, `guildAccessPolicy.js` | OAuth login, bearer handoff, operator-aware guild access | Already working; foundation for all protected routes |
| Dashboard read/write foundation | `api/src/controlPlane/dashboardRoutes.js`, `preferencesRoutes.js`, `botSettingsRoutes.js` | Read providers + preferences + bot setting writes | Existing control-plane mutation base to extend |

## Static / Environment Configuration Findings

### Static guild settings currently authoritative for command/feature policy
From `api/src/config/static/index.js` and `server.js`:
- Prefix and command policies:
  - `prefix`
  - `log_*`, `warn_*`, `mute_*`, `kick_*`, `jail_*`, `ban_*`, `lock_*`
- Role/feature bindings:
  - `mute_penalty_role`, `jail_penalty_role`, `lock_role`
  - `tag_enabled`, `tag_role`, `tag_text`
  - `private_vc_enabled`, `private_vc_hub_channel`, `private_vc_required_role`, `private_vc_category`
  - `startup_voice_channel_id`
  - `staff_hierarchy_roles`, `hard_protected_roles`, `hard_protected_users`

### Static settings precedence warning
- `buildAuthoritativeSettings` currently merges runtime first, then static:
  - `return { ...dynamicSettings, ...getStaticGuildSettings(guildId) }`
- Result: for overlapping keys, static config wins.
- Migration implication: moving command/feature settings to dashboard write path requires controlled precedence redesign or explicit split keyspace.

### Env-driven setup that should remain env-level (not guild dashboard settings)
- Secrets and infra:
  - Discord token, DB credentials, OAuth secret, session secret.
- Deployment/runtime:
  - CORS origins, auth enable/config toggles, shared-state/scheduler provider settings, static dashboard serving path.
- Premium defaults:
  - default plan + manual overrides are currently env/config driven.

## Current Real Dashboard-Controlled Settings (Working Now)

- Auth + guild scope:
  - OAuth login/callback/exchange, bearer token, operator-aware guild selection.
- Protected overview/context reads:
  - `/api/dashboard/protected/overview`
  - `/api/dashboard/context/features`
- Preferences (real write):
  - `GET/PUT /api/dashboard/protected/preferences`
  - Fields: `defaultView`, `compactMode`, `dismissedNoticeIds`, `advancedLayoutMode` (capability-gated).
- Command setting (real write):
  - `GET/PUT /api/dashboard/protected/bot-settings/commands`
  - Implemented command: `.durum` -> `enabled`, `detailMode`.
- Legacy status-command path also exists:
  - `GET/PUT /api/dashboard/protected/bot-settings/status-command` (detail mode domain).

## Known Gaps / Migration Cautions

- Preferences and bot settings repositories are in-memory (`preferencesRepository`, `botSettingsRepository`), not persistent DB-backed.
- Static guild config is code-defined (`api/src/config/static/server.js`); dashboard writes for those fields do not exist yet.
- No explicit log channel settings currently present in static settings keys.
- `vcmute`/`vcunmute` appear in normalization/builtin naming but no runnable command module found.
