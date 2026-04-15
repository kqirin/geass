# Protected Overview Contract

## Endpoint
- Path: `/api/dashboard/protected/overview`
- Method: `GET`

## Auth requirement
- Requires control-plane auth enabled and configured.
- Requires valid authenticated session principal.

## Guild access requirement
- Requires resolved target guild access through existing guild policy.
- Denies when scope is invalid/unresolved/mismatched or membership is missing.

## Success response (`200`)
- Wrapper: `{ ok: true, data: { ... } }`
- `data` shape:
  - `contractVersion: number`
  - `mode: "protected_read_only_overview"`
  - `requestId: string`
  - `principal: safe principal summary`
  - `access: { allowed, accessLevel, guildId }`
  - `guildScope: safe guild scope summary`
  - `guild: safe guild summary`
  - `runtime: safe runtime summary`
  - `capabilities: safe capability summary`
  - `features: safe feature presence summary`
  - `resources: safe resource/config summary`
  - `generatedAt: ISO timestamp`

## Safe included fields
- Authenticated principal safe summary (id/display/provider/avatar + guild counts).
- Access level and resolved guild id.
- Guild configuration/binding counts and feature presence flags.
- Runtime/capability booleans and phase summaries.

## Excluded fields
- OAuth access/refresh tokens.
- OAuth client secrets.
- Session signing secret/raw cookie internals.
- Raw OAuth provider payloads.
- Raw Discord permission bitfields.
- Mutation/action payloads for moderation/private-room internals.
- DB credentials/secrets.

## Failure modes
- Auth disabled/unconfigured: `503` with repo-consistent safe error.
- Unauthenticated: `401 unauthenticated`.
- Authenticated but no guild access: `403 guild_access_denied` with safe reason code.
- Route remains read-only and does not expose mutation paths.
