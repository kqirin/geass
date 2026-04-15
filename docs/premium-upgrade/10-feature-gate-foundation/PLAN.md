# Feature Gate Foundation Plan

## What premium foundation was added
- Added centralized plan and capability model for control-plane feature gating.
- Added centralized entitlement resolver and feature gate evaluator.
- Added safe temporary entitlement sources:
  - config default plan
  - config manual guild plan overrides
  - in-memory guild plan repository seam
- Added read-only visibility endpoints:
  - `GET /api/auth/plan`
  - `GET /api/dashboard/context/features`
- Added feature gate context visibility to existing protected dashboard payloads.

## Why this is the safest next step
- No billing provider integration, payment processing, or external entitlements were introduced.
- Existing route behavior is preserved; new gate data is primarily additive visibility.
- Capability evaluation fails closed for ambiguous/unresolved entitlement states.
- Dangerous bot mutation domains remain untouched.

## What was intentionally deferred
- Stripe/Discord monetization/real billing integrations.
- Public self-serve plan purchase or entitlement lifecycle APIs.
- Premium write-route activation for moderation/reaction/private-room domains.
- Durable entitlement/audit infra expansion (Redis/queues/sharding).

## How this prepares future billing and premium features
- Future billing adapters can plug into the entitlement resolver without route rewrites.
- Future premium route enforcement can reuse existing capability decisions.
- Dashboard can consume stable plan/capability payloads before paid features are activated.
- Plan/capability contracts now exist for incremental rollout with explicit fail-closed behavior.
