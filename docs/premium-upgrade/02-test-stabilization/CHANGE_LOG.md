# Change Log (Test Stabilization)

## Scope guard
- Focused only on backend/API test stabilization.
- No premium feature work started.
- No new dependencies added.
- No architecture changes introduced.
- No intended runtime behavior changes made.

## Batch 1
- File updated: `api/test/moderation.permission.service.test.js`
- Change type: test fixture alignment with current permission gate behavior.
- Changes:
  - Added `permissionNames: ['ModerateMembers']` to actor fixtures in mute/hierarchy-oriented tests.
  - Added `permissionNames: ['KickMembers', 'BanMembers']` to actor fixture in kick/ban capability test.

## Batch 1.1 (immediate correction)
- File updated: `api/test/moderation.permission.service.test.js`
- Change type: syntax fix.
- Changes:
  - Fixed malformed `createMember(...)` call in kick/ban test fixture (`]` -> `}` context fix).

## Verification runs
1. Baseline run before edits
- Command: `npm.cmd test` (api)
- Result: 245 total, 233 passed, 12 failed

2. Focused suite after first edit
- Command: `node --test test/moderation.permission.service.test.js`
- Result: syntax failure (patch typo), fixed immediately

3. Focused suite after syntax fix
- Command: `node --test test/moderation.permission.service.test.js`
- Result: 13 total, 13 passed, 0 failed

4. Full API rerun after batch
- Command: `npm.cmd test` (api)
- Result: 245 total, 245 passed, 0 failed
