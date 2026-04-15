# Scheduler Hardening Plan

## What was added
- Added a new scheduler/job abstraction under `api/src/scheduler/` with a small delayed-job contract:
  - keyed identity/dedupe
  - replace-existing behavior
  - explicit cancel support
  - retry-ready metadata model
- Added two backend implementations:
  - memory backend (`memoryScheduler`)
  - optional hardened backend (`hardenedScheduler`) that uses the shared-state selector and can use Redis when configured
- Added backend/mode selector (`schedulerBackendSelector`) and runtime summary visibility.
- Added conservative control-plane config flags for enabling scheduler mode and selecting provider.

## Why this is the safest next step
- Default runtime behavior is preserved because scheduler mode is disabled by default.
- Adoption is limited to low-risk control-plane auth expiry cleanup (session + OAuth state).
- Existing high-risk bot domains (moderation/reaction/private-room/penalty execution) were not broadly migrated.
- Hardened provider is optional and has explicit fallback visibility.

## What was intentionally deferred
- No broad migration of penalty scheduler timers.
- No refactor of moderation command execution, reaction action flows, or private-room lifecycle logic.
- No requirement for Redis in default operation.
- No distributed durable replay/recovery for all jobs yet.
- No dead-letter queue or global multi-node execution guarantees in this phase.

## How this prepares production-grade background work
- Creates a reusable adapter seam so future jobs can migrate one domain at a time.
- Introduces explicit queue/scheduler mode metadata for staged rollout decisions.
- Establishes dedupe/cancel/replace/retry conventions before touching critical job paths.
- Provides a low-risk first adoption template for future higher-value migrations.
