# Change Log (07 - Guild Access Policy)

| File | Purpose | Default bot behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/controlPlane/principal.js` | Adds normalized guild membership summary and operator signal on principal objects. | No | Auth/control-plane scoped data normalization only. | Revert file. |
| `api/src/controlPlane/oauthClient.js` | Adds `fetchUserGuilds` and guild OAuth API endpoint support. | No | Used only in auth-enabled callback flow; no runtime bot path impact. | Revert file. |
| `api/src/controlPlane/authGuildProviders.js` | Centralizes safe public guild summary projections and aggregate counts. | No | Read-only projection helper; no side effects. | Delete file and revert imports. |
| `api/src/controlPlane/guildAccessPolicy.js` | Implements centralized guild access evaluator with explicit access levels and fail-closed reason codes. | No | Additive policy seam; no mutation routes. | Revert file. |
| `api/src/controlPlane/authBoundary.js` | Adds `createRequireGuildAccess(...)` to enforce policy consistently and attach scoped access metadata to request context. | No | Boundary-only checks; denies on ambiguity. | Revert file. |
| `api/src/controlPlane/protectedRoutes.js` | Uses policy-backed guild access check for protected placeholder route. | No | Placeholder remains read-only; now policy-driven. | Revert file. |
| `api/src/controlPlane/server.js` | Passes config/static guild resolver dependencies into protected route and auth foundation seams. | No | Wiring-only change under control-plane gate. | Revert file. |
| `api/src/controlPlane/authFoundation.js` | Requests `identify guilds` scope and wires guild-scope dependencies into auth routes. | No | Auth-gated, additive, read-only access prep. | Revert file. |
| `api/src/controlPlane/authRoutes.js` | Adds `GET /api/auth/guilds` and `GET /api/auth/access`; enriches callback principal hydration with guild summaries. | No | Read-only endpoints, conservative payloads, no write actions. | Revert file. |
| `api/src/controlPlane/authenticatedDashboardContext.js` | Adds provider for authenticated read-only dashboard context payload. | No | Read-only output only, guarded by auth+guild checks. | Delete file and revert route wiring. |
| `api/src/controlPlane/dashboardRoutes.js` | Registers `GET /api/dashboard/context` with auth+guild boundary checks. | No | No mutation introduced; protected read-only contract only. | Revert file. |
| `api/test/controlPlane.server.test.js` | Extends tests for new access endpoints, no-access denial, operator allow-path, and secret non-leak guarantees. | No | Test-only verification. | Revert file. |
| `docs/premium-upgrade/07-guild-access-policy/PLAN.md` | Documents phase plan, rationale, and deferrals. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/07-guild-access-policy/ACCESS_MODEL.md` | Documents explicit access model and fail-closed logic. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/07-guild-access-policy/ROUTE_CONTRACT.md` | Documents new/changed route contracts and safe payload boundaries. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/07-guild-access-policy/CHANGE_LOG.md` | File-level rollout safety and rollback map. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/07-guild-access-policy/FINAL_STATUS.md` | Captures validation outcomes and phase readiness. | No | Documentation only. | Delete file. |
