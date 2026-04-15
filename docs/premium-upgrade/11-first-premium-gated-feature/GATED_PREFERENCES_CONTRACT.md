# Gated Preferences Contract

## Affected endpoints
1. `GET /api/dashboard/protected/preferences`
2. `PUT /api/dashboard/protected/preferences`

## Auth requirement
- Required (`401 unauthenticated` when missing session).

## Guild access requirement
- Required (`403 guild_access_denied` when principal lacks selected guild access).
- Guild scope may be selected with `?guildId=...` in unscoped mode.

## Basic vs advanced preference fields
- Basic (free/default allowed):
  - `defaultView` (`overview | guild | features | resources | protected_overview`)
  - `compactMode` (`boolean`)
  - `dismissedNoticeIds` (`string[]`, max 32, each max 64, sanitized charset)
- Advanced (premium-gated):
  - `advancedLayoutMode` (`focus | split | null`)

## Plan/capability requirement
- `advancedLayoutMode` requires capability:
  - `advanced_dashboard_preferences`
- Free/default plan:
  - write denied for `advancedLayoutMode`
  - read returns `advancedLayoutMode: null`
- Pro/business plan:
  - write allowed for `advancedLayoutMode`
  - read returns stored `advancedLayoutMode` value
- Ambiguous/unresolved entitlement:
  - fail closed for `advancedLayoutMode` writes
  - basic fields remain writable

## Request schema (`PUT`)
```json
{
  "preferences": {
    "defaultView": "overview",
    "compactMode": false,
    "dismissedNoticeIds": ["welcome-banner"],
    "advancedLayoutMode": "focus"
  }
}
```

## Response shape (`GET` and `PUT`)
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
      "dismissedNoticeIds": [],
      "advancedLayoutMode": null
    },
    "updatedAt": "ISO-8601 or null",
    "plan": {
      "status": "resolved | unresolved",
      "tier": "free | pro | business | null",
      "source": "config_default | config_manual_override | repository | unresolved",
      "reasonCode": null
    },
    "capabilities": {
      "advancedDashboardPreferences": {
        "key": "advanced_dashboard_preferences",
        "available": false,
        "requiredPlan": "pro",
        "active": true,
        "gatingMode": "enforced",
        "reasonCode": "plan_upgrade_required | entitlement_unresolved | null"
      }
    },
    "featureGateGeneratedAt": "ISO-8601",
    "mutation": {
      "type": "dashboard_preferences_upsert",
      "applied": true,
      "duplicate": false
    }
  }
}
```

## Denial/failure behavior
- `403 capability_denied` when free/unresolved tries to set `advancedLayoutMode`.
  - `details.reasonCode`:
    - `advanced_dashboard_preferences_plan_required` (free tier)
    - `advanced_dashboard_preferences_unavailable` (unresolved entitlement)
- Other safe validation failures:
  - `400 invalid_request_body`
  - `413 payload_too_large`
  - `415 unsupported_media_type`
  - `503 auth_disabled` / `503 auth_not_configured`

## Excluded/safe boundaries
- No OAuth tokens, session secrets, client secrets, or raw auth payloads in responses.
- No moderation/reaction/private-room or other dangerous bot state writes.
