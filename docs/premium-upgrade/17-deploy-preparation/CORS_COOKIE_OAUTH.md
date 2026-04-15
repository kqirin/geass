# CORS, Cookie, and OAuth Notes

## Allowed Origin Behavior
- Control-plane API now supports explicit dashboard origin allow-list via:
  - `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN`
- Compatibility fallbacks still exist:
  - `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGINS`
  - `CORS_ORIGIN`
  - `FRONTEND_URL`
- Development default:
  - if no explicit origin env is set and `NODE_ENV!=production`, backend allows:
    - `http://localhost:5173`
    - `http://127.0.0.1:5173`
- Production default:
  - empty allow-list (explicit origin expected).

## Credentials and Preflight Behavior
- For allowed origins, API responses include:
  - `Access-Control-Allow-Origin: <exact-origin>`
  - `Access-Control-Allow-Credentials: true`
  - `Vary: Origin`
- No wildcard `*` is used with credentials.
- `OPTIONS` preflight on `/api/*`:
  - allowed origin -> `204` with allow-method/header metadata
  - disallowed origin -> `403 cors_origin_denied`

## Protected Mutation Origin Checks
- Protected mutation routes still enforce origin checks.
- Origin candidates now prioritize configured dashboard allowed origins, with compatibility fallback to:
  - `CONTROL_PLANE_PUBLIC_BASE_URL`
- Result: writes remain fail-closed when origin alignment is wrong.

## Cookie Security Expectations
- Session cookie remains:
  - signed (HMAC)
  - `HttpOnly`
  - configurable `SameSite`
- Safety hardening:
  - if `CONTROL_PLANE_AUTH_COOKIE_SAMESITE=None`, secure mode is forced on.
- Recommended production baseline:
  - `CONTROL_PLANE_AUTH_COOKIE_SECURE=1`
  - `CONTROL_PLANE_AUTH_COOKIE_SAMESITE=Lax` (or `None` for cross-site requirements)

## Local vs Production OAuth URL Examples
- Local callback URL:
  - `http://localhost:3000/api/auth/callback`
- Railway callback URL:
  - `https://your-api.up.railway.app/api/auth/callback`
- Static dashboard URL example:
  - `https://your-dashboard.pages.dev`

## Discord Developer Portal Redirect Checklist
1. Add local callback URL for local testing.
2. Add Railway callback URL for production.
3. Ensure backend `REDIRECT_URI` exactly matches one configured portal redirect.
4. Ensure backend `CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT` points to dashboard origin path.
5. Validate login -> callback -> dashboard redirect flow in browser.

## Common Auth Failure Cases
1. `REDIRECT_URI` does not match Discord portal.
2. Cookie blocked due insecure context or SameSite/secure mismatch.
3. Dashboard origin not included in backend allow-list.
4. Backend auth enabled but missing `CLIENT_ID`/`CLIENT_SECRET`/`SESSION_SECRET`.
