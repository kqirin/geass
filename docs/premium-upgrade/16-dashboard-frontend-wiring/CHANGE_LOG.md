# Change Log (16 - Dashboard Frontend Wiring)

| File | Purpose | Bot/runtime behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `dashboard/src/lib/apiClient.js` | Centralized control-plane auth/protected endpoint helpers, envelope unwrapping, normalized API error mapping. | No (frontend-only) | No backend logic modified; only request wiring in dashboard client. | Single-file revert. |
| `dashboard/src/hooks/useDashboardData.js` | Replaced legacy dashboard data flow with auth-gated control-plane bootstrap, protected snapshot loading, and low-risk settings mutations. | No (bot runtime untouched) | Fail-closed state machine (`401/403/503` mapped), no new backend endpoints. | Single-file revert. |
| `dashboard/src/pages/Dashboard.jsx` | Rendered explicit auth/no-access/auth-unavailable/loading states and added small cards for plan/capabilities/preferences/status-command settings. | No | UI-only integration to existing contracts; no broad redesign or backend writes beyond allowed low-risk endpoints. | Single-file revert. |
| `dashboard/src/components/Dashboard/shell/DashboardHeader.jsx` | Added authenticated/unauthenticated action switching (`CIKIS` vs `GIRIS`) without layout churn. | No | Pure presentational change. | Single-file revert. |
| `dashboard/src/components/Dashboard/shell/SystemHealthCard.jsx` | Switched health summary source to protected overview runtime/capability data. | No | Read-only display logic only. | Single-file revert. |
| `dashboard/src/pages/Login.jsx` | Login action now uses centralized API login URL helper. | No | Same endpoint intent, less duplication. | Single-file revert. |
| `dashboard/src/App.jsx` | Removed obsolete `/api/auth/session` private-route gate and routed `/dashboard` directly to stateful dashboard page. | No | Auth gating now happens via control-plane contract inside dashboard hook. | Single-file revert. |
| `dashboard/test/useDashboardData.test.js` | Added focused contract tests for unauth/auth-unavailable/no-access, protected snapshot load, plan/capability path, and preferences/status writes. | No | Test-only changes. | Single-file revert. |
| `docs/premium-upgrade/16-dashboard-frontend-wiring/PLAN.md` | Phase scope, non-goals, consumed contracts, and deferred deploy-domain work. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/16-dashboard-frontend-wiring/API_MAPPING.md` | Endpoint-by-endpoint frontend-to-backend contract mapping. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/16-dashboard-frontend-wiring/UI_STATES.md` | Explicit UI state behavior and save-state semantics. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/16-dashboard-frontend-wiring/CHANGE_LOG.md` | Per-file safety and rollback tracking for phase 16. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/16-dashboard-frontend-wiring/FINAL_STATUS.md` | Final command/test results and readiness summary for this phase. | No | Documentation only. | Delete file. |
