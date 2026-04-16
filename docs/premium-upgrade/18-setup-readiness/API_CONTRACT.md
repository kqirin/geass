# Setup Readiness API Contract

## Endpoint
- Method: `GET`
- Path: `/api/dashboard/protected/setup-readiness`
- Auth: required (`Bearer` or authenticated session)
- Scope: required guild access (same boundary as other protected dashboard routes)

## Query
- `guildId` (optional when authoritative single-guild scope exists)

## Response Envelope
The control-plane response envelope remains unchanged:

```json
{
  "ok": true,
  "data": { ... }
}
```

## Data Contract (`data`)

```json
{
  "contractVersion": 1,
  "guildId": "...",
  "summary": {
    "status": "ready | warning | incomplete",
    "score": 0,
    "totalChecks": 0,
    "passedChecks": 0,
    "warningChecks": 0,
    "failedChecks": 0
  },
  "sections": [
    {
      "id": "static-config",
      "title": "Statik Yapilandirma",
      "status": "ready | warning | incomplete",
      "checks": []
    }
  ],
  "issues": [
    {
      "severity": "info | warning | error",
      "reasonCode": "...",
      "title": "...",
      "description": "...",
      "targetType": "role | channel | category | config | permission",
      "targetKey": "..."
    }
  ]
}
```

## Section IDs
- `static-config`
- `private-room`
- `startup-voice`
- `moderation-roles`
- `tag-role`
- `command-policy`

## Error Behavior
- `401 unauthenticated` when auth principal is missing
- `403 guild_access_denied` when guild access fails
- Standard control-plane error envelope retained

## Read-Only Guarantee
- No mutation pipeline usage
- No write repository calls
- No runtime/destructive bot actions
