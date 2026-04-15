# Route Contract (07 - Guild Access Policy)

## New/changed routes

| Route | Method | Auth requirement | Guild access requirement | Success shape | Unauthenticated | Authenticated but no guild access |
|---|---|---|---|---|---|---|
| `/api/auth/guilds` | `GET` | Required (`auth enabled+configured`, valid session) | None | `{ ok:true, data:{ contractVersion, guilds[], summary } }` | `401 unauthenticated` (`503` when auth disabled/unconfigured) | N/A |
| `/api/auth/access` | `GET` | Required | Required for allow result | `{ ok:true, data:{ contractVersion, accessModelVersion, access, guildScope, guild } }` | `401 unauthenticated` (`503` when auth disabled/unconfigured) | `403 guild_access_denied` |
| `/api/dashboard/context` | `GET` | Required | Required | `{ ok:true, data:{ contractVersion, mode, principal, guildScope, access, guild, principalGuilds } }` | `401 unauthenticated` (`503` when auth disabled/unconfigured) | `403 guild_access_denied` |
| `/api/control/private/guild-access` | `GET` | Required | Required | Existing placeholder payload; now includes evaluated `guildScope` with `accessLevel`/reason metadata | `401` or `503` based on auth mode | `403 guild_access_denied` |

## Existing auth route adjustments

### `GET /api/auth/login`
- OAuth scope now requests `identify guilds` so guild membership can be evaluated server-side.

### `GET /api/auth/callback`
- On successful OAuth callback, server hydrates principal with safe guild membership summary before session creation.
- No raw OAuth token/provider payload is returned.

### `GET /api/auth/status`
- Principal summary remains safe and now includes:
  - `guildCount`
  - `operatorGuildCount`

### `GET /api/auth/me`
- Same auth semantics (`503` disabled/unconfigured, `401` unauthenticated, `200` authenticated).
- Principal summary remains safe/non-sensitive.

## Response behavior details

### Unauthenticated
- Auth-required routes return:
  - `503` when auth feature is disabled/unconfigured.
  - `401` when auth is configured but no valid session is present.

### Authenticated, no guild access
- Guild-protected read routes return `403`:
  - `error: "guild_access_denied"`
  - safe `details` with conservative reason codes (`invalid_guild_id`, `guild_scope_mismatch`, `guild_scope_unresolved`, `guild_membership_missing`).

### Authenticated, guild access allowed
- Routes return read-only summaries only:
  - resolved scope
  - access level
  - safe guild summary
  - safe principal summary

## Sensitive fields explicitly excluded
- OAuth access/refresh tokens
- OAuth client secret
- Session signing secret
- Raw OAuth provider payload bodies
- Raw Discord guild permission bitfields in public response payloads
- Raw database credentials or unrelated secrets
