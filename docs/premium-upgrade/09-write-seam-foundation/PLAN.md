# Write Seam Foundation Plan

## What write-capable seam was added
- Added a protected mutation pipeline for control-plane write routes:
  - auth precondition
  - guild-access precondition
  - bounded JSON body parsing
  - explicit payload validation
  - safe error mapping
  - lightweight mutation audit recording
- Added first low-risk protected read/write contract:
  - `GET /api/dashboard/protected/preferences`
  - `PUT /api/dashboard/protected/preferences`
- Added isolated, control-plane-local preference storage and mutation logic (no bot-domain writes).

## Why this is the safest next step
- The first mutation scope is intentionally harmless UI/operator preferences, not moderation or runtime bot state.
- Existing auth/session/guild policy boundaries are reused instead of reimplemented.
- Write handling is fail-closed for auth, configuration, guild scope, malformed payloads, unsupported media type, and oversized bodies.
- Mutation side effects are isolated to control-plane preference state and audit records only.

## What was intentionally deferred
- No moderation action write APIs.
- No reaction/private-room/penalty write APIs.
- No premium billing/entitlement behavior.
- No Redis/queue/sharding/slash-migration architecture work.
- No refactor of moderation/reaction/scheduler/private-room business logic.

## How this prepares future dashboard writes
- Future write routes can reuse the same pipeline pattern with:
  - boundary checks
  - schema-specific validation
  - conservative error contracts
  - audit events
- The seam provides a stable baseline for adding higher-risk mutations later behind stricter policy, role gates, and expanded auditing.
