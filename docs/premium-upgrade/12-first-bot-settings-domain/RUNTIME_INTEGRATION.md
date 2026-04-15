# Runtime Integration

## Where the bot reads the setting
- Command runtime read point:
  - `api/src/bot/commands/durum.js`
  - `run(ctx)` now resolves guild detail mode via:
    - `resolveStatusCommandRuntimeMode({ guildId })`
    - repository source: `api/src/controlPlane/botSettingsRepository.js`

## Exact runtime surface change
- Only `.durum` embed description formatting is affected:
  - `legacy` (default/fallback): keeps existing 4-line output
    - RAM, CPU, Ping, Uptime
  - `compact` (explicitly configured): shows only
    - Ping, Uptime
- Permission checks, command routing, deletion behavior, and error handling remain unchanged.

## What remains unchanged
- No moderation, reaction, private-room, jail/mute/ban, or permission logic changed.
- No new destructive bot actions are writable.
- Existing command defaults remain unchanged when setting is absent.
- Control-plane disabled mode still returns legacy `ok` health behavior.

## Why this is low-risk
- Integration scope is a single informational command.
- Setting values are bounded and normalized to a tiny enum/fallback.
- Failure to read settings fails closed to `legacy` presentation.
- Mutation writes are gated by existing auth + guild access + validation + audit seams.

## Rollback/fallback behavior
- Route rollback: remove `bot-settings/status-command` route wiring.
- Runtime rollback: remove `.durum` detail-mode read and always use legacy formatter.
- Data rollback: ignore/clear repository records; runtime still safely falls back to legacy.
