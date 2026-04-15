# API Contract (Dashboard Read-Only Layer)

## Activation
- Controlled by `ENABLE_CONTROL_PLANE_API`.
- Default (`false`): existing behavior preserved (`200 ok` plain-text health behavior for all requests to this listener).
- Enabled (`true`): `/api/meta/*` and `/api/dashboard/*` read-only JSON routes are available.

## Common response envelope
- Success:
```json
{
  "ok": true,
  "data": {}
}
```
- Route/method errors:
```json
{
  "ok": false,
  "error": "not_found",
  "details": null
}
```

## Endpoints

### `GET /api/dashboard/overview`
- Purpose: runtime overview + guild scope summary.
- Example:
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "mode": "read_only",
    "runtime": {
      "nodeEnv": "production",
      "startupPhase": "startup_completed",
      "discordGatewayReady": true,
      "controlPlaneEnabled": true
    },
    "guildScope": {
      "mode": "single_guild",
      "valid": true,
      "reasonCode": null,
      "guildId": "1471242450386550835",
      "requestedGuildId": null,
      "hasAuthoritativeGuild": true,
      "configuredStaticGuildCount": 1,
      "hasConfiguredStaticGuild": true
    },
    "now": "2026-04-10T13:00:00.000Z"
  }
}
```

### `GET /api/dashboard/guild`
- Purpose: safe guild-level contract summary (no member/private payloads).
- Optional query: `guildId` (validated and scope-checked).
- Example:
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "guildScope": {
      "mode": "single_guild",
      "valid": true,
      "reasonCode": null,
      "guildId": "1471242450386550835",
      "requestedGuildId": null,
      "hasAuthoritativeGuild": true,
      "configuredStaticGuildCount": 1,
      "hasConfiguredStaticGuild": true
    },
    "guild": {
      "id": "1471242450386550835",
      "prefix": ".",
      "hasExplicitStaticConfig": true,
      "startupVoiceChannelConfigured": false,
      "bindingCounts": {
        "roles": 2,
        "channels": 3,
        "categories": 1,
        "emojiGroups": 1,
        "emojis": 10
      }
    }
  }
}
```

### `GET /api/dashboard/features`
- Purpose: high-level feature/status summary for dashboard cards.
- Example:
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "guildScope": {
      "mode": "single_guild",
      "valid": true,
      "reasonCode": null,
      "guildId": "1471242450386550835",
      "requestedGuildId": null,
      "hasAuthoritativeGuild": true,
      "configuredStaticGuildCount": 1,
      "hasConfiguredStaticGuild": true
    },
    "features": {
      "moderation": {
        "logEnabled": true,
        "warnEnabled": true,
        "muteEnabled": true,
        "kickEnabled": true,
        "jailEnabled": true,
        "banEnabled": true,
        "lockEnabled": false
      },
      "tagRole": {
        "enabled": true,
        "roleConfigured": true,
        "tagTextConfigured": true
      },
      "privateVoice": {
        "enabled": true,
        "hubChannelConfigured": true,
        "requiredRoleConfigured": true,
        "categoryConfigured": false
      },
      "startupVoiceAutoJoin": {
        "channelConfigured": false
      },
      "controlPlane": {
        "enabled": true,
        "readOnly": true
      }
    }
  }
}
```

### `GET /api/dashboard/resources`
- Purpose: safe resource/config/infrastructure summaries for dashboard diagnostics.
- Example:
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "guildScope": {
      "mode": "single_guild",
      "valid": true,
      "reasonCode": null,
      "guildId": "1471242450386550835",
      "requestedGuildId": null,
      "hasAuthoritativeGuild": true,
      "configuredStaticGuildCount": 1,
      "hasConfiguredStaticGuild": true
    },
    "resources": {
      "staticConfig": {
        "configuredGuildCount": 1,
        "selectedGuildHasExplicitConfig": true
      },
      "bindings": {
        "roleCount": 2,
        "channelCount": 3,
        "categoryCount": 1,
        "emojiGroupCount": 1,
        "emojiCount": 10
      },
      "roleConfiguration": {
        "lockRoleConfigured": false,
        "tagRoleConfigured": true,
        "mutePenaltyRoleConfigured": true,
        "jailPenaltyRoleConfigured": true,
        "privateVoiceRequiredRoleConfigured": true
      },
      "protectedEntityCounts": {
        "hardProtectedRoles": 0,
        "hardProtectedUsers": 0,
        "staffHierarchyRoles": 2
      },
      "infrastructure": {
        "databaseConfigured": true,
        "databaseSslEnabled": true,
        "cacheMaxKeys": 10000,
        "rateLimitWindowMs": 10000
      }
    }
  }
}
```

## Error and empty-state behavior
- Unknown `/api/*` route: `404` JSON (`error: "not_found"`).
- Unsupported method on known route: `405` JSON (`error: "method_not_allowed"`).
- Missing guild context: returns bounded `guildScope.mode = "unscoped"` and `guild = null` where relevant (safe, non-throwing).
- Invalid `guildId` query: returns success envelope with `guildScope.valid = false` and `reasonCode = "invalid_guild_id"`.
- Scope mismatch (`guildId` differs from authoritative single-guild): returns bounded scope with `guildScope.valid = false` and `reasonCode = "guild_scope_mismatch"`.

## Explicitly excluded fields
- Discord token, DB password, raw `DATABASE_URL`, raw env values.
- User/member lists, moderation logs/cases, private-room internals, privileged action data.
- Any mutation payloads.

## Future auth wrapping notes
- Routes are grouped by dashboard provider boundaries and can be wrapped later by auth/session middleware.
- Current public-read mode is intentional for foundation only; no guarantee these remain public in future phases.
