# Change Log (03 - Control-Plane Foundation)

| File | Purpose | Runtime behavior change when flag is OFF | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/config.js` | Added `controlPlane.enabled` parsed from `ENABLE_CONTROL_PLANE_API`. | No | Default is `false`; no code path activates unless explicitly enabled. | Remove one config block. |
| `api/src/controlPlane/router.js` | Added minimal internal route registry and path normalization. | No | New isolated module; only used by new handler. | Delete file and imports. |
| `api/src/controlPlane/metaProviders.js` | Added read-only runtime/capabilities/config-summary providers with safe fields only. | No | No write operations, no secret/raw env emission. | Delete file and imports. |
| `api/src/controlPlane/server.js` | Added flag-gated request handler: legacy health behavior + `/api/meta/*` routes when enabled. | No | Disabled path is strict legacy health response; enabled path is read-only only. | Delete file and revert handler wiring. |
| `api/src/index.js` | Replaced inline health handler with `createControlPlaneRequestHandler(...)` while keeping existing listener lifecycle. | No | `PORT` start/shutdown flow unchanged; legacy response preserved in disabled mode. | Revert this file to inline handler. |
| `api/test/controlPlane.server.test.js` | Added tests for disabled compatibility, enabled endpoints, shape checks, and secret non-leak expectations. | No | Test-only coverage; no runtime mutation. | Delete test file. |
| `docs/premium-upgrade/03-control-plane-foundation/PLAN.md` | Documents rationale/scope and intentionally excluded work. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/03-control-plane-foundation/API_SURFACE.md` | Documents read-only endpoint contract and exclusions. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/03-control-plane-foundation/CHANGE_LOG.md` | Records safety/rollback notes per changed file. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/03-control-plane-foundation/FINAL_STATUS.md` | Records verification outcomes and go/no-go result. | No | Documentation only. | Delete file. |
