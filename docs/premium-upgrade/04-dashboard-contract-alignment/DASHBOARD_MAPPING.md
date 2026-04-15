# Dashboard Mapping (Read-Only Alignment)

## Mapping table

| Dashboard data area | Endpoint | Provider/module | Current support |
|---|---|---|---|
| Runtime status card (startup phase, gateway ready, mode) | `GET /api/dashboard/overview` | `createDashboardOverviewProvider` (`api/src/controlPlane/dashboardProviders.js`) | Supported (safe summary only) |
| Guild identity/scope card | `GET /api/dashboard/guild` | `createDashboardGuildProvider` + `resolveDashboardGuildScope` | Supported (guild-scoped summary, no member data) |
| Feature toggles/status badges | `GET /api/dashboard/features` | `createDashboardFeaturesProvider` | Supported (boolean/configured summaries only) |
| Resource/config diagnostics | `GET /api/dashboard/resources` | `createDashboardResourcesProvider` | Supported (counts/presence only) |
| Contract capability discovery | `GET /api/meta/capabilities` | `createCapabilitiesProvider` | Supported (endpoint list + read-only boundary) |

## Intentionally unsupported in this phase
- Authentication/session/user identity context.
- Write/update flows for settings/reaction rules/presence.
- Detailed moderation records, case history, or user-level disciplinary data.
- Full private-room operational internals.
- Multi-guild data aggregation or privileged guild inspection.
- Frontend integration and request wiring.

## What remains for future authenticated/write phases
1. Add session/auth middleware and protect dashboard route groups.
2. Introduce explicit API contract tests for authenticated route behavior.
3. Add bounded write endpoints (settings/reaction/presence) behind auth and validation.
4. Define audit-safe error semantics and per-route authorization policies.
5. Connect dashboard client hooks to the authenticated contract surface.
