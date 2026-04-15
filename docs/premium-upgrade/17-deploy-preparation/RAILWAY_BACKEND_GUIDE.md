# Railway Backend Guide

## Scope
This guide prepares the backend/bot service for Railway deployment without executing deployment.

## Railway Project Expectations
- Single service running `api/` Node runtime.
- Service must expose HTTP on Railway-provided `PORT`.
- Bot gateway and control-plane HTTP listener run in the same process.

## Start Command Expectations
- Working directory: `api`
- Start command:
  - `npm run start`
- Optional migration command (manual/one-off):
  - `npm run migrate`

## Required Environment Variables
- Core runtime:
  - `NODE_ENV=production`
  - `TOKEN`
  - `TARGET_GUILD_ID`
  - `PORT` (Railway runtime-provided)
- Database:
  - preferred `DATABASE_URL=postgresql://...` (with TLS, e.g. `sslmode=require`)
  - optional: `DB_SSL=1`
- Control-plane/auth:
  - `ENABLE_CONTROL_PLANE_API=1`
  - `ENABLE_CONTROL_PLANE_AUTH=1`
  - `CLIENT_ID`
  - `CLIENT_SECRET`
  - `REDIRECT_URI=https://your-api.up.railway.app/api/auth/callback`
  - `SESSION_SECRET` (>=16 chars)
  - `CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT=https://your-dashboard.pages.dev/`
  - `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN=https://your-dashboard.pages.dev`
  - `CONTROL_PLANE_PUBLIC_BASE_URL=https://your-api.up.railway.app`

## Optional Environment Variables
- Cookie/session tuning:
  - `CONTROL_PLANE_SESSION_COOKIE_NAME`
  - `CONTROL_PLANE_SESSION_TTL_MS`
  - `CONTROL_PLANE_OAUTH_STATE_TTL_MS`
  - `CONTROL_PLANE_AUTH_COOKIE_SECURE=1`
  - `CONTROL_PLANE_AUTH_COOKIE_SAMESITE=Lax|None`
- Shared state / Redis:
  - `ENABLE_CONTROL_PLANE_SHARED_STATE=1`
  - `CONTROL_PLANE_SHARED_STATE_PROVIDER=redis`
  - `CONTROL_PLANE_SHARED_STATE_REDIS_URL`
- Scheduler:
  - `ENABLE_CONTROL_PLANE_SCHEDULER=1`
  - `CONTROL_PLANE_SCHEDULER_PROVIDER=memory|hardened`
  - hardened Redis envs when applicable

## Database and Redis Notes
- `DATABASE_URL` is the recommended Railway pattern.
- Shared-state and scheduler Redis are optional; memory fallback can remain enabled for safety.
- If enabling Redis-based modes, verify connection timeouts and fallback flags before rollout.

## Health Endpoint Expectations
- `GET /health`:
  - always returns `200 ok` when HTTP listener is active.
- `GET /api/meta/runtime`:
  - available only when `ENABLE_CONTROL_PLANE_API=1`.
- Control-plane disabled mode:
  - listener keeps legacy `ok` behavior for all paths.

## Common Railway Failure Cases
1. Missing `TOKEN` or DB config causes startup validation failure.
2. `REDIRECT_URI` mismatch with Discord portal causes OAuth callback errors.
3. Missing/incorrect `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN` breaks credentialed dashboard API calls.
4. Cookie mismatch (`SameSite=None` without secure HTTPS context) blocks session persistence.
5. Incorrect `DATABASE_URL` protocol or TLS flags causes migration/runtime DB failures.
