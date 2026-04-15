# Change Log (06 - Backend Auth Foundation)

| File | Purpose | Default bot behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/config.js` | Adds control-plane auth feature flags and OAuth/session config parsing. | No | Defaults keep auth disabled and preserve existing runtime behavior. | Revert file. |
| `api/.env.example` | Documents new auth-related environment variables. | No | Documentation/sample config only. | Revert file. |
| `api/src/controlPlane/server.js` | Integrates auth foundation, async route handling, and direct response support (redirect/cookie endpoints). | No | Control-plane gated; disabled mode still returns legacy health behavior. | Revert file. |
| `api/src/controlPlane/router.js` | Makes route resolution async-safe for OAuth/callback handlers. | No | Backward compatible for sync handlers; method/404 semantics unchanged. | Revert file. |
| `api/src/controlPlane/publicRoutes.js` | Registers auth route definitions in public control-plane route group and capabilities list. | No | Read-only route wiring; no bot-domain mutations. | Revert file. |
| `api/src/controlPlane/metaProviders.js` | Extends runtime/capability/config-summary outputs with auth foundation state fields. | No | Summary-only metadata; no secret values returned. | Revert file. |
| `api/src/controlPlane/requestContext.js` | Extends request auth placeholder fields (`enabled`, `authenticated`). | No | Context metadata only, no behavior side effects. | Revert file. |
| `api/src/controlPlane/principal.js` | Centralizes authenticated principal normalization and Discord identity mapping. | No | Safe shape normalization only. | Revert file. |
| `api/src/controlPlane/authBoundary.js` | Upgrades auth-context resolver to real session-based resolution and fail-closed auth checks. | No | Disabled/unconfigured modes explicitly fail safe; no fake auth. | Revert file. |
| `api/src/controlPlane/routeHttpResponse.js` | Adds direct-response helper for redirects and explicit cookie-bearing JSON responses. | No | Transport helper only; explicit and scoped usage. | Delete file and revert references. |
| `api/src/controlPlane/sessionRepository.js` | Adds minimal in-memory session storage with TTL and safe summary projection. | No | Isolated control-plane auth storage; no write endpoints added. | Delete file and revert references. |
| `api/src/controlPlane/sessionCookie.js` | Adds signed session cookie serialization/verification and cookie parsing helpers. | No | HMAC-signed cookie boundary; no secret leakage in outputs. | Delete file and revert references. |
| `api/src/controlPlane/oauthStateStore.js` | Adds in-memory OAuth state store with one-time consume + TTL. | No | CSRF/state replay mitigation seam, isolated module. | Delete file and revert references. |
| `api/src/controlPlane/oauthClient.js` | Adds Discord OAuth client (authorize URL, code exchange, identity fetch). | No | Auth-gated usage; safe error handling and no token exposure in responses. | Delete file and revert references. |
| `api/src/controlPlane/authRoutes.js` | Adds `/api/auth/*` endpoints for login/callback/status/me/logout with safe contracts. | No | Read-only auth/session routes only; no control-plane write operations. | Delete file and revert route registration. |
| `api/src/controlPlane/authFoundation.js` | Composes OAuth client, state store, session store, cookie manager, and auth resolver seams. | No | Centralized wiring keeps scope contained and reversible. | Delete file and revert server integration. |
| `api/test/controlPlane.server.test.js` | Adds auth foundation coverage: flags, unconfigured safe failures, OAuth callback/session lifecycle, logout, protected auth gating. | No | Test-only, verifies no regressions. | Revert file. |
| `docs/premium-upgrade/06-backend-auth-foundation/PLAN.md` | Phase plan/rationale/deferrals documentation. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/06-backend-auth-foundation/OAUTH_FLOW.md` | Documents OAuth sequence and safety behavior. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/06-backend-auth-foundation/SESSION_MODEL.md` | Documents session/cookie/storage model and migration path. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/06-backend-auth-foundation/ROUTE_CONTRACT.md` | Documents auth route contract and safe fields/exclusions. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/06-backend-auth-foundation/CHANGE_LOG.md` | Records file-level safety/rollback profile. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/06-backend-auth-foundation/FINAL_STATUS.md` | Captures verification results and next-step readiness. | No | Documentation only. | Delete file. |
