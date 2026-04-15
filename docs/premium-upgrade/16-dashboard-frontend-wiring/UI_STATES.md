# UI States (16)

## Loading
- Trigger: initial auth bootstrap, guild switch, protected snapshot reload.
- UI: loading card with phase detail (`auth` vs `protected` load).
- Behavior: no protected writes enabled while loading.

## Unauthenticated
- Trigger: `auth.status.authenticated === false` or protected `401`.
- UI: clear unauthenticated card with `DISCORD LOGIN` action.
- Behavior: login redirects to `GET /api/auth/login`; protected polling is not started.

## Authenticated
- Trigger: auth bootstrap succeeds and protected snapshot load succeeds.
- UI:
  - authenticated user summary
  - plan summary
  - capability summary
  - preferences read/write card
  - status-command read/write card
- Behavior: guild selector available when multiple guilds exist.

## No Guild Access
- Trigger: protected calls return `403 guild_access_denied`.
- UI: no-access card with reason code detail + refresh actions.
- Behavior: write controls are not shown; user can retry auth/protected load.

## Auth Unavailable
- Trigger: auth disabled/not configured (`503 auth_disabled` or `503 auth_not_configured`, or status indicates not configured).
- UI: auth-unavailable card with reason code.
- Behavior: no protected requests are attempted until manual refresh.

## Premium Capability Available / Unavailable
- Source: preferences capabilities (`advancedDashboardPreferences`) with fallback to feature context capability matrix.
- Available UI: advanced layout mode selector enabled (`none/focus/split`).
- Unavailable UI: selector disabled; reason and required plan shown in capability summary.

## Save Success / Failure
- Preferences save:
  - Success: local state updates from backend response + success message/toast.
  - Failure: save message/toast shows normalized error; `401/403/503` additionally transition UI state safely.
- Status-command save:
  - Success: effective detail mode refreshes from backend response + success message/toast.
  - Failure: normalized error shown; auth/access failures fail closed.
