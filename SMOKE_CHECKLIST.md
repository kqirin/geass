# Production Smoke Checklist

All checks below are backward-compatible validation steps.  
Each step includes: precondition, action, expected result, and expected log signal.

## 1) Moderation (mute/jail/unmute/unjail)

### 1.1 Timed mute
- Precondition: Test guild has `mute_role`; moderator command permission enabled.
- Action: Use mute command with duration (example: `!mute @user 1m test`).
- Expected result: Target receives mute role; case/log entry created.
- Expected log: Moderation action log with `action=mute`, `guildId`, `userId`.

### 1.2 Timeless mute + manual unmute
- Precondition: Target currently muted.
- Action: Apply mute without duration, then run `unmute`.
- Expected result: Role removed immediately, no timed revoke pending.
- Expected log: `action=unmute` and no scheduler error for same user.

### 1.3 Timed jail + unjail
- Precondition: Jail role configured in settings.
- Action: Run `jail @user 1m reason`; after apply run `unjail` manually.
- Expected result: Member roles restored according to snapshot rules, jail role removed.
- Expected log: No `jail_restore_failed`; penalty marked inactive.

## 2) Timed Penalties (scheduler/reconcile)

### 2.1 Expiry revoke
- Precondition: Timed mute/jail/vcmute active.
- Action: Wait until duration ends.
- Expected result: Penalty auto-revoked once.
- Expected log: No duplicate revoke errors, no repeated action spam.

### 2.2 Manual cancel near expiry
- Precondition: Timed penalty with short duration active.
- Action: Cancel manually just before expiry.
- Expected result: Auto-revoke does not run after manual cancel.
- Expected log: No extra `penalty_revoke_failed`; row becomes inactive once.

### 2.3 Restart reconcile
- Precondition: Active timed penalty exists; bot restarted.
- Action: Restart API/Bot process.
- Expected result: Scheduler bootstrap reconciles active records and revokes overdue items.
- Expected log: Startup line with `Timed penalty scheduler hazir` and no fatal reconcile errors.

## 3) Reaction Actions

### 3.1 Create rule
- Precondition: Admin session in dashboard; target message exists.
- Action: Create reaction rule (unicode or custom emoji) with role action.
- Expected result: Rule saved, emoji placed on message, rule appears in list.
- Expected log: No `reaction_rule_create_failed` / no runtime exception.

### 3.2 Update + cleanup
- Precondition: Existing reaction rule.
- Action: Change message/channel/emoji and save.
- Expected result: Rule updated; old reaction cleanup warning only when permissions are missing.
- Expected log: No crash in cleanup path; warning text returned safely when needed.

### 3.3 Delete + trigger validation
- Precondition: Existing rule with action.
- Action: Delete rule; add/remove reaction on message for a remaining rule.
- Expected result: Deleted rule stops firing; active rule triggers exactly once per event.
- Expected log: `reaction_action_event_failed` must be absent in normal flow.

## 4) Private Voice Room

### 4.1 Hub create + owner persistence
- Precondition: Private VC enabled, hub channel + required role configured.
- Action: Owner joins hub twice.
- Expected result: First join creates room, second join reuses existing room.
- Expected log: No `private_room_channel_create_failed` / no duplicate room rows.

### 4.2 Owner lock/unlock + non-owner guard
- Precondition: Private room panel message exists.
- Action: Owner toggles lock; non-owner presses same lock button.
- Expected result: Owner action succeeds; non-owner gets permission denial.
- Expected log: No `private_room_interaction_failed`; denial response returned.

### 4.3 Whitelist add/remove
- Precondition: Locked room exists.
- Action: Owner syncs whitelist via user selector.
- Expected result: Added users can stay in room; removed users are disconnected when locked.
- Expected log: Room log entries for `WHITELIST_ADD/WHITELIST_REMOVE`.

### 4.4 Empty room cleanup
- Precondition: Room empty and stale (older than cleanup threshold) in DB.
- Action: Run bootstrap/restart and wait cleanup tick.
- Expected result: Stale room DB row and voice channel deleted.
- Expected log: No `private_room_db_delete_failed` / no orphan room rows.

## 5) Tag Role

### 5.1 Tag gain
- Precondition: Tag role feature enabled and role configured.
- Action: User adds configured tag to username.
- Expected result: Tag role assigned.
- Expected log: No hierarchy/permission errors unless expected by role position.

### 5.2 Tag removal
- Precondition: Same user has tag role.
- Action: User removes tag from username.
- Expected result: Tag role removed.
- Expected log: No repeated skip spam; throttled warnings only when needed.

## 6) Dashboard (settings + validation + requestId)

### 6.1 Settings save success
- Precondition: Authenticated admin session.
- Action: Save moderation/weekly/reaction settings with valid inputs.
- Expected result: Success toast shown.
- Expected log: No route error entries.

### 6.2 Validation failure (400)
- Precondition: Open relevant form (reaction/VC/settings).
- Action: Submit invalid snowflake/empty required field.
- Expected result: User sees explicit error message, and request id appears when returned.
- Expected log: Structured route error includes `requestId` and route context.

### 6.3 Session/auth edge
- Precondition: Expired cookie/session.
- Action: Trigger API action from dashboard.
- Expected result: Redirect or unauthorized message; no silent failure.
- Expected log: Standard 401/403 behavior without secret leakage.

## 7) `/api/health`

### 7.1 Payload safety
- Precondition: API running.
- Action: `GET /api/health`.
- Expected result: Only minimal fields (`ok`, `ts`, `checks`, `features`, `guildCount`) returned.
- Expected log: No secret/env/sql/stack data in response.

### 7.2 Header + polling behavior
- Precondition: Dashboard open.
- Action: Inspect health response headers and observe polling.
- Expected result: `Cache-Control: no-store, max-age=0`; polling is graceful and visibility-aware.
- Expected log: No health-related log spam under normal polling.
