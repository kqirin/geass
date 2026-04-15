# Baseline Summary (Behavior Freeze)

## Current architecture summary
- `api` is a Node.js CommonJS Discord runtime centered on [`api/src/index.js`](../../../api/src/index.js).
- Core startup wiring composes: PostgreSQL (`database.js`), Discord gateway client (`discordClient.js`), moderation command system, timed penalty scheduler, reaction action service, private room service, tag-role feature, bot presence manager, diagnostics, and retry wrappers.
- Static configuration is code-defined under [`api/src/config/static/*`](../../../api/src/config/static) and merged as authoritative settings at runtime.
- Persistence is PostgreSQL-first with runtime/audit tables created/validated in [`api/src/postgresSchema.js`](../../../api/src/postgresSchema.js).
- `dashboard` is a Vite React SPA (`dashboard/src/main.jsx`) that consumes `/api/*` endpoints via Axios (`useDashboardData.js`, `apiClient.js`).

## Entrypoints
- Bot runtime: [`api/src/index.js`](../../../api/src/index.js) (`npm run start` in `api`).
- Schema bootstrap/migrations: [`api/src/migrations.js`](../../../api/src/migrations.js) -> [`api/src/postgresSchema.js`](../../../api/src/postgresSchema.js) (`npm run migrate`).
- Dashboard runtime: [`dashboard/src/main.jsx`](../../../dashboard/src/main.jsx), [`dashboard/src/App.jsx`](../../../dashboard/src/App.jsx).
- CI entry: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).

## Major feature domains
- Prefix moderation command pipeline (`warn/mute/unmute/kick/jail/unjail/ban/unban/log/lock/unlock/embed/durum/yardim`).
- Permission and hierarchy safety (`permissionService`, native role/Discord permission checks, rate-limit/abuse controls).
- Timed penalties + jail role snapshot restore (`penaltyScheduler`).
- Reaction automation rules (DB-backed rule engine + execution logs + only-once state).
- Private voice room lifecycle (hub-triggered create, ownership controls, lock/hide/permit/reject, inactivity cleanup).
- Tag-role auto-sync.
- Startup voice auto-join + voice connection state manager.
- Template-driven user messaging and DM notifications.

## Current runtime model
- Single-process runtime with PostgreSQL advisory lock (`auri_discord_gateway_lock`) to keep one active gateway instance.
- In-memory caches/locks are heavily used for correctness and throttling (rate limits, mutation locks, rule caches, room caches, queue state).
- Startup is gated/retried in phases: config validate -> DB migration -> client/service build -> advisory lock -> Discord login -> static config validate -> feature bootstraps.
- Shutdown path is explicit on `SIGINT`, `SIGTERM`, `unhandledRejection`, `uncaughtException`: health server close, schedulers stop, Discord destroy, lock release, DB pool close, process exit.
- Optional health HTTP listener (`PORT`) returns plain `ok`.

## Current strengths worth preserving
- Strong startup/shutdown discipline and retry logic for transient failures.
- Authoritative moderation verification patterns (ban/unban and timeout verification) reduce false success.
- Explicit mutation locking in high-contention flows (moderation targets, guild bans, channels, private rooms, voice ops).
- Durable persistence coverage for critical state (penalties, reaction rules, room state, lock snapshots, audit logs).
- Broad automated test surface (245 API tests discovered by node test runner, 9 dashboard tests).

## Known weak areas
- API test baseline is not green (226 pass / 19 fail), so current behavior and tests are out of sync in multiple moderation areas.
- Dashboard expects broad `/api/*` backend surface, but no matching HTTP route implementation was detected under scanned `api/src` runtime.
- Private room service is large and stateful; behavior is correct in tests but structurally high-risk to refactor.
- Many safety controls are process-local (in-memory). Horizontal/distributed migration is non-trivial.
- CI does not currently execute `dashboard` tests (`dashboard` job builds/lints only).

## Safest migration philosophy for this repo
1. Freeze current behavior with explicit contracts and regression tests before any premium feature work.
2. Keep changes single-domain and adapter-first (wrap old paths before replacing internals).
3. Require green baseline tests plus targeted contract checks before every phase advance.
4. Avoid distributed-state changes until deterministic fallback paths exist.
5. Treat dashboard/backend API contract as a first-class compatibility boundary; never change one side alone.
