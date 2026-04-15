# Change Log (05 - Auth-Ready Boundary)

| File | Purpose | Default behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/controlPlane/requestContext.js` | Adds minimal per-request context creation and attachment seam. | No | API-only context metadata, no runtime mutation side effects. | Delete file and remove imports. |
| `api/src/controlPlane/principal.js` | Defines principal model normalization boundary. | No | Pure data-shape helper; no auth side effects. | Delete file and remove imports. |
| `api/src/controlPlane/guildAccessPolicy.js` | Adds future guild authorization policy seam. | No | Pure allow/deny evaluation helper; no external calls. | Delete file and remove imports. |
| `api/src/controlPlane/authBoundary.js` | Adds auth context resolver seam, `requireAuth`, `requireGuildAccess`, boundary check wrapper. | No | Fail-closed placeholder behavior; no real auth enabled. | Delete file and remove imports. |
| `api/src/controlPlane/publicRoutes.js` | Separates public route registry construction. | No | Route-definition extraction only; preserves existing public route handlers. | Delete file and inline previous route registration. |
| `api/src/controlPlane/protectedRoutes.js` | Adds explicit protected route namespace scaffolding (`/api/control/private/*`). | No | Placeholder routes fail safely (`503 auth_not_configured`) and expose no writes. | Delete file and remove protected router wiring. |
| `api/src/controlPlane/router.js` | Adds additive route `match` seam and forwards request/auth context to handlers. | No | Backward compatible with existing handlers; unchanged 404/405 behavior. | Revert file. |
| `api/src/controlPlane/server.js` | Wires request context + auth seam + public/protected route grouping. | No | Disabled mode unchanged; enabled mode public responses preserved; protected routes fail closed. | Revert file. |
| `api/test/controlPlane.server.test.js` | Expands coverage for protected placeholder behavior and request-context safety. | No | Test-only. | Revert file. |
| `docs/premium-upgrade/05-auth-ready-boundary/PLAN.md` | Documents scope/rationale/deferrals for auth-ready boundary phase. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/05-auth-ready-boundary/REQUEST_FLOW.md` | Documents control-plane request lifecycle and auth seam insertion points. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/05-auth-ready-boundary/ROUTE_CLASSIFICATION.md` | Documents public vs protected route categories and assumptions. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/05-auth-ready-boundary/CHANGE_LOG.md` | Records safety/rollback profile for all touched files. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/05-auth-ready-boundary/FINAL_STATUS.md` | Captures verification status and next-step recommendation. | No | Documentation only. | Delete file. |
