# Request Flow (Auth-Ready Control Plane)

## 1) Listener entry
- `createControlPlaneRequestHandler` receives request.
- If `enabled=false`: immediate legacy health response (`200 ok`, text/plain) for all paths.

## 2) Enabled-mode control-plane gate
- Request path/query is normalized via `parseRequestPathAndQuery`.
- Non-`/api/*` requests continue to use health semantics (`200 ok`).
- Only `/api/*` requests enter control-plane API route resolution.

## 3) Request context creation
- `createControlPlaneRequestContext` builds and attaches `req.controlPlaneContext` with:
  - `requestId`
  - `receivedAt` / `receivedAtMs`
  - `method`, `path`, `query`
  - `controlPlaneEnabled`
  - `principal` placeholder (`null`)
  - `auth` placeholder (`pending` before resolver)
  - `guildScope` placeholder (`requestedGuildId`, unresolved access)

## 4) Auth-context seam
- `createAuthContextResolver` runs per request.
- Current phase behavior: returns `mode=not_configured`, `principal=null`.
- `attachAuthContext` stores sanitized auth metadata onto:
  - request context (`requestContext.auth`, `requestContext.principal`)
  - request object (`req.controlPlaneAuthContext`)

## 5) Route group selection
- Public group: all existing read-only routes (`/api/meta/*`, `/api/dashboard/*`).
- Protected group: `/api/control/private/*` placeholder routes.
- Grouping is explicit via `publicRoutes.js` and `protectedRoutes.js`.

## 6) Public route flow
- Public routes resolve through the public registry.
- Existing payload envelopes remain unchanged:
  - success: `{ ok: true, data: ... }`
  - errors: `{ ok: false, error, details }`

## 7) Protected route flow (placeholder-safe)
- Protected routes resolve through protected registry.
- Boundary checks run via `withBoundaryChecks`:
  - `requireAuth`
  - optional `requireGuildAccess`
- Current phase behavior: checks fail closed with safe response:
  - `503`
  - `error: auth_not_configured`
- Unknown/unsupported protected routes still get normal `404`/`405`.

## Future plug-in points
- Real login/session principal resolution plugs into `createAuthContextResolver`.
- Cookie/session persistence plugs in before or inside auth resolver layer.
- Guild-level admin checks harden `evaluateGuildAccessPolicy` and `requireGuildAccess`.
- Premium entitlement checks can be inserted as additional boundary checks in protected route wrappers.
