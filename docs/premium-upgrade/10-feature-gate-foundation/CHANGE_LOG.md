# Change Log (10 - Feature Gate Foundation)

| File | Purpose | Default bot behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/controlPlane/planCapabilities.js` | Central plan tiers and capability matrix metadata. | No | Pure model constants/helpers. | Remove file and revert imports. |
| `api/src/controlPlane/guildPlanRepository.js` | In-memory guild plan repository seam for safe/manual entitlement sourcing. | No | Isolated storage seam, no billing integration. | Remove file and resolver wiring. |
| `api/src/controlPlane/entitlementResolver.js` | Central entitlement source resolution with explicit source/reason semantics. | No | Fail-closed unresolved handling; defaults to free plan when not ambiguous. | Remove file and revert evaluator wiring. |
| `api/src/controlPlane/featureGates.js` | Central capability evaluator and guild feature context builder. | No | Read-only decisions and metadata; no dangerous writes. | Remove file and route payload references. |
| `api/src/config.js` | Adds control-plane premium config fields (`defaultPlan`, `manualPlanOverrides`). | No | Additive config surface, safe defaults. | Revert file. |
| `api/src/controlPlane/server.js` | Wires entitlement resolver + feature gate evaluator into control-plane lifecycle. | No | Additive dependency wiring only. | Revert file. |
| `api/src/controlPlane/authFoundation.js` | Passes feature gate evaluator into auth route definitions. | No | Additive injection only. | Revert file. |
| `api/src/controlPlane/authRoutes.js` | Adds `GET /api/auth/plan` and safe plan/capability payload. | No | Read-only route; reuses existing auth+guild checks. | Revert route addition. |
| `api/src/controlPlane/authenticatedDashboardContext.js` | Adds feature gate summary to context payload and new features provider. | No | Additive read-only fields only. | Revert file. |
| `api/src/controlPlane/dashboardRoutes.js` | Registers `GET /api/dashboard/context/features` and passes evaluator into providers. | No | Protected read-only route addition. | Revert file. |
| `api/src/controlPlane/protectedDashboardProvider.js` | Adds plan/capability summary visibility in protected overview payload. | No | Additive metadata only. | Revert file. |
| `api/src/controlPlane/publicRoutes.js` | Passes feature gate evaluator into dashboard route creation. | No | Additive wiring only. | Revert file. |
| `api/src/controlPlane/metaProviders.js` | Adds premium summary metadata to config summary response. | No | Safe config summary fields only; no secrets. | Revert file. |
| `api/test/featureGates.foundation.test.js` | Unit coverage for plan/capability resolution defaults, overrides, and fail-closed paths. | No | Test-only. | Remove file. |
| `api/test/controlPlane.server.test.js` | Integration coverage for new plan/capability endpoints and ambiguous entitlement fail-closed behavior. | No | Test-only; verifies no secret leakage and compatibility. | Revert file. |
| `docs/premium-upgrade/10-feature-gate-foundation/*` | Phase documentation/contracts/status. | No | Documentation only. | Delete files. |
