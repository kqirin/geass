# Route Contract (Backend Auth Foundation)

## `GET /api/auth/login`
- Purpose: initiate Discord OAuth login.
- Auth disabled/unconfigured:
  - `503` JSON
  - `{ ok: false, error: "auth_disabled" | "auth_not_configured", details }`
- Auth configured:
  - `302` redirect to Discord OAuth authorize URL.
  - No secret/token in response body.

## `GET /api/auth/callback`
- Purpose: complete OAuth flow and establish server-side session.
- Request expectations:
  - query params: `code`, `state`
- Success:
  - `302` redirect to configured post-login location
  - sets signed session cookie
- Failure:
  - malformed callback: `400 invalid_oauth_callback`
  - invalid/expired state: `400 invalid_oauth_state`
  - upstream OAuth failure: safe error response (no token/secret leakage)
  - auth unavailable: `503`

## `GET /api/auth/status`
- Purpose: safe auth/session status summary.
- Always safe read-only response shape:
  - `200` with `{ ok: true, data }`
  - includes:
    - auth enabled/configured/authenticated booleans
    - reason code
    - principal summary when authenticated
    - session summary when authenticated

## `GET /api/auth/me`
- Purpose: authenticated principal summary.
- Auth disabled/unconfigured:
  - `503` JSON error
- Auth configured but no valid session:
  - `401 unauthenticated`
- Authenticated:
  - `200` with `{ ok: true, data }`
  - includes safe principal/session summary fields only

## `POST /api/auth/logout`
- Purpose: clear authenticated session.
- Auth disabled/unconfigured:
  - `503` JSON error
- Auth configured:
  - `200` JSON success
  - clears session cookie
  - invalidates current session record server-side when present

## Protected seam behavior (`/api/control/private/*`)
- Still no dangerous operations added.
- Now resolves real auth context:
  - disabled/unconfigured auth: `503`
  - configured but unauthenticated: `401`
  - authenticated: placeholder protected route responds successfully (read-only placeholder payload)

## Sensitive fields explicitly excluded from responses
- Discord OAuth client secret
- OAuth access tokens / refresh tokens
- raw OAuth provider payloads
- raw session signing secret
- raw DB credentials and unrelated secrets
