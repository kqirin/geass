# Plan Model

## Plan tiers
- `free`
- `pro`
- `business`

## Entitlement sources (current phase)
Priority order:
1. `config_manual_override` (per-guild override map)
2. `repository` (in-memory guild plan repository seam)
3. `config_default` (default plan fallback)

If no valid entitlement can be resolved, status is `unresolved` and capability decisions fail closed.

## Capability resolution rules
- Capability lookup is explicit from central `CAPABILITY_DEFINITIONS`.
- Evaluation uses:
  - entitlement status (`resolved` vs `unresolved`)
  - capability active flag
  - required minimum plan tier
- Deny reasons include:
  - `entitlement_unresolved`
  - `capability_not_active`
  - `plan_upgrade_required`
  - `capability_unknown`

## Default/fallback behavior
- Runtime default plan is `free` unless explicitly overridden.
- Missing guild scope resolves to `unresolved` (`guild_id_required`) and denies all capabilities.
- Invalid explicit default plan config resolves to `unresolved` (`default_plan_invalid`) and denies all capabilities.

## Future billing integration points
- Replace/add entitlement source in `createGuildEntitlementResolver(...)` with:
  - Discord entitlements source
  - external billing provider source
  - durable DB entitlement store
- Keep route contracts stable while changing entitlement source internals.
- Future premium write-route enforcement can directly consume `featureGateEvaluator.evaluateCapability(...)`.
