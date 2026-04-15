# Shared-State Foundation Plan

## What shared-state foundation was added
- Added a small shared-state adapter layer with a common key-value + TTL contract:
  - memory adapter (`memoryStore`)
  - optional Redis adapter (`redisStore`)
  - backend selector with explicit memory fallback (`stateBackendSelector`)
- Added configuration flags for optional shared-state backend selection.
- Adopted the foundation only in low-risk auth state paths:
  - OAuth state storage
  - control-plane session storage

## Why this is the safest next step
- Default mode remains memory-backed and unchanged.
- Redis is optional and feature-flag/config gated.
- Adoption scope is limited to short-lived auth/session state, not dangerous moderation/runtime mutation surfaces.
- Redis failures are handled with explicit fallback behavior instead of broad runtime disruption.

## What was intentionally deferred
- No broad migration of moderation/reaction/private-room/scheduler state.
- No queue/job/sharding/slash migration work.
- No cutover of all process-local caches or locks.
- No mandatory Redis dependency for baseline operation.

## How this prepares future scale/horizontal safety
- Establishes a reusable backend abstraction for cross-process state needs.
- Makes backend selection explicit and injectable instead of hardcoded.
- Provides a low-risk template for incremental migration of additional state domains.
- Adds backend visibility metadata to support staged rollout decisions.
