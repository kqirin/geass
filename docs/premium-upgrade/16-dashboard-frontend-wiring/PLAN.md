# Dashboard Frontend Wiring Plan (16)

## What frontend wiring was added
- Replaced legacy dashboard auth/session assumptions with control-plane auth contract calls in a centralized client layer:
  - `GET /api/auth/status`
  - `GET /api/auth/me`
  - `GET /api/auth/guilds`
  - `GET /api/auth/plan`
  - `POST /api/auth/logout`
  - `GET /api/dashboard/context/features`
  - `GET /api/dashboard/protected/overview`
  - `GET /api/dashboard/protected/preferences`
  - `PUT /api/dashboard/protected/preferences`
  - `GET /api/dashboard/protected/bot-settings/status-command`
  - `PUT /api/dashboard/protected/bot-settings/status-command`
- Added normalized frontend error handling (`401`/`403`/`503` aware) and explicit dashboard UI states:
  - loading
  - unauthenticated
  - auth unavailable
  - no guild access
  - ready
  - generic error
- Added guarded request sequencing:
  - no protected calls before auth status is resolved
  - protected data load only after authenticated + guild scope selection
- Added low-risk settings wiring already supported by backend contracts:
  - dashboard preferences read/write
  - gated advanced layout mode handling
  - status-command detail mode read/write
- Added focused dashboard contract tests around bootstrap state, protected load, and mutation payloads.

## What was intentionally not redesigned
- No broad visual redesign or design-system migration.
- No bot moderation/reaction/embed write feature expansion.
- No new dangerous write actions.
- No runtime/domain logic changes in bot/backend services.
- Existing shell style was preserved; only small state cards and settings cards were introduced.

## Backend contracts consumed
- Auth/session boundary:
  - `GET /api/auth/status`
  - `GET /api/auth/me`
  - `GET /api/auth/guilds`
  - `GET /api/auth/plan`
  - `POST /api/auth/logout`
  - `GET /api/auth/login` (login redirect URL only)
- Protected dashboard read:
  - `GET /api/dashboard/protected/overview`
  - `GET /api/dashboard/context/features`
- Protected dashboard low-risk write domains:
  - `GET/PUT /api/dashboard/protected/preferences`
  - `GET/PUT /api/dashboard/protected/bot-settings/status-command`

## What remains for deploy/domain/CORS/cookie phase
- Final production cookie attributes and domain topology validation.
- Explicit frontend-origin deployment alignment with `CONTROL_PLANE_PUBLIC_BASE_URL`.
- Reverse-proxy and environment-specific CORS/origin policy validation in real deployment.
- End-to-end browser smoke for OAuth callback and cross-origin cookie behavior in target domains.
- Optional UX hardening pass (copy polish/i18n) after deploy mechanics are locked.
