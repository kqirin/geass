# Behavior Contracts (Must Not Break)

## Contract 1: Startup Sequence
- Contract name: `startup_sequence_is_ordered_and_gated`
- Current behavior:
  - Runtime validates env config first.
  - DB migration/schema ensure runs before Discord login.
  - Services are created before login, then static config validation runs after login.
  - Timed penalty bootstrap, private room bootstrap, reaction rule refresh, and tag-role startup sync run after login.
  - Startup uses retry gates (`waitForStartupGate` / `withRetry`) for transient failures.
  - PostgreSQL advisory lock must be acquired before full runtime proceeds.
- Why it matters:
  - Ordering prevents running a partially initialized bot and prevents duplicate active instances.
- Breaking change examples:
  - Discord login happens before migration/static validation.
  - Advisory lock removed or bypassed.
  - Feature bootstraps skipped silently.
- Verification:
  - Manual: start with valid env and verify ordered startup logs and final `startup_completed`.
  - Automated: existing startup/feature tests (`startupVoiceAutoJoin.test.js`, schema and feature bootstrap tests).

## Contract 2: Shutdown Sequence
- Contract name: `shutdown_releases_resources_deterministically`
- Current behavior:
  - `SIGINT`, `SIGTERM`, `unhandledRejection`, and `uncaughtException` trigger `shutdown`.
  - Health server closes, penalty/private-room/presence schedulers stop, Discord client destroys, advisory lock releases, DB pool ends.
  - Non-zero shutdown exits with warning for supervisor restart policy.
- Why it matters:
  - Prevents orphan timers/locks and avoids duplicate-instance deadlocks after restart.
- Breaking change examples:
  - Lock release or DB pool close removed.
  - Shutdown exits before schedulers are stopped.
- Verification:
  - Manual: run bot, send `SIGINT`, verify resource cleanup logs and clean exit.
  - Automated: targeted integration around scheduler shutdown behavior.

## Contract 3: Prefix Moderation Flow
- Contract name: `prefix_flow_prioritizes_builtin_then_custom`
- Current behavior:
  - `messageCreate` rejects bot messages, DMs, and non-target guild traffic early.
  - Builtin moderation handler runs first (`moderation.handlePrefix`).
  - If builtin command handled message, custom command fallback does not run.
  - If not handled, custom command lookup is attempted from cache/DB-backed map.
- Why it matters:
  - Prevents accidental command shadowing and keeps historical command precedence stable.
- Breaking change examples:
  - Custom commands execute before moderation commands.
  - Prefix parsing starts accepting previously ignored patterns.
- Verification:
  - Automated: `discordClient.command-precedence.test.js`, custom command lookup tests.
  - Manual: create custom command named like builtin and confirm builtin still wins.

## Contract 4: Permission Checks
- Contract name: `permission_gate_is_fail_closed`
- Current behavior:
  - Command enablement, actor permission/role checks, hierarchy checks, rate-limit checks, and bot capability checks run before action.
  - Unauthorized spam replies are throttled.
  - Rate-limit abuse can trigger role-removal lock path.
  - Shared limit is consumed with commit/rollback receipt semantics.
- Why it matters:
  - This is the main safety boundary preventing privilege bypass and action spam.
- Breaking change examples:
  - Any permission/hierarchy branch becomes fail-open.
  - Limit receipt commit/rollback no longer consistent.
- Verification:
  - Automated: `moderation.permission.service.test.js`, `actionExecution.rate-limit.test.js`, lock policy tests.
  - Manual: run commands with/without required roles/permissions and check template responses.

## Contract 5: Ban/Unban Correctness
- Contract name: `ban_unban_are_authoritatively_verified`
- Current behavior:
  - Target IDs are validated for ban/unban.
  - Ban/unban actions use target mutation locks and guild-ban mutation locks.
  - Post-action authoritative checks (`ensureGuildBanPresent/Absent`) protect against stale cache false positives.
  - Known Discord "unknown ban" path is handled as not-banned.
- Why it matters:
  - Prevents false success messages and stale ban-state drift.
- Breaking change examples:
  - Success is emitted without authoritative verify.
  - Ban cache is not evicted after unban.
- Verification:
  - Automated: `moderation.ban-unban.state-sync.test.js`, `moderation.ban.command.test.js`, `moderation.unban.command.test.js`.
  - Manual: ban/unban same user repeatedly and verify response correctness.

## Contract 6: Timeout/Mute/Jail Scheduling Behavior
- Contract name: `timeouts_and_jail_restore_state_correctly`
- Current behavior:
  - `mute` applies Discord native timeout (default 28d when duration omitted), verifies state, and handles voice disconnect rollback on failure.
  - `unmute` clears timeout and verifies clear state authoritatively.
  - `jail` snapshots current roles, applies jail role, optionally schedules timed revoke.
  - `unjail` restores role snapshot and cancels pending jail penalty.
  - Penalty scheduler persists and reconciles active penalties on bootstrap.
- Why it matters:
  - Incorrect behavior can permanently damage role state or leave stale punishments active.
- Breaking change examples:
  - Jail role snapshots not saved/restored.
  - Timed penalties not reloaded after restart.
  - Timeout success emitted without verification.
- Verification:
  - Automated: `moderation.timeout.command.test.js`, `penaltyScheduler.integration.test.js`, `penaltyScheduler.production-hardening.test.js`.
  - Manual: apply timed jail, restart bot, ensure revoke still occurs.

