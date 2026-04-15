# Backend Auth Foundation Plan

## What auth foundation was added
- Added real Discord OAuth backend flow for control-plane authentication:
  - login initiation (`/api/auth/login`)
  - callback handling (`/api/auth/callback`)
  - code exchange + identity fetch against Discord OAuth endpoints
- Added server-side session foundation:
  - in-memory session repository (bounded TTL, expiring records)
  - signed HttpOnly session cookie
  - auth context resolution from cookie + session
  - logout with server-side session invalidation + cookie clear
- Added explicit auth route group integrated into the existing control-plane request boundary:
  - `/api/auth/status`
  - `/api/auth/me`
  - `/api/auth/logout`
- Connected existing protected route seam to real auth context so authenticated requests can pass placeholder protected checks.

## Why this is the safest next step
- Default behavior remains unchanged when `ENABLE_CONTROL_PLANE_API=false` (legacy health behavior preserved).
- Auth remains explicitly flag-gated (`ENABLE_CONTROL_PLANE_AUTH`) and fails safely when disabled or misconfigured.
- Changes are additive and isolated to control-plane modules, config parsing, and tests.
- No write/mutation control-plane endpoints were added.
- No moderation/reaction/private-room/scheduler bot logic was refactored.

## What was intentionally deferred
- Dashboard/frontend login wiring
- Distributed/shared session storage (Redis/DB-backed shared session layer)
- Guild-admin authorization enforcement for protected business actions
- Premium entitlement checks and billing integration
- Any mutation route enablement
- OAuth refresh-token persistence and advanced account-link lifecycle

## How this prepares future dashboard, guild access, and premium work
- Auth/session context is now real and centralized, so future protected route policies can rely on principal/session resolution without route rewrites.
- Principal model now has safe identity fields suitable for dashboard identity display and future guild-scope checks.
- Session/cookie seams are encapsulated and can be swapped to distributed storage later with low blast radius.
- Existing protected boundary (`requireAuth`, `requireGuildAccess`) now operates on real authenticated state and can be extended for guild-admin and entitlement checks in next phases.
