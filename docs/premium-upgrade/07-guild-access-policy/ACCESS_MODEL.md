# Access Model

## Access levels
- `unauthenticated`
  - No valid authenticated principal in request auth context.
- `authenticated_no_guild_access`
  - Authenticated principal exists, but target guild is invalid, unresolved, mismatched, or not in principal membership.
- `authenticated_guild_member`
  - Authenticated principal is a member of resolved target guild.
- `authenticated_guild_operator`
  - Authenticated principal is a target-guild member with operator capability (owner/admin/manage-guild level signal).

## Target guild resolution
- Source of truth is `resolveDashboardGuildScope(...)`.
- Resolution precedence:
  1. Requested `guildId` query (if provided)
  2. Authoritative single-guild config (`oauth.singleGuildId`, then `discord.targetGuildId`, then single static guild fallback)
- If requested guild conflicts with authoritative single guild, resolution is invalid and denied.
- If no authoritative guild and no request guild are available, scope remains unresolved and is denied for guild-protected reads.

## Allow/deny logic (high-level)
1. Normalize auth and principal.
2. Resolve guild scope.
3. Fail closed on:
   - unauthenticated auth context
   - invalid guild id
   - scope mismatch
   - unresolved target guild
   - missing principal membership in target guild
4. Allow only when authenticated principal membership for resolved guild is present.
5. Label allowed access as member or operator.

## Safe failure cases
- `auth_disabled`, `auth_not_configured`, `no_session` path: denies with safe `503/401` behavior.
- `invalid_guild_id`: deny.
- `guild_scope_mismatch`: deny.
- `guild_scope_unresolved`: deny.
- `guild_membership_missing`: deny.
- Optional future `operator_required`: deny when elevated access is required.

## Future extension points
- Operator-only checks can be enforced by `createRequireGuildAccess({ requireOperator: true })`.
- Admin/mod role overlays can be added using guild role snapshots without changing route contracts.
- Premium entitlements can be layered as an additional policy stage after guild access classification.
