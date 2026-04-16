# Dashboard Control Roadmap

This roadmap is based on current runtime behavior and keeps existing bot behavior as the source of truth.

## Guiding Rules
- Prefer read-only visibility before write controls.
- Reuse existing validation and permission logic from backend domains.
- Do not introduce direct moderation-action endpoints early (`ban`, `kick`, `mute` actions from panel).
- Migrate static-config-backed settings in phases, because static currently overrides runtime for same keys.

## Recommended Pages (Ordered)

| Order | Page | Why now | Primary controls | Proposed endpoints | Storage need | Runtime integration | Initial risk class |
|---|---|---|---|---|---|---|---|
| 1 | Setup Readiness | Fastest safe value; no mutations required | Missing/invalid channels, roles, categories, static config health, startup voice readiness | `GET /api/dashboard/protected/setup-readiness` | None required for read-only | Reuse `validateStaticConfig` checks in provider-safe format | `SAFE_NOW` |
| 2 | Command Management | Extends existing `.durum` success pattern | Per-command status, policy visibility, action bucket map, `.durum` control, static policy read view | `GET /api/dashboard/protected/commands/catalog`, `GET /api/dashboard/protected/commands/policy` | None for read-only; later persistent policy overlay | Read from static settings + botSettings repo | `SAFE_NOW` for read-only |
| 3 | Startup Voice | Existing runtime service already robust | Show configured startup channel, channel existence/type, permission readiness, last join status | `GET /api/dashboard/protected/startup-voice/status` | Optional status cache table later | Read from `getStartupVoiceConfig` + voice status | `SAFE_READ_ONLY_FIRST` |
| 4 | Private Rooms | Existing production feature with many moving parts | Feature enabled flag, hub channel, required role, category, active rooms, panel health | `GET /api/dashboard/protected/private-rooms/overview` | None for read-only; later guild config overlay | Read static config + `private_voice_rooms` | `SAFE_READ_ONLY_FIRST` |
| 5 | Logs and Audit | Data already exists in DB tables | Moderation logs, private room logs, reaction rule logs, mutation audit stream | `GET /api/dashboard/protected/logs/moderation`, `.../logs/private-rooms`, `.../logs/reactions`, `.../logs/mutations` | Optional persisted mutation audit table (current is in-memory) | Read from existing repositories/tables | `SAFE_READ_ONLY_FIRST` |
| 6 | Moderation Settings | High-value config, high impact | `warn/mute/kick/jail/ban/lock` policy fields, protected role/user lists, staff hierarchy roles | `GET /api/dashboard/protected/moderation/settings`, later `PUT` | Requires persistent guild settings store | Must integrate with permissionService + static precedence rules | `NEEDS_GUARDRAILS` |
| 7 | Role/Reactions | Feature exists but role changes are sensitive | Rule list, health diagnostics, only-once/cooldown states, eventually guarded CRUD | `GET /api/dashboard/protected/reaction-rules`, later guarded `POST/PUT/DELETE` | Existing reaction tables are ready | Must keep role safety checks identical to service | `SAFE_READ_ONLY_FIRST` -> `NEEDS_GUARDRAILS` |
| 8 | Tag Role | Existing static config feature | Enabled, role configured, tag text, last sync result summary | `GET /api/dashboard/protected/tag-role/status`, later guarded `PUT` | Needs guild settings persistence for writes | Integrate with `getTagRoleConfig` and sync diagnostics | `SAFE_READ_ONLY_FIRST` |
| 9 | Premium and Capabilities | Partly real already | Capability matrix by page/control, locked CTA behavior, plan diagnostics | Extend `GET /api/dashboard/context/features` payload | None required | Reuse feature gate evaluator | `SAFE_NOW` |

## Control-Level Risk Classification

### `SAFE_NOW`
- Setup readiness diagnostics (missing role/channel/category/emoji checks).
- Read-only command catalog and effective command policy view.
- Read-only startup voice status and readiness checks.
- Read-only private room overview (counts + config status only).
- Read-only logs pages for existing tables.
- Premium/capability matrix rendering from existing feature-gate payload.

### `SAFE_READ_ONLY_FIRST`
- Moderation policy settings UI for destructive commands (`ban`, `kick`, `jail`, `mute`, `lock`) as read-only first.
- Reaction rule management as read-only health + list before any write.
- Tag role configuration visibility before enabling edits.
- Startup voice channel edit controls.
- Private room config writes (`hub`, `requiredRole`, `category`).

### `NEEDS_GUARDRAILS`
- Any write for moderation policy (`*_enabled`, `*_limit`, `*_safe_list`, role keys).
- Any write for `staff_hierarchy_roles`, `hard_protected_roles`, `hard_protected_users`.
- Any reaction rule CRUD write endpoint (role assignment side effects).
- Any write changing prefix or lock policy behavior.
- Any write that can create invalid runtime config if channel/role disappears.

### `RISKY_DEFER`
- Dashboard endpoints that execute immediate punishments (ban/kick/mute/jail/unban/unjail).
- Bulk destructive moderation operations (mass unban, mass role remove, etc.).
- Direct overwrite-management endpoints for arbitrary channels outside existing lock helper workflow.
- Unscoped global env/infra controls from dashboard (token, DB, OAuth secrets, CORS, scheduler provider).

## API Surface to Add (Recommended Order)

1. Read-only first batch:
- `GET /api/dashboard/protected/setup-readiness`
- `GET /api/dashboard/protected/commands/catalog`
- `GET /api/dashboard/protected/commands/policy`
- `GET /api/dashboard/protected/startup-voice/status`
- `GET /api/dashboard/protected/private-rooms/overview`
- `GET /api/dashboard/protected/logs/moderation`

2. Later guarded write batch:
- `PUT /api/dashboard/protected/moderation/settings`
- `PUT /api/dashboard/protected/private-rooms/settings`
- `PUT /api/dashboard/protected/startup-voice/settings`
- `PUT /api/dashboard/protected/tag-role/settings`

## Backend Storage Roadmap

Current limitation:
- Dashboard mutable repos for preferences and bot command settings are in-memory only.

Recommended persistence additions:
- `dashboard_preferences` table (actor+guild scoped) to replace in-memory preference repository.
- `dashboard_bot_settings` table (guild scoped) to replace in-memory bot settings repository.
- `guild_runtime_settings` (or equivalent) for dashboard-managed guild policy values.
  - Include `revision`, `updated_by`, `updated_at`.
  - Keep explicit key whitelist aligned with static setting keys being migrated.
- Optional `dashboard_mutation_audit` table if long-term mutation history is needed.

## Runtime Integration Requirements

- Preserve current behavior while read-only pages ship.
- For write phases, address precedence explicitly:
  - Current `buildAuthoritativeSettings` applies static over runtime for overlapping keys.
  - Migration must define clear precedence or split keyspaces to avoid silent no-op writes.
- Reuse existing safety primitives:
  - `permissionService` checks.
  - `validateStaticConfig` channel/role/category validation rules.
  - mutation pipeline (`mutationPipeline`, origin guard, audit).

