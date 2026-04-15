# First Bot Settings Domain Plan

## What first real bot settings domain was added
- Added a new protected guild-scoped bot settings domain for `.durum` presentation only:
  - `status command detail mode` (`legacy` fallback, optional `compact` override)
- Added protected control-plane endpoints:
  - `GET /api/dashboard/protected/bot-settings/status-command`
  - `PUT /api/dashboard/protected/bot-settings/status-command`
- Added a shared bot settings repository consumed by both:
  - control-plane write/read routes
  - bot runtime command rendering path

## Why this is the safest next step
- The setting affects only output formatting in one informational command.
- No moderation punishments, reaction rules, private-room controls, or permission semantics are writable.
- Default runtime behavior is preserved when setting is absent (`legacy` mode).
- Existing auth, guild access, write validation, and mutation audit seams are reused.

## What was intentionally deferred
- Any write surface for bans/mutes/jails/reaction/private-room flows.
- DB persistence expansion and migration-heavy bot settings store.
- Frontend rollout dependency or broad dashboard refactor.
- Any unrelated infra work (Redis, queues, sharding, slash migration).

## How this proves safe runtime control-plane influence
- Authenticated guild operators can now write a real guild bot setting.
- The bot reads that setting live in `.durum` and changes presentation only.
- Unset setting path remains legacy behavior, proving safe fallback.
- All mutation outcomes are bounded and audited through the existing pipeline.
