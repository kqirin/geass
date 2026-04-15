# Route Contract

## New endpoint: `GET /api/auth/plan`
- Method: `GET`
- Auth requirement: required
- Guild access requirement: required
- Response shape:
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "accessModelVersion": 1,
    "access": {
      "allowed": true,
      "accessLevel": "authenticated_guild_operator",
      "targetGuildId": "999..."
    },
    "guildScope": {},
    "guild": {},
    "plan": {
      "status": "resolved | unresolved",
      "tier": "free | pro | business | null",
      "source": "config_default | config_manual_override | repository | unresolved",
      "reasonCode": null
    },
    "capabilities": {},
    "capabilitySummary": {},
    "generatedAt": "ISO-8601"
  }
}
```
- Failure modes:
  - `503 auth_disabled`
  - `503 auth_not_configured`
  - `401 unauthenticated`
  - `403 guild_access_denied`

## New endpoint: `GET /api/dashboard/context/features`
- Method: `GET`
- Auth requirement: required
- Guild access requirement: required
- Response shape:
```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "mode": "authenticated_feature_gate_context",
    "requestId": "cp_...",
    "guildScope": {},
    "access": {
      "allowed": true,
      "accessLevel": "authenticated_guild_operator",
      "targetGuildId": "999..."
    },
    "plan": {
      "status": "resolved | unresolved",
      "tier": "free | pro | business | null",
      "source": "config_default | config_manual_override | repository | unresolved",
      "reasonCode": null
    },
    "capabilities": {},
    "capabilitySummary": {},
    "generatedAt": "ISO-8601"
  }
}
```
- Failure modes:
  - `503 auth_disabled`
  - `503 auth_not_configured`
  - `401 unauthenticated`
  - `403 guild_access_denied`

## Changed existing endpoint payloads (additive)
- `GET /api/dashboard/context`
  - Added `featureGate` summary block.
- `GET /api/dashboard/protected/overview`
  - Added `plan` summary and `featureGate.capabilitySummary`.

## Safe included fields
- plan tier/source/status/reason
- capability allow/deny metadata
- capability summary counts
- request/guild scope summaries

## Excluded fields
- OAuth tokens/access tokens/refresh tokens
- raw session cookie values
- client secret/session secret
- raw entitlement provider secrets
