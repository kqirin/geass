# Change Log (14 - Scheduler Hardening)

| File | Purpose | Default behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/scheduler/index.js` | Adds scheduler facade API (schedule/dedupe/replace/cancel/retry/status summary). | No | Scheduler mode is config-gated and disabled by default. | Remove scheduler integration call sites and module. |
| `api/src/scheduler/memoryScheduler.js` | Adds baseline in-memory scheduler backend. | No | In-process backend only, additive. | Delete module and use prior behavior. |
| `api/src/scheduler/hardenedScheduler.js` | Adds optional hardened backend using shared-state selector (Redis-capable). | No | Optional provider path with explicit fallback summary; no default dependency requirement. | Remove hardened backend and keep memory backend. |
| `api/src/scheduler/schedulerBackendSelector.js` | Adds backend/provider selector with fallback and adoption-flag summary. | No | Additive selector logic; defaults fail-safe to disabled/memory. | Revert selector usage and provider config keys. |
| `api/src/config.js` | Adds scheduler/adoption env parsing under `controlPlane.scheduler`. | No | Conservative defaults (`enabled=false`). | Remove added config block and env parsing constants. |
| `api/.env.example` | Documents optional scheduler env flags. | No | Documentation/example only. | Remove added env lines. |
| `api/src/controlPlane/authFoundation.js` | Wires scheduler creation and opt-in injection into auth expiry cleanup targets. | No | Adoption is explicitly gated and best-effort. | Revert scheduler wiring in auth foundation. |
| `api/src/controlPlane/sessionRepository.js` | Adds optional scheduled session-expiry cleanup integration. | No | Existing TTL/lookup behavior remains; scheduler cleanup is additive and non-fatal. | Remove scheduler hooks and retain store-only behavior. |
| `api/src/controlPlane/oauthStateStore.js` | Adds optional scheduled OAuth-state expiry cleanup integration. | No | Existing consume/TTL path remains; scheduler cleanup is additive and non-fatal. | Remove scheduler hooks and retain store-only behavior. |
| `api/src/controlPlane/authRoutes.js` | Adds safe scheduler summary visibility to `/api/auth/status`. | No | Read-only summary fields only; no secrets/tokens exposed. | Revert summary field addition. |
| `api/src/controlPlane/metaProviders.js` | Adds scheduler config summary visibility in `/api/meta/config-summary`. | No | Exposes booleans/provider only. | Revert scheduler summary block. |
| `api/test/scheduler.foundation.test.js` | Adds scheduler contract tests (dedupe/replace/cancel/retry/hardened fallback/adoption). | No | Test-only coverage. | Remove file. |
| `api/test/controlPlane.server.test.js` | Adds config and auth-status assertions for scheduler visibility defaults. | No | Test-only verification of safe defaults. | Revert new assertions. |
| `docs/premium-upgrade/14-scheduler-hardening/PLAN.md` | Documents phase goals, safety rationale, and deferrals. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/14-scheduler-hardening/ADAPTER_MODEL.md` | Documents scheduler adapter/backend selector model. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/14-scheduler-hardening/ADOPTION_SCOPE.md` | Documents adopted and deferred migration scope. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/14-scheduler-hardening/RETRY_AND_DEDUPE_MODEL.md` | Documents job identity, dedupe/cancel/replace/retry semantics. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/14-scheduler-hardening/CHANGE_LOG.md` | Phase file-level change/safety/rollback record. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/14-scheduler-hardening/FINAL_STATUS.md` | Records execution status and readiness for next phase. | No | Documentation only. | Delete file. |
