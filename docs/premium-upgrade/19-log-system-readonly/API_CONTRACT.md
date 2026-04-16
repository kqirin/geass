# Log System Read-Only API Contract

## Endpoints
- Method: `GET`
- Auth: required (session or Bearer token)
- Guild access: required (same protected dashboard boundary policy)

### Routes
- `/api/dashboard/protected/logs/moderation`
- `/api/dashboard/protected/logs/commands`
- `/api/dashboard/protected/logs/system`

## Query
- `guildId`: optional when authoritative guild scope already exists
- `limit`: optional, safe-clamped to max `50` (default `25`)
- `cursor`: optional

## Response Envelope
Control-plane envelope remains unchanged:

```json
{
  "ok": true,
  "data": {}
}
```

## Common `data` Shape

```json
{
  "contractVersion": 1,
  "guildId": "...",
  "available": true,
  "items": [],
  "pagination": {
    "limit": 25,
    "nextCursor": null
  },
  "reasonCode": null,
  "explanation": null
}
```

## Category Behavior

### Moderation Logs
- Source: `mod_logs` (when available)
- Safe fields only:
  - `id`
  - `action`
  - `targetUserId`
  - `moderatorUserId`
  - `reason`
  - `createdAt`
  - `expiresAt`
  - `status`
- Returns paginated recent logs for selected guild.

### Command Logs
- If command usage source is unavailable:
  - `available: false`
  - `items: []`
  - `reasonCode: "command_logs_not_available"`
  - `explanation: "Bu log türü için kayıt kaynağı henüz aktif değil."`

### System Logs
- If system/audit source is unavailable:
  - `available: false`
  - `items: []`
  - `reasonCode: "system_logs_not_available"`
  - `explanation: "Bu log türü için kayıt kaynağı henüz aktif değil."`

## Error Behavior
- `401 unauthenticated` when principal is missing
- `403 guild_access_denied` when guild access check fails
- Existing control-plane error envelope stays unchanged

## Read-Only Guarantee
- Only `GET` routes are registered for log system endpoints
- No mutation pipeline usage for log reads
- No write repository operations are invoked by these routes
