# Control-Plane Foundation Plan

## What was added
- New feature flag: `ENABLE_CONTROL_PLANE_API` (`false` by default) in `api/src/config.js`.
- New internal control-plane module group under `api/src/controlPlane/`:
  - `router.js`: small internal route registry/dispatcher.
  - `metaProviders.js`: read-only runtime/capabilities/config-summary providers.
  - `server.js`: request handler that preserves legacy health behavior and conditionally enables `/api/meta/*`.
- Startup wiring update in `api/src/index.js`:
  - Existing `PORT` listener lifecycle stays in place.
  - Inline health handler replaced with `createControlPlaneRequestHandler(...)`.
  - `Health server` startup/shutdown semantics remain intact.
- New tests in `api/test/controlPlane.server.test.js` for flag behavior, route behavior, response shape, and secret non-leak checks.

## Why this is the safest next step
- Default behavior is preserved because the flag is off unless explicitly enabled.
- New API surface is read-only and intentionally narrow.
- No moderation/reaction/private-room business logic was changed.
- No dependency or architecture migration was introduced.
- Changes are additive and isolated behind a small adapter boundary.

## What was intentionally not changed
- No premium features.
- No dashboard wiring changes.
- No auth/session system.
- No runtime command/event behavior changes.
- No existing health listener lifecycle changes (`PORT` start/close flow kept).
- No data mutation endpoints.

## How this prepares future dashboard/auth work
- Provides a stable, low-risk HTTP entry point for future authenticated routes.
- Establishes a route registry boundary where protected route groups can be added later.
- Introduces safe metadata providers that can be extended without touching Discord runtime flows.
- Keeps compatibility mode intact while enabling incremental control-plane expansion in next phases.
