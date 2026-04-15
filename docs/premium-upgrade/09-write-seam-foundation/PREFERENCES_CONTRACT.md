# Preferences Contract

## Endpoints
- `GET /api/dashboard/protected/preferences`
- `PUT /api/dashboard/protected/preferences`

## Access requirements
- Both endpoints require authenticated principal.
- Both endpoints require guild access resolution for the active dashboard guild scope.
- If auth is disabled/unconfigured, requests fail closed (`503`).
- If principal is missing, requests fail closed (`401`).
- If guild access is missing, requests fail closed (`403`).

## Request schema (`PUT`)
- Headers:
  - `Content-Type: application/json`
- Body:
```json
{
  "preferences": {
    "defaultView": "overview | guild | features | resources | protected_overview",
    "compactMode": true,
    "dismissedNoticeIds": ["notice_id_1", "notice_id_2"]
  }
}
```
- Validation rules:
  - `preferences` is required.
  - Unknown top-level or preference fields are rejected.
  - At least one mutable preference field must be provided.
  - `dismissedNoticeIds` must be an array of bounded safe strings.
  - Payload size is bounded (413 on overflow).

## Response schema (`GET`)
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "mode": "protected_preferences",
    "requestId": "cp_...",
    "scope": {
      "actorId": "123...",
      "guildId": "999..."
    },
    "preferences": {
      "defaultView": "overview",
      "compactMode": false,
      "dismissedNoticeIds": []
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
    "mode": "protected_preferences",
    "requestId": "cp_...",
    "scope": {
      "actorId": "123...",
      "guildId": "999..."
    },
    "preferences": {
      "defaultView": "resources",
      "compactMode": true,
      "dismissedNoticeIds": ["welcome-banner"]
    },
    "updatedAt": "2026-04-11T...",
    "mutation": {
      "type": "dashboard_preferences_upsert",
      "applied": true,
      "duplicate": false
    }
  }
}
```

## Validation/error behavior
- `400 invalid_request_body`: schema/type/unknown-field/empty-mutation failures
- `413 payload_too_large`: body size exceeds limit
- `415 unsupported_media_type`: missing/invalid JSON content type
- `401 unauthenticated`: principal missing
- `403 guild_access_denied`: guild access unresolved/denied
- `503 auth_disabled` or `503 auth_not_configured`: auth boundary not available

## Explicitly excluded fields
- OAuth access tokens/refresh tokens
- Session cookie values/raw session secrets
- Discord permission bitfields from OAuth guild payload
- Any moderation/reaction/private-room/penalty mutable state
