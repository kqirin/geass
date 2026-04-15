# Change Log (17 - Deploy Preparation)

## Runtime/Config Files

| File | Purpose | Runtime behavior changed? | Why safe | Rollback simplicity |
| --- | --- | --- | --- | --- |
| `api/src/config.js` | Added dashboard allowed-origin parsing and cookie secure hardening for `SameSite=None`. | Yes (config interpretation only). | No bot command/moderation logic touched; defaults remain local-dev compatible and production fail-closed. | Revert file to previous config parsing behavior. |
| `api/src/controlPlane/server.js` | Added credentialed CORS headers for allowed origins and `OPTIONS` preflight handling on API paths. | Yes (control-plane HTTP boundary only). | Applies only to enabled control-plane API path handling; disabled mode unchanged. | Revert file to remove CORS/preflight layer. |
| `api/src/controlPlane/preferencesRoutes.js` | Mutation origin allow-list now prefers explicit dashboard allowed origins with compatibility fallback. | Yes (protected write boundary only). | Keeps fail-closed origin checks and preserves compatibility fallback path. | Revert resolver function to previous single-source origin list. |
| `api/src/controlPlane/botSettingsRoutes.js` | Same as preferences route origin resolver update. | Yes (protected write boundary only). | Same fail-closed and compatibility-preserving rationale. | Revert resolver function to previous single-source origin list. |
| `api/.env.example` | Clarified Railway/static dashboard placeholders and added explicit dashboard origin variable. | No (example file only). | Documentation-only env template changes. | Revert file text. |
| `dashboard/.env.example` | Added local vs production `VITE_API_BASE` examples. | No (example file only). | Frontend runtime code unchanged. | Revert file text. |

## Tests

| File | Purpose | Runtime behavior changed? | Why safe | Rollback simplicity |
| --- | --- | --- | --- | --- |
| `api/test/controlPlane.cors.test.js` | New focused tests for origin allow/deny behavior, preflight handling, cookie safety, and local defaults. | No (test-only). | Expands coverage for deploy-prep boundary behavior. | Delete file if test is not needed. |

## Documentation Files

| File | Purpose | Runtime behavior changed? | Why safe | Rollback simplicity |
| --- | --- | --- | --- | --- |
| `docs/premium-upgrade/17-deploy-preparation/PLAN.md` | Scope and constraints for deploy-preparation phase. | No | Documentation only. | Delete/revert file. |
| `docs/premium-upgrade/17-deploy-preparation/ENVIRONMENT_MATRIX.md` | Mode-by-mode env matrix and safe flag combinations. | No | Documentation only. | Delete/revert file. |
| `docs/premium-upgrade/17-deploy-preparation/RAILWAY_BACKEND_GUIDE.md` | Railway backend/bot configuration checklist. | No | Documentation only. | Delete/revert file. |
| `docs/premium-upgrade/17-deploy-preparation/STATIC_DASHBOARD_GUIDE.md` | Static dashboard hosting preparation checklist. | No | Documentation only. | Delete/revert file. |
| `docs/premium-upgrade/17-deploy-preparation/CORS_COOKIE_OAUTH.md` | Consolidated CORS/cookie/OAuth alignment notes. | No | Documentation only. | Delete/revert file. |
| `docs/premium-upgrade/17-deploy-preparation/CHANGE_LOG.md` | Traceability for this phase. | No | Documentation only. | Delete/revert file. |
| `docs/premium-upgrade/17-deploy-preparation/FINAL_STATUS.md` | Execution results and readiness status. | No | Documentation only. | Delete/revert file. |
