# First Premium-Gated Feature Plan

## What first premium-gated feature was added
- Added the first real plan-enforced premium behavior on a low-risk control-plane preference field:
  - `preferences.advancedLayoutMode` (`focus | split | null`)
- Reused existing protected preferences write seam:
  - `GET /api/dashboard/protected/preferences`
  - `PUT /api/dashboard/protected/preferences`
- Enforcement uses the centralized capability model:
  - capability key: `advanced_dashboard_preferences`
  - required plan: `pro` or higher

## Why this is the safest next step
- The gated field is dashboard-local and harmless; no moderation/reaction/private-room state is mutated.
- Existing free/default basic preferences are unchanged (`defaultView`, `compactMode`, `dismissedNoticeIds`).
- Auth and guild-access boundaries remain mandatory for read/write access.
- Ambiguous entitlement states fail closed for advanced fields.

## What was intentionally deferred
- Real billing providers, payment webhooks, and external entitlement sync.
- Premium gating for dangerous bot mutation domains.
- Any broad bot runtime refactor.
- Frontend rollout dependency beyond stable API contract visibility.

## How this validates premium foundation safely
- Confirms end-to-end capability enforcement in a real write path.
- Confirms free vs premium behavior differences are explicit and testable.
- Confirms ambiguous entitlement handling is safe (`deny advanced`, keep basic route behavior stable).
- Provides a reusable enforcement pattern for future premium-gated routes.
