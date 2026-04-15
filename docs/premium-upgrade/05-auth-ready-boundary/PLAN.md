# Auth-Ready Boundary Plan

## What boundary/seam was added
- Added a lightweight control-plane request context layer in `api/src/controlPlane/requestContext.js`:
  - request id
  - request timestamps
  - normalized method/path/query
  - control-plane enabled flag
  - principal/auth placeholders
  - guild scope placeholder
- Added explicit auth seam modules:
  - `api/src/controlPlane/principal.js` (principal shape boundary)
  - `api/src/controlPlane/authBoundary.js` (`authContext` resolver + `requireAuth` + `requireGuildAccess` placeholder checks)
  - `api/src/controlPlane/guildAccessPolicy.js` (future guild-policy seam)
- Split route registration into explicit groups:
  - `api/src/controlPlane/publicRoutes.js`
  - `api/src/controlPlane/protectedRoutes.js`
- Updated `api/src/controlPlane/server.js` to:
  - attach request/auth context for API requests when enabled
  - route `/api/control/private/*` to protected registry
  - fail protected placeholders safely (`503 auth_not_configured`) until real auth exists
- Kept `api/src/controlPlane/router.js` additive by expanding route resolve context and adding a `match` seam for future middleware-like execution control.

## Why this is the safest next step
- Default behavior remains unchanged: when `ENABLE_CONTROL_PLANE_API=false`, all paths still return legacy `200 ok`.
- Existing public read-only endpoints continue to serve unchanged payload contracts.
- Protected scaffolding is explicit but non-operational by default, so no unsafe capability is introduced.
- Changes are additive and isolated to control-plane modules; no moderation/reaction/scheduler/private-room logic was refactored.

## What was intentionally deferred
- Discord OAuth implementation
- Session/cookie persistence
- Real login/logout flows
- Real principal resolution from external identity providers
- Real guild admin authorization checks
- Entitlement/premium checks
- Any write/mutation route enablement

## How this prepares future auth/session work
- `createAuthContextResolver` is now the single entry seam for OAuth/session principal attachment.
- `requireAuth` and `requireGuildAccess` can be hardened later without restructuring route trees.
- Protected route grouping under `/api/control/private/*` gives a stable place for future authenticated endpoints.
- Request context seam provides stable per-request metadata for traceability, policy checks, and future audit logging.
