# Capability Enforcement

## Enforced capability
- `advanced_dashboard_preferences`
- Required plan tier: `pro`
- Gating mode: `enforced`
- Domain: control-plane preferences only

## Where enforcement happens
1. Plan/capability model:
   - `api/src/controlPlane/planCapabilities.js`
2. Feature context resolution:
   - `api/src/controlPlane/entitlementResolver.js`
   - `api/src/controlPlane/featureGates.js`
3. Preferences contract enforcement:
   - `api/src/controlPlane/preferencesRoutes.js`
4. Route wiring:
   - `api/src/controlPlane/dashboardRoutes.js` passes `featureGateEvaluator` into preferences routes.

## Free/default behavior
- Basic preference fields remain writable/readable as before.
- `advancedLayoutMode` write is denied with `403 capability_denied`.
- Read payload includes capability visibility and returns `advancedLayoutMode: null`.

## Premium behavior
- `pro`/`business` contexts allow `advancedLayoutMode` write and read-back.
- Response includes stable plan/capability summary indicating availability.

## Fail-closed ambiguous behavior
- If entitlement cannot be resolved (`unresolved`), `advancedLayoutMode` write is denied.
- Denial reason is safe and explicit (`advanced_dashboard_preferences_unavailable`).
- Basic preference writes remain operational to avoid unrelated route breakage.

## Future extension points
- Additional premium preference fields can reuse the same validator + capability decision path.
- Future dangerous mutation routes can enforce capabilities through the same evaluator seam.
- Real billing/Discord entitlement providers can be integrated by replacing entitlement sources only, keeping route contracts stable.
