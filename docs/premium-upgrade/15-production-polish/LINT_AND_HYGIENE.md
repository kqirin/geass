# Lint and Hygiene Report

## Commands run
1. `npm.cmd run lint` (in `api/`)
2. `npm.cmd test` (in `api/`)
3. `npm.cmd run format:check` (in `api/`)
4. `npm.cmd test -- test/controlPlane.server.test.js test/featureGates.foundation.test.js test/sharedState.foundation.test.js test/scheduler.foundation.test.js` (in `api/`)

## Initial lint status
- Initial `eslint` result: **18 errors** across:
  - `api/src/bot/commands/channelLock.helpers.js`
  - `api/src/controlPlane/metaProviders.js`
  - `api/src/voice/privateRoomService.js`
  - `api/test/privateRoom.integration.test.js`

## Issues fixed
- `api/src/bot/commands/channelLock.helpers.js`
  - Fixed undefined constant usage in mutation lock timeout checks (`CHANNEL_LOCK_MUTATION_LOCK_TIMEOUT_MS` -> `CHANNEL_MUTATION_LOCK_TIMEOUT_MS`).
  - Removed paired unused-const lint issue by making the declared timeout constant authoritative.
- `api/src/controlPlane/metaProviders.js`
  - Removed redundant boolean cast (`no-extra-boolean-cast`) with no behavior change.
- `api/src/voice/privateRoomService.js`
  - Removed unused emoji constants.
  - Removed unused helper function (`canEnterLockedRoom`).
  - Removed unused function block (`removeWhitelistMembers`) that was not referenced.
  - Renamed unused function args to `_...` where needed.
  - Removed unused destructured locals.
  - Removed useless try/catch that only rethrew.
- `api/test/privateRoom.integration.test.js`
  - Removed one unused local variable.

## Current lint status
- `npm.cmd run lint`: **PASS** (`eslint src test --max-warnings=0`)

## Deferred hygiene items
- `npm.cmd run format:check`: **FAIL** (32 files not Prettier-formatted).
- Deferred reason:
  - This is broad style-only churn across many existing tests and utility files.
  - Mass reformat is high-noise and high-merge-conflict risk for a production-polish phase.
  - It does not affect runtime behavior or current test/lint correctness.
- Recommended handling phase:
  - Dedicated formatting/hygiene sweep after dashboard integration branch cut, with isolated review and merge.