## Contract 7: Reaction Rule Execution
- Contract name: `reaction_rules_enforce_constraints_and_log_results`
- Current behavior:
  - Rules are matched by guild/message/emoji key.
  - Trigger modes (`ADD`, `REMOVE`, `TOGGLE`) and role constraints are enforced.
  - Cooldown and `onlyOnce` guards prevent duplicate execution.
  - Actions are whitelist-based (`ROLE_ADD/REMOVE`, `DM_SEND`, `REPLY`, `CHANNEL_LINK`, `RUN_INTERNAL_COMMAND`, `REMOVE_OTHER_REACTIONS_IN_GROUP`).
  - Every rule result is persisted to reaction logs; only-once state is committed or released.
- Why it matters:
  - This domain has side effects (roles/messages/DMs) and can spam or over-assign roles if relaxed.
- Breaking change examples:
  - `onlyOnce` lock removed or not released correctly.
  - Unknown action types start executing.
- Verification:
  - Automated: `reaction.production-hardening.test.js`, `reaction.partial.service.test.js`, `reaction.emoji.test.js`.
  - Manual: create rule with cooldown and only-once; trigger repeatedly and inspect logs.

## Contract 8: Private Room Lifecycle
- Contract name: `private_room_lifecycle_is_owner_safe_and_recoverable`
- Current behavior:
  - Joining configured hub channel creates/moves user into a single owner room.
  - Room state is persisted (`private_voice_rooms`) and cached.
  - Owner-only controls run via interactions: lock/unlock, hide/show, permit/reject user/roles, transfer, rename, limit, delete.
  - Unauthorized members are disconnected when runtime enforcement requires it.
  - Empty rooms are auto-cleaned after 3 days inactivity.
  - Bootstrap repairs panel/snapshot state and cleans missing-channel stale records.
- Why it matters:
  - Complex concurrency/state domain with high user-visible impact and high corruption risk.
- Breaking change examples:
  - Multiple rooms per owner become possible.
  - Lock/hide snapshot restore drifts.
  - Cleanup deletes active rooms.
- Verification:
  - Automated: `privateRoom.integration.test.js`, `privateRoom.lock.test.js`, `privateRoom.race.test.js`.
  - Manual: create room, lock/hide/transfer/delete, restart bot, confirm state restoration.

## Contract 9: Dashboard Expectations (Detected Client Contract)
- Contract name: `dashboard_api_contract_must_remain_compatible`
- Current behavior:
  - Dashboard client expects session, health, guild metadata, settings, reaction-rules CRUD/health/test, bot-presence read, embed-send, and logout endpoints.
  - Axios client uses cookie-based credentials and `VITE_API_BASE`.
  - In scanned backend runtime, matching route implementation was not detected under `api/src`.
- Why it matters:
  - Dashboard usability depends on strict payload shape and endpoint availability.
- Breaking change examples:
  - Response shape for `/api/settings/:id` no longer compatible with `extractModerationSettingsPayload`.
  - Endpoint renamed without client update.
- Verification:
  - Manual: open dashboard and validate all tabs/actions against live backend.
  - Automated: add API contract tests before migration step (currently sparse client-only tests).

## Contract 10: DB Persistence Expectations
- Contract name: `runtime_state_tables_and_constraints_are_stable`
- Current behavior:
  - Startup ensures required runtime/audit tables and key indexes/constraints exist.
  - `timed_penalties` enforces one active penalty per guild/user/action.
  - Snapshot tables back channel lock and jail/private-room restore behavior.
  - Legacy config tables are archived/dropped out of active runtime path.
- Why it matters:
  - Migration safety depends on preserving table semantics and indexes used by runtime logic.
- Breaking change examples:
  - Remove partial unique index from timed penalties.
  - Change JSON column semantics without repository compatibility layer.
- Verification:
  - Automated: `postgresSchema.legacy-cleanup.test.js` and integration suites touching scheduler/private-room/reaction.
  - Manual: run migrations in empty and existing DBs; compare table/index existence.

## Contract 11: Error Handling Expectations
- Contract name: `errors_are_logged_and_degraded_without_silent_success`
- Current behavior:
  - Event listeners and command paths catch errors, log structured context, and return template/system-error responses.
  - `executeModerationAction` supports degraded-success semantics when follow-up side effects fail.
  - Process-level unhandled exceptions trigger controlled shutdown path.
- Why it matters:
  - Prevents hidden corruption and preserves operator visibility during incidents.
- Breaking change examples:
  - Swallowing errors without logs.
  - Returning success template after failed primary action.
- Verification:
  - Automated: `moderation.partial-failure.test.js`, production-hardening tests, diagnostics tests.
  - Manual: induce side-effect failures (e.g., log write failure) and inspect warning behavior.

## Contract 12: Critical User-Visible Responses
- Contract name: `critical_templates_and_feedback_text_remain_semantically_stable`
- Current behavior:
  - Moderation commands use template sender with placeholder rendering and no-empty-caseId cleanup.
  - Ban/unban/mute/notApplied/alreadyApplied responses map to explicit template keys.
  - Lock/unlock and private-room controls return deterministic status/error phrasing.
  - Allowed mentions are intentionally constrained in many response paths.
- Why it matters:
  - Staff workflow and user trust depend on reliable and unambiguous outcome messaging.
- Breaking change examples:
  - Case ID formatting regresses (empty `()` reappears).
  - Success text emitted for failed actions.
- Verification:
  - Automated: `moderation.case-id-response.test.js`, template and command tests.
  - Manual: run representative command matrix and compare output semantics.
