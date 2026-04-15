# Dashboard Contract Alignment Plan

## What was added
- Extended the existing control-plane foundation (no replacement) with a read-only dashboard contract layer.
- Added new control-plane modules:
  - `api/src/controlPlane/guildScope.js`
  - `api/src/controlPlane/dashboardProviders.js`
  - `api/src/controlPlane/dashboardRoutes.js`
- Extended control-plane routing in `api/src/controlPlane/server.js` to register:
  - `GET /api/dashboard/overview`
  - `GET /api/dashboard/guild`
  - `GET /api/dashboard/features`
  - `GET /api/dashboard/resources`
- Updated `api/src/controlPlane/router.js` to pass parsed request context (`path`, `query`) to provider handlers.
- Extended `api/src/controlPlane/metaProviders.js` capabilities output with dashboard route visibility.
- Expanded tests in `api/test/controlPlane.server.test.js` for:
  - disabled-mode compatibility
  - enabled-mode dashboard endpoints
  - stable response shapes
  - secret/non-safe non-leak checks
  - missing/invalid guild context safety handling

## Why this is the safest next step
- Flag-gated: behavior remains unchanged when `ENABLE_CONTROL_PLANE_API=false`.
- Read-only only: no mutation routes, no writes, no command logic changes.
- Additive only: existing bot runtime domains (moderation/reaction/private-room/scheduler) were not refactored.
- Conservative data contract: summary fields only, no raw env/secrets/tokens/PII payloads.
- Provider boundaries are explicit, enabling future auth wrapping without core runtime edits.

## What was intentionally deferred
- Authentication/session enforcement.
- Dashboard frontend wiring.
- Any write endpoints or settings updates.
- Premium systems (billing/entitlements), Redis/queues/sharding, slash migration.
- Detailed moderation/private-room/member-level data exposure.

## How this reduces dashboard/backend contract drift
- Defines a stable, documented backend contract surface for dashboard-oriented read models now.
- Makes scope handling explicit (single-guild/unscoped/invalid-request states) instead of ad hoc assumptions.
- Keeps compatibility and evolution paths clear by separating route registration, guild-scope resolution, and providers.
