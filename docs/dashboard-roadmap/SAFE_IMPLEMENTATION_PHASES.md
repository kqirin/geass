# Safe Implementation Phases

All phases are planned to preserve current bot behavior and avoid direct destructive dashboard actions.

## Phase A: Quick Wins / Safe Controls

Goal:
- Ship high-value read-only visibility pages and stabilize existing write controls persistence.

Files likely affected:
- `api/src/controlPlane/dashboardRoutes.js`
- New read-only provider modules under `api/src/controlPlane/` (setup readiness, command catalog)
- `dashboard/src/pages/Dashboard.jsx`
- `dashboard/src/hooks/useDashboardData.js`
- Optional persistence wiring for:
  - `api/src/controlPlane/preferencesRepository.js`
  - `api/src/controlPlane/botSettingsRepository.js`

Endpoints to add:
- `GET /api/dashboard/protected/setup-readiness`
- `GET /api/dashboard/protected/commands/catalog`
- `GET /api/dashboard/protected/commands/policy`

Tests needed:
- Provider unit tests for payload contracts.
- Auth/guild-scope access tests for new protected GET routes.
- Snapshot tests for frontend rendering of read-only cards.

Why safe:
- Mostly read-only surface.
- No moderation action mutations.

Rollback plan:
- Feature-flag hide new sections/routes.
- Keep existing `.durum` and preferences endpoints untouched.

## Phase B: Setup Wizard Foundation

Goal:
- Introduce wizard shell with validation preview and non-destructive draft flow.

Files likely affected:
- `dashboard/src/pages/Dashboard.jsx` (wizard entry and step UI)
- New wizard components/hooks under `dashboard/src/components/Dashboard/`
- `api/src/controlPlane/*` new wizard preview providers
- Validation reuse from `api/src/bootstrap/validateStaticConfig.js`

Endpoints to add:
- `GET /api/dashboard/protected/setup-wizard/initial`
- `POST /api/dashboard/protected/setup-wizard/validate` (dry-run only)

Tests needed:
- Validation payload tests (required keys, channel type checks, role checks).
- Wizard step state tests and draft serialization tests.

Why safe:
- No live config mutation yet.
- Validation-only API surface.

Rollback plan:
- Remove wizard route links; keep backend preview endpoint disabled.

## Phase C: Log System Real Integration

Goal:
- Replace placeholder log page with real read-only DB-backed logs.

Files likely affected:
- New query providers in `api/src/controlPlane/`
- Existing repositories:
  - `api/src/bot/moderation.logs.js`
  - `api/src/infrastructure/repositories/privateVoiceRepository.js`
  - `api/src/infrastructure/repositories/reactionRuleRepository.js`
- `dashboard/src/pages/Dashboard.jsx`

Endpoints to add:
- `GET /api/dashboard/protected/logs/moderation`
- `GET /api/dashboard/protected/logs/private-rooms`
- `GET /api/dashboard/protected/logs/reactions`

Tests needed:
- Pagination and filtering tests.
- Contract tests for empty-state payloads.
- Permission/auth tests.

Why safe:
- Read-only DB access.
- Uses already persisted operational data.

Rollback plan:
- Revert to placeholder UI.
- Disable logs routes without affecting bot runtime.

## Phase D: Private Room Setup

Goal:
- Add guarded config controls for private room setup fields.

Files likely affected:
- `api/src/config/static/index.js` integration strategy
- `api/src/voice/privateRoomService.js` config read path (if precedence changes)
- New settings storage repository (guild runtime settings)
- `dashboard/src/pages/Dashboard.jsx`

Endpoints to add:
- `GET /api/dashboard/protected/private-rooms/settings`
- `PUT /api/dashboard/protected/private-rooms/settings`

Tests needed:
- Validation tests for hub channel/category/required role.
- Runtime smoke tests: room creation still works with previous static config.
- Regression tests for inactivity cleanup and transfer behavior.

Why safe:
- Scope limited to setup parameters, not room-force actions.
- Strong validation can prevent invalid saves.

Rollback plan:
- Keep prior settings revision; restore previous revision on failed rollout.
- Feature flag for write endpoint.

## Phase E: Moderation Settings

Goal:
- Add guarded write controls for command policy settings currently static-driven.

Files likely affected:
- `api/src/config/static/index.js` (authoritative settings merge strategy)
- `api/src/bot/services/permissionService.js` (no logic changes expected, but integration validation needed)
- New moderation settings routes in `api/src/controlPlane/`
- Dashboard moderation + command settings sections

Endpoints to add:
- `GET /api/dashboard/protected/moderation/settings`
- `PUT /api/dashboard/protected/moderation/settings`

Tests needed:
- Policy validation tests per key (`*_enabled`, `*_limit`, `*_safe_list`, role keys).
- End-to-end permission path tests for representative commands.
- Concurrency/optimistic revision tests.

Why safe:
- Does not execute moderation actions directly.
- Reuses existing permission enforcement runtime.

Rollback plan:
- Revert precedence to static-only.
- Restore previous saved settings revision.

## Phase F: Premium-Gated Controls

Goal:
- Map advanced controls to capability gates and make premium page functional.

Files likely affected:
- `api/src/controlPlane/planCapabilities.js`
- `api/src/controlPlane/featureGates.js`
- Route handlers for capability-guarded mutations
- `dashboard/src/pages/Dashboard.jsx` premium section

Endpoints to add:
- No mandatory new endpoint if existing capability context is reused.
- Optional: `GET /api/dashboard/protected/premium/control-matrix`

Tests needed:
- Capability deny/allow route tests (`403 capability_denied`).
- Frontend gating tests by plan tier (`free`, `pro`, `business`).

Why safe:
- Mostly access-control and UX gating around already-scoped controls.

Rollback plan:
- Disable new capability keys.
- Fall back to current static premium placeholder rendering.

