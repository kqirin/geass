# 19 - Log System Read-Only Plan

## Goal
Replace the `Log Sistemi` placeholder cards with real read-only dashboard views backed by existing protected API contracts.

## Scope
- Backend:
  - `GET /api/dashboard/protected/logs/moderation`
  - `GET /api/dashboard/protected/logs/commands`
  - `GET /api/dashboard/protected/logs/system`
- Dashboard:
  - real `Log Sistemi` section with three categories:
    - `Moderasyon Loglari`
    - `Komut Loglari`
    - `Sistem Olaylari`
  - loading / error / unavailable / empty / ready states
- Tests:
  - backend auth/access/contract/limit/read-only coverage
  - dashboard log-state and section wiring coverage
- Docs:
  - plan, contract, final status

## Out Of Scope
- No OAuth/auth handoff changes
- No bearer/CORS/cookie flow changes
- No runtime moderation/private-room/reaction-role behavior changes
- No write controls in log dashboard UI
- No `.durum` settings behavior changes
- No setup-readiness behavior changes
- No required schema changes

## Implementation Notes
1. Add protected read-only log providers using existing boundary checks (`requireAuth` + guild access).
2. Use existing moderation source (`mod_logs`) for moderation category.
3. If command/system source is missing, return stable `available=false` payload without failing the whole dashboard.
4. Enforce safe query limits (`default=25`, `max=50`) and optional cursor.
5. Keep response shape stable (`contractVersion`, `guildId`, `available`, `items`, `pagination`, `reasonCode`).
6. Update dashboard to consume all three log endpoints in protected snapshot with per-category error isolation.

## Deliverables
- New protected read-only log endpoints
- Log repository/provider wiring
- Dashboard log section implementation
- Backend + dashboard tests
- Documentation under `docs/premium-upgrade/19-log-system-readonly/`
