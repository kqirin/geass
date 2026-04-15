# Data Composition

## Existing providers/contracts reused
- `createDashboardOverviewProvider(...)`
  - runtime + guild-scope base summary.
- `createDashboardGuildProvider(...)`
  - safe guild summary and binding counts.
- `createDashboardFeaturesProvider(...)`
  - read-only feature presence summary.
- `createDashboardResourcesProvider(...)`
  - read-only resource/config summary.
- `createRuntimeMetaProvider(...)`
  - safe runtime metadata.
- `createCapabilitiesProvider(...)`
  - safe capability booleans.
- Existing auth/guild access boundaries:
  - `requireAuth`
  - `createRequireGuildAccess(...)`

## New provider/adapter added
- `api/src/controlPlane/protectedDashboardProvider.js`
  - `createProtectedDashboardOverviewProvider(...)`
  - Composes the providers above into one stable protected payload contract.
  - Does not implement new business logic or mutation behavior.

## Why composition is low-risk
- Uses already-tested read-only provider outputs.
- Keeps access checks at route boundary; provider only composes safe summaries.
- Avoids touching unrelated bot runtime domains.
- Additive route/module changes only; rollback is straightforward.

## Data intentionally excluded
- Tokens, secrets, raw OAuth/Discord payloads.
- Any write capability flags beyond safe booleans.
- Raw moderation/private room execution internals.
- Any premium entitlement/billing fields.
