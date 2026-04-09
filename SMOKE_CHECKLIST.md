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
- Precondition: Target message exists and reaction rule storage is accessible.
- Action: Insert a reaction rule (unicode or custom emoji) with role action.
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

