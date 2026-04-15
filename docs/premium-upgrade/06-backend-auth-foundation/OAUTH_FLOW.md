# OAuth Flow (Discord Backend Auth)

## Login initiation (`GET /api/auth/login`)
1. Validate auth availability:
   - control-plane auth enabled
   - OAuth client config present
   - session secret/cookie signing configured
2. Generate one-time OAuth `state` (random, TTL-bounded, in-memory).
3. Build Discord authorize URL with:
   - `client_id`
   - `response_type=code`
   - `redirect_uri`
   - `scope=identify`
   - `state`
4. Return `302` redirect to Discord authorize endpoint.

If unavailable/misconfigured:
- returns safe `503` JSON error (`auth_disabled` or `auth_not_configured`).

## Callback handling (`GET /api/auth/callback`)
1. Validate callback query inputs (`code`, `state`).
2. Validate and consume OAuth `state` from store (one-time, expiration enforced).
3. Exchange authorization code at Discord token endpoint.
4. Use access token to fetch user identity (`/users/@me`).
5. Normalize safe principal from Discord identity.
6. Create server-side session with TTL.
7. Set signed HttpOnly cookie.
8. Return `302` redirect to configured post-login URL.

## Failure cases handled
- Missing `code`/`state`: `400 invalid_oauth_callback`
- Unknown/expired/replayed state: `400 invalid_oauth_state`
- Discord token/identity upstream failures: safe non-secret error response
- Principal normalization failure: safe callback failure response
- Auth disabled/unconfigured: `503` safe failure response

## Security properties in this phase
- One-time state validation to prevent callback CSRF/replay.
- No tokens/client secrets are returned in API responses.
- OAuth access token is used transiently for identity fetch and not exposed to callers.
- Session cookie is signed and validated server-side.

## Intentionally not yet implemented
- OAuth refresh-token lifecycle storage/rotation
- Multi-provider account linking
- Persistent distributed OAuth/session storage
- Automatic guild membership/permission sync for authorization decisions
