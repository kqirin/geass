# Adoption Scope

## Wrapped/migrated areas in this phase
- `api/src/controlPlane/sessionRepository.js`
  - optional scheduler-based session expiry cleanup job
- `api/src/controlPlane/oauthStateStore.js`
  - optional scheduler-based OAuth state expiry cleanup job
- `api/src/controlPlane/authFoundation.js`
  - scheduler creation/injection and adoption flag gating
- `api/src/controlPlane/authRoutes.js`
  - auth status visibility for scheduler mode/backend summary

## Why these targets were chosen
- They are low-risk, non-critical cleanup paths.
- They are already bounded inside control-plane auth/session domain.
- Existing behavior already treats expired entries as invalid, so cleanup scheduling is additive hardening.
- Failure impact is low because cleanup jobs are best-effort and non-destructive.

## Intentionally deferred risky areas
- Timed moderation penalties and execution semantics.
- Reaction action execution/cleanup lifecycle.
- Private room lifecycle timers and lock orchestration.
- Voice/connectivity orchestration queues.

## What is needed before broader migration
- Domain-level invariants for each high-risk path.
- Explicit replay/reconciliation strategy for restart/distributed execution.
- Dead-letter and operator runbook model for repeated failures.
- Incremental canary rollout and rollback checks per migrated domain.
