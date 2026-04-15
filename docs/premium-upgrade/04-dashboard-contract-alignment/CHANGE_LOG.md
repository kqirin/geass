# Change Log (04 - Dashboard Contract Alignment)

| File | Purpose | Default behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/controlPlane/guildScope.js` | Adds bounded guild scope resolver for dashboard contract routes. | No | Read-only resolver logic, no runtime side effects. | Delete file and remove imports. |
| `api/src/controlPlane/dashboardProviders.js` | Adds safe read-only summary providers (overview/guild/features/resources). | No | Summary-only fields, no secrets, no mutating calls. | Delete file and remove imports. |
| `api/src/controlPlane/dashboardRoutes.js` | Groups dashboard route registrations for future auth wrapping. | No | Route definitions only; no business logic mutation. | Delete file and route registration usage. |
| `api/src/controlPlane/router.js` | Extends route resolve context to pass `query`/`req` to handlers. | No | Backward compatible with prior handlers; read-only. | Revert file. |
| `api/src/controlPlane/metaProviders.js` | Extends capabilities endpoint to include additional route list. | No | Metadata-only change; no runtime bot logic changes. | Revert file. |
| `api/src/controlPlane/server.js` | Registers `/api/dashboard/*` routes and request query parsing while preserving health compatibility behavior. | No | Flag-gated control-plane only; disabled mode unchanged (`ok` health behavior). | Revert file. |
| `api/test/controlPlane.server.test.js` | Adds coverage for dashboard endpoints, scope handling, shape stability, and non-leak guarantees. | No | Test-only. | Revert file. |
| `docs/premium-upgrade/04-dashboard-contract-alignment/PLAN.md` | Documents scope/rationale/deferrals. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/04-dashboard-contract-alignment/API_CONTRACT.md` | Documents endpoint contract, shapes, exclusions, and auth notes. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/04-dashboard-contract-alignment/DASHBOARD_MAPPING.md` | Maps dashboard areas to provider/endpoints and deferred work. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/04-dashboard-contract-alignment/CHANGE_LOG.md` | Records change safety and rollback. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/04-dashboard-contract-alignment/FINAL_STATUS.md` | Captures validation outcome and next-step recommendation. | No | Documentation only. | Delete file. |
