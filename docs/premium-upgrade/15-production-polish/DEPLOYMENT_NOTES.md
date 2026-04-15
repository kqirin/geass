# Deployment Notes

## Required env vars for minimum production bot runtime
- `TOKEN` (required)
- Database config (one style required):
  - Preferred: `DATABASE_URL`
  - Fallback discrete fields: `DB_HOST`, `DB_USER`, `DB_NAME` (with `DB_PORT` optional/defaulted)
- Strongly recommended for hosted runtime:
  - `NODE_ENV=production`
  - `PORT` (enables HTTP health/control-plane listener)
  - `DB_SSL=1` or `DATABASE_URL` with `sslmode=require` in production

## Additional env vars for control-plane auth
- Enable control-plane HTTP API: `ENABLE_CONTROL_PLANE_API=1`
- Enable auth boundary: `ENABLE_CONTROL_PLANE_AUTH=1`
- Required for auth to be fully configured:
  - `CLIENT_ID`
  - `CLIENT_SECRET`
  - `REDIRECT_URI`
  - `SESSION_SECRET` (must be at least 16 chars)
- Cookie/session settings:
  - `CONTROL_PLANE_SESSION_COOKIE_NAME`
  - `CONTROL_PLANE_SESSION_TTL_MS`
  - `CONTROL_PLANE_OAUTH_STATE_TTL_MS`
  - `CONTROL_PLANE_AUTH_COOKIE_SECURE`
  - `CONTROL_PLANE_AUTH_COOKIE_SAMESITE`
  - `CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT` (falls back to `FRONTEND_URL` then `/`)
  - `CONTROL_PLANE_PUBLIC_BASE_URL` (used for mutation origin checks)

## Additional env vars for Redis/shared-state optional mode
- `ENABLE_CONTROL_PLANE_SHARED_STATE=1`
- `CONTROL_PLANE_SHARED_STATE_PROVIDER=redis`
- `CONTROL_PLANE_SHARED_STATE_REDIS_URL`
- Optional tuning:
  - `CONTROL_PLANE_SHARED_STATE_REDIS_PREFIX`
  - `CONTROL_PLANE_SHARED_STATE_REDIS_CONNECT_TIMEOUT_MS`
  - `CONTROL_PLANE_SHARED_STATE_REDIS_FALLBACK_TO_MEMORY` (default fail-open to memory)

## Additional env vars for scheduler optional mode
- `ENABLE_CONTROL_PLANE_SCHEDULER=1`
- `CONTROL_PLANE_SCHEDULER_PROVIDER=memory|hardened`
- If hardened mode:
  - `CONTROL_PLANE_SCHEDULER_REDIS_URL`
  - `CONTROL_PLANE_SCHEDULER_REDIS_PREFIX`
  - `CONTROL_PLANE_SCHEDULER_REDIS_CONNECT_TIMEOUT_MS`
  - `CONTROL_PLANE_SCHEDULER_REDIS_FALLBACK_TO_MEMORY`
  - `CONTROL_PLANE_SCHEDULER_HARDENED_DEFAULT_RECORD_TTL_MS`
- Optional adoption switch:
  - `CONTROL_PLANE_AUTH_EXPIRY_CLEANUP_SCHEDULER_ENABLED=1`

## Safe recommended flag combinations

### 1) Bot-only mode
- `ENABLE_CONTROL_PLANE_API=0`
- `ENABLE_CONTROL_PLANE_AUTH=0`
- `ENABLE_CONTROL_PLANE_SHARED_STATE=0`
- `ENABLE_CONTROL_PLANE_SCHEDULER=0`
- Result: legacy `200 ok` listener semantics for all paths; no control-plane API surface.

### 2) Bot + read-only control-plane
- `ENABLE_CONTROL_PLANE_API=1`
- `ENABLE_CONTROL_PLANE_AUTH=0`
- Shared-state/scheduler optional (`0` by default)
- Result: public read-only meta/dashboard endpoints available; auth-required/protected routes fail closed (`auth_disabled`).

### 3) Bot + auth-enabled control-plane
- `ENABLE_CONTROL_PLANE_API=1`
- `ENABLE_CONTROL_PLANE_AUTH=1`
- Provide full OAuth/session env set above
- Optional:
  - `ENABLE_CONTROL_PLANE_SHARED_STATE=1` + redis provider for shared auth state
  - `ENABLE_CONTROL_PLANE_SCHEDULER=1` for optional expiry cleanup adoption
- Result: authenticated routes active; protected read/write routes still policy- and capability-gated.

## Cookie/CORS/domain caveats
- Session cookie is HMAC-signed and `HttpOnly`; invalid signatures are rejected.
- If `CONTROL_PLANE_AUTH_COOKIE_SAMESITE=None`, keep `CONTROL_PLANE_AUTH_COOKIE_SECURE=1`.
- Protected mutation routes enforce origin checks against `CONTROL_PLANE_PUBLIC_BASE_URL` origin.
- `CORS_ORIGIN` is currently not consumed by backend runtime code; do not rely on it as backend CORS enforcement.
- `FRONTEND_URL` currently acts as fallback for post-login redirect only.

## Safe startup expectations
- Startup fails fast on missing required bot/db config (`validateConfig`).
- Static config validation runs after Discord login and can fail startup if configured guild bindings are invalid/missing.
- DB migrations and instance-lock acquisition use retry gates; fatal startup exits non-zero for external supervisor restart.
