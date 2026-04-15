# Route Classification (Auth-Ready Boundary)

## Public routes (active, read-only)

| Route | Why public now | Current security assumption |
|---|---|---|
| `GET /api/meta/runtime` | Safe runtime snapshot for health/observability and dashboard bootstrap. | Non-secret summary fields only; no token/password/session data. |
| `GET /api/meta/capabilities` | Feature negotiation and contract discovery for dashboard clients. | Metadata-only response; no privileged action exposure. |
| `GET /api/meta/config-summary` | Safe readiness/config diagnostics surface. | Booleans/counts only; secrets and raw credentials excluded. |
| `GET /api/dashboard/overview` | Read-only high-level dashboard summary. | Bounded scope summary only; no writes. |
| `GET /api/dashboard/guild` | Read-only guild configuration snapshot for UI rendering. | Static summary shape only; no mutating behavior. |
| `GET /api/dashboard/features` | Read-only feature-state snapshot. | Boolean/configured flags only; no privileged mutation paths. |
| `GET /api/dashboard/resources` | Read-only resource/binding counts and infra summary. | Count-oriented payloads; no sensitive raw values. |

## Future protected routes (scaffold-only)

| Route | Why protected | Current behavior |
|---|---|---|
| `GET /api/control/private/status` | Placeholder authenticated namespace starter. | Fails safely with `503 auth_not_configured`. |
| `GET /api/control/private/guild-access` | Placeholder for auth + guild authorization seam. | Fails safely with `503 auth_not_configured`. |

## Security assumptions currently in force
- `ENABLE_CONTROL_PLANE_API=false` remains authoritative default behavior (`200 ok` health semantics for all paths).
- No real authentication source exists yet.
- No session/cookie identity persistence exists yet.
- Protected namespace is intentionally non-operational and fail-closed.
- Public routes remain read-only and bounded to safe summary data.

## What must change before protected routes become real
1. Implement real identity resolution (Discord OAuth and session transport).
2. Replace placeholder `createAuthContextResolver` with session-backed principal loading.
3. Harden `requireAuth` and `requireGuildAccess` with production policy + audit semantics.
4. Add route-specific authorization policy tests per protected endpoint.
5. Keep write routes disabled until auth + authorization + contract tests are complete.
