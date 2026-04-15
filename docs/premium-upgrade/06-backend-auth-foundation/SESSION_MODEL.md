# Session Model

## Session shape
- Internal session record (server-side):
  - `id`
  - `provider` (`discord_oauth`)
  - `principal` (normalized safe identity)
  - `createdAtMs`
  - `expiresAtMs`
- Exposed safe session summary:
  - `id`
  - `provider`
  - `createdAt` (ISO string)
  - `expiresAt` (ISO string)

## Principal shape (safe summary)
- `type`
- `id`
- `provider`
- `username`
- `displayName`
- `avatarUrl`
- `guildIds` (currently empty until guild-access phase expands)

## Cookie behavior
- Cookie stores signed session id payload.
- Cookie properties:
  - `HttpOnly`
  - `SameSite` configurable (default `Lax`)
  - `Secure` configurable (production-safe default via config)
  - `Path=/`
  - bounded `Max-Age`
- Cookie signing uses HMAC with `SESSION_SECRET`.

## Expiration model
- Session TTL is config-driven (`CONTROL_PLANE_SESSION_TTL_MS`).
- Expired sessions are treated as invalid and pruned from in-memory store.
- OAuth `state` records have independent short TTL (`CONTROL_PLANE_OAUTH_STATE_TTL_MS`).

## Storage model (current phase)
- In-memory session repository.
- In-memory OAuth state store.
- Tradeoff: simple/low-risk for this phase, not horizontally shared across processes.

## Logout behavior
- `POST /api/auth/logout`:
  - reads current session cookie
  - deletes corresponding session record
  - returns cookie clear header (`Max-Age=0`)
  - returns safe success JSON

## Future migration path
- Swap `sessionRepository` implementation behind existing seam to:
  - shared DB-backed or Redis-backed storage
  - multi-instance consistency
  - stronger session revocation semantics
- Keep cookie + auth-context contracts stable while changing repository backend.
