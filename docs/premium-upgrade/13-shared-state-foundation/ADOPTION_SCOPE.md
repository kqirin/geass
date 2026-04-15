# Adoption Scope

## Migrated/wrapped areas
- `oauthStateStore` now uses shared-state adapter contract.
- `sessionRepository` now uses shared-state adapter contract.
- `authFoundation` now resolves shared-state backend via selector and injects it into those two stores.
- `auth/status` payload now includes safe shared-state backend summary.

## Why these areas were chosen
- Short-lived auth/session state is low-risk and isolated.
- Existing control-plane auth already has strict fail-closed boundaries.
- Behavior can be validated with integration tests without touching moderation action semantics.
- These domains benefit from future horizontal-safe state sharing early.

## Risky areas intentionally deferred
- Moderation action locks/rate-limit coordination.
- Reaction rule execution state and mutation paths.
- Private-room runtime locks/ownership mutation internals.
- Penalty scheduler orchestration and job-style coordination.

## What is needed before broader migration
- Domain-by-domain invariants and conflict models documented.
- Dedicated lock/counter semantics where eventual consistency is unsafe.
- Operational hardening for Redis topology/failover/latency observability.
- Incremental rollout gates and rollback playbooks per migrated domain.
