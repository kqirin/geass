# Bot Status Settings Contract

## Endpoints
- `GET /api/dashboard/protected/bot-settings/status-command`
- `PUT /api/dashboard/protected/bot-settings/status-command`

## Access requirements
- Both endpoints require authenticated principal (`requireAuth`).
- Both endpoints require resolved guild access (`requireGuildAccess`).
- If auth is disabled/unconfigured, requests fail closed (`503`).
- If unauthenticated, requests fail closed (`401`).
- If guild access is missing/invalid, requests fail closed (`403`).

## Request schema (`PUT`)
- Headers:
  - `Content-Type: application/json`
- Body:
```json
{
  "settings": {
    "detailMode": "compact | legacy | null"
  }
}
```
- Notes:
  - `detailMode: "compact"` enables compact `.durum` presentation.
  - `detailMode: "legacy"` is normalized to `null` (explicit fallback clear).
  - `detailMode: null` keeps legacy fallback behavior.

## Response schema (`GET`)
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "mode": "protected_bot_status_settings",
    "domain": "status_command",
    "requestId": "cp_...",
    "scope": {
      "actorId": "123...",
      "guildId": "999..."
    },
    "settings": {
      "detailMode": null
    },
    "effective": {
      "detailMode": "legacy"
    },
    "updatedAt": null
  }
}
```

## Response schema (`PUT` success)
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "mode": "protected_bot_status_settings",
    "domain": "status_command",
    "requestId": "cp_...",
    "scope": {
      "actorId": "123...",
      "guildId": "999..."
    },
    "settings": {
      "detailMode": "compact"
    },
    "effective": {
      "detailMode": "compact"
    },
    "updatedAt": "2026-04-11T...",
    "mutation": {
      "type": "bot_status_settings_upsert",
      "applied": true,
      "duplicate": false
    }
  }
}
```

## Defaults and fallback behavior
- No stored record -> `settings.detailMode = null`, `effective.detailMode = "legacy"`.
- Runtime fallback is always legacy when unset/unreadable.
- Legacy behavior is unchanged unless explicitly configured to `compact`.

## Validation behavior
- `settings` is required and must be an object.
- Unknown root/settings fields are rejected.
- At least one mutable settings field must be provided.
- `detailMode` type must be `string` or `null`.
- Body size is bounded (`2 KiB`, `413 payload_too_large` on overflow).
- Non-JSON mutation request content type is rejected (`415 unsupported_media_type`).

## Excluded fields
- No tokens/session secrets/raw OAuth payloads are accepted.
- No moderation/reaction/private-room/punishment action fields are accepted.
- No permission bitfields or raw guild OAuth permission values are exposed in this contract.
