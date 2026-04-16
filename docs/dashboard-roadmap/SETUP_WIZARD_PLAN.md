# Setup Wizard Plan

Target: add a safe "Kurulum Sihirbazi" foundation without changing moderation/runtime behavior in early releases.

## Wizard Flow

### Step 1: Guild Scope
- Select guild (from authenticated operator guild list).
- Show access status and plan/capability summary.
- Read-only output:
  - `guildId`
  - static config present/missing
  - setup completeness score

### Step 2: Channels
- Collect or confirm:
  - `startup_voice_channel_id`
  - `private_vc_hub_channel`
  - `private_vc_category` (optional)
  - future log channels (not currently present in static settings; track as optional draft fields)
- Auto-detect suggestions:
  - Existing voice channels likely usable for startup/hub.
  - Existing category of hub channel as category fallback.

### Step 3: Roles
- Collect or confirm:
  - `private_vc_required_role`
  - `jail_penalty_role`
  - `mute_penalty_role`
  - `lock_role` (if lock policy enabled)
  - `tag_role`
  - `staff_hierarchy_roles`
  - `hard_protected_roles`
  - `hard_protected_users` (user IDs)
- Auto-detect suggestions:
  - Highest moderation-style roles by naming hints (`mod`, `admin`, `staff`) as suggestions only.

### Step 4: Features and Command Policy
- Toggle candidates:
  - `tag_enabled`, `private_vc_enabled`, `lock_enabled`
  - command policy flags: `log_enabled`, `warn_enabled`, `mute_enabled`, `kick_enabled`, `jail_enabled`, `ban_enabled`
- Policy candidates:
  - per-command `*_limit`, `*_safe_list`
  - `prefix`

### Step 5: Review, Validate, Save
- Show full diff preview (old -> new values).
- Run validation checks before save.
- Save with revision token and mutation audit record.

## Validation Rules (Must-Have)

Reuse/align with existing backend checks:
- Snowflake format check for role/channel/user ids.
- Role existence and not `@everyone` where invalid.
- Channel type check:
  - startup/hub must be voice/stage voice.
  - category must be guild category.
- Required dependencies:
  - if `private_vc_enabled = true` then `private_vc_hub_channel` and `private_vc_required_role` must be present.
  - if `jail_enabled = true` then `jail_penalty_role` must be present.
- Prefix validity:
  - non-empty, max length currently normalized to 3.
- List normalization:
  - dedupe comma-separated ID lists (`*_safe_list`, staff/protected lists).

Additional recommended validation before writes:
- Bot role hierarchy checks for managed roles (`jail_penalty_role`, `tag_role`, reaction-rule role targets when applicable).
- Startup voice permission readiness (`ViewChannel`, `Connect`) for bot member.

## Save Behavior

Phase-friendly save model:
- Early phase (read-only): no save; only "validate preview".
- Write phase:
  - accept a patch payload scoped to a guild.
  - apply whitelist filter to allowed keys.
  - validate merged settings before commit.
  - persist with optimistic concurrency (`revision`).
  - record mutation audit (`actorId`, `guildId`, changed keys, requestId).

## Rollback Behavior

- Always keep previous revision snapshot.
- On validation failure: reject without persisting.
- On post-save runtime validation failure:
  - rollback to previous revision atomically.
  - return structured error with `reasonCode` and failed keys.
- Provide "restore last known good config" action (guarded).

## Auto-Detected vs Manual Selection

Auto-detect (suggest, never force):
- Candidate startup voice channels.
- Candidate private room category from hub parent.
- Candidate moderation roles by naming hints.

Manual selection required:
- Hard-protected roles/users.
- Staff hierarchy roles.
- Prefix changes.
- Any feature toggle that can affect moderation execution (`ban`, `kick`, `jail`, `mute`, `lock`).

