# Guild Access Policy Plan

## What guild access layer was added
- Added a centralized guild access evaluator in `api/src/controlPlane/guildAccessPolicy.js`.
- Added explicit access levels:
  - `unauthenticated`
  - `authenticated_no_guild_access`
  - `authenticated_guild_member`
  - `authenticated_guild_operator`
- Extended OAuth/session principal shaping to carry safe guild membership summaries (no token/raw payload exposure).
- Added authenticated read-only route surfaces:
  - `GET /api/auth/guilds`
  - `GET /api/auth/access`
  - `GET /api/dashboard/context`
- Wired protected seams to use the same evaluator via `createRequireGuildAccess(...)`.

## Why this is the safest next step
- Changes are additive and isolated to control-plane/auth modules.
- No write or mutation route was introduced.
- Existing bot business logic (moderation/reaction/scheduler/private-room) was not refactored.
- Disabled control-plane mode remains untouched (`200 ok` legacy behavior).
- Auth-enabled routes fail closed when scope or membership is invalid/ambiguous.

## What was intentionally deferred
- Dashboard/frontend wiring and UX flows.
- Any write-capable dashboard API.
- Premium/billing/entitlement checks.
- Redis/shared session storage, sharding, queues, slash migration, or infra expansion.
- Advanced role/permission policy beyond minimal operator distinction required for access model stability.

## How this prepares next phases
- Future protected routes can now consistently distinguish unauthenticated, no-access, member, and operator states.
- Guild scope resolution is centralized and reusable for protected read/write routes.
- Operator/admin/premium gating can be layered onto the same evaluator without route-by-route rewrites.
- Safe, stable response contracts now exist for dashboard context bootstrap in later frontend phases.
