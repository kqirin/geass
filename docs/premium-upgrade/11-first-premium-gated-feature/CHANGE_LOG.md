# Change Log (11 - First Premium-Gated Feature)

| File | Purpose | Default bot behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/controlPlane/planCapabilities.js` | Activates real enforcement mode for `advanced_dashboard_preferences` capability metadata. | No | Only affects control-plane capability decisions for a new advanced preference field. | Revert gating mode for that capability. |
| `api/src/controlPlane/preferencesRepository.js` | Adds harmless advanced preference field storage/normalization (`advancedLayoutMode`). | No | Isolated to dashboard preference data; no bot-domain state touched. | Remove field from defaults/normalizers/fingerprint. |
| `api/src/controlPlane/preferencesRoutes.js` | Validates and enforces premium capability for `preferences.advancedLayoutMode`; exposes safe plan/capability visibility in preferences payload. | No | Auth + guild access required, explicit validation, fail-closed ambiguous handling. | Revert advanced field validation/enforcement blocks. |
| `api/src/controlPlane/dashboardRoutes.js` | Passes feature-gate evaluator into preferences route definitions so plan checks are real. | No | Additive dependency wiring only; existing routes unchanged. | Revert injected option. |
| `api/test/controlPlane.server.test.js` | Adds integration coverage for free vs premium vs ambiguous entitlement behavior on advanced preference field. | No | Test-only verification, including no secret/token leakage assertions. | Revert new test block. |
| `docs/premium-upgrade/11-first-premium-gated-feature/PLAN.md` | Documents phase scope, safety rationale, and deferrals. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/11-first-premium-gated-feature/GATED_PREFERENCES_CONTRACT.md` | Documents read/write preference contract with plan-gated advanced field behavior. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/11-first-premium-gated-feature/CAPABILITY_ENFORCEMENT.md` | Documents exact capability enforcement path and fail-closed behavior. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/11-first-premium-gated-feature/CHANGE_LOG.md` | Tracks file-level safety and rollback guidance for this phase. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/11-first-premium-gated-feature/FINAL_STATUS.md` | Captures test outcomes and readiness signal for next phase. | No | Documentation only. | Delete file. |
