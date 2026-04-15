# API Surface (Read-Only Foundation)

## Activation
- Flag: `ENABLE_CONTROL_PLANE_API`
- Default: disabled (`false`)
- Disabled mode behavior: listener keeps legacy plain-text health response behavior (`200 ok`) for all paths.

## Endpoints

### `GET /health`
- Purpose: preserve health probe compatibility.
- Response:
```json
ok
```
- Content type: `text/plain; charset=utf-8`
- Notes: unchanged health semantics are preserved.

### `GET /api/meta/runtime`
- Purpose: safe runtime snapshot for observability/control-plane basics.
- Example response:
```json
{
  "ok": true,
  "data": {
    "mode": "read_only",
    "controlPlaneEnabled": true,
    "nodeEnv": "production",
    "startupPhase": "startup_completed",
    "discordGatewayReady": true,
    "process": {
      "pid": 12345,
      "uptimeSec": 102.443,
      "startedAt": "2026-04-10T12:00:00.000Z"
    },
    "now": "2026-04-10T12:01:42.120Z"
  }
}
```

### `GET /api/meta/capabilities`
- Purpose: advertise current read-only boundary and deferred areas.
- Example response:
```json
{
  "ok": true,
  "data": {
    "mode": "read_only",
    "controlPlaneEnabled": true,
    "authRequired": false,
    "mutableRoutesEnabled": false,
    "endpoints": [
      "GET /health",
      "GET /api/meta/runtime",
      "GET /api/meta/capabilities",
      "GET /api/meta/config-summary"
    ],
    "excludedUntilNextPhase": [
      "session_auth",
      "dashboard_mutation_routes",
      "moderation_action_routes"
    ]
  }
}
```

### `GET /api/meta/config-summary`
- Purpose: safe non-secret config summary for diagnostics and compatibility checks.
- Example response:
```json
{
  "ok": true,
  "data": {
    "nodeEnv": "production",
    "logging": { "format": "text" },
    "network": { "trustProxy": false },
    "controlPlane": { "enabled": true, "readOnly": true },
    "discord": {
      "tokenConfigured": true,
      "targetGuildConfigured": true,
      "startupVoiceChannelConfigured": false
    },
    "database": {
      "hasDatabaseUrl": true,
      "hasDiscreteCredentials": false,
      "sslEnabled": true
    },
    "staticConfig": { "configuredGuildCount": 1 },
    "rateLimit": { "windowMs": 10000, "authMax": 40, "apiMax": 120 },
    "cache": { "maxKeys": 10000, "pruneTick": 500 }
  }
}
```

## Method/route behavior
- Unknown `/api/*` route: `404` JSON (`not_found`).
- Unsupported method on known `/api/*` route: `405` JSON (`method_not_allowed`).
- Non-`/api/*` paths continue to return health `200 ok` when enabled.

## Intentionally excluded
- Tokens, DB passwords, raw env values, hostnames, URLs with credentials.
- Guild/member/user personal data payloads.
- Moderation logs, case data, and privileged action/state surfaces.
- Any write/mutation endpoints.

## Future dashboard areas this can support
- Runtime status panel bootstrapping.
- Capability negotiation/version checks in UI.
- Safe config readiness/preflight cards.
- Future authenticated route groups (session/settings/reaction CRUD) without rewriting startup flow.
