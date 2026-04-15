# Test Baseline (Observed on 2026-04-10)

## Test commands
- API test command in `api/package.json`: `node --test`
- Dashboard test command in `dashboard/package.json`: `node --test`
- In this environment:
  - `npm test` failed first due PowerShell execution policy blocking `npm.ps1`.
  - Tests were executed with `npm.cmd test` successfully.

## Total discovered test files
- `api/test`: 44 files
- `dashboard/test`: 4 files
- Total discovered by file scan: 48 files

## Current pass/fail status (runnable)
- API (`api`, `npm.cmd test`):
  - Total tests: 245
  - Passed: 226
  - Failed: 19
  - Duration: ~31s
- Dashboard (`dashboard`, `npm.cmd test`):
  - Total tests: 9
  - Passed: 9
  - Failed: 0
  - Duration: ~0.3s

## Failing suites and likely reason
1. `api/test/messageEncoding.test.js`
- Failure: `catalog defaults ship with valid utf8 text`
- Likely reason: template/catalog default string changed (expected decorative suffix missing).

2. `api/test/moderation.ban.command.test.js`
- Failures:
  - `.ban ID-only hedefte member bulunamiyorsa fail-closed davranir`
  - `.ban resolve edilen member varken hierarchy/bannable kontrol yolunu korur`
- Likely reason: ban command behavior changed around unresolved-ID flow and verifyPermission argument shape (`targetId` now passed explicitly).

3. `api/test/moderation.case-id-response.test.js`
- Failure: mute success/degraded warning expectation mismatch when case log creation fails.
- Likely reason: side-effect degradation path text/ordering drift.

4. `api/test/moderation.partial-failure.test.js`
- Failure: unban warning text regex mismatch (`log kaydi` vs `log kaydı` diacritic form).
- Likely reason: normalization/encoding expectations outdated vs current output.

5. `api/test/moderation.permission.service.test.js` (11 failures)
- Failures cluster around hierarchy/bot capability reason codes.
- Likely reason: permission-gate ordering and fixtures no longer aligned (many checks now fail at `missing_command_permission` stage before expected hierarchy stage).

6. `api/test/moderation.production-hardening.test.js`
- Failures:
  - `ban command fails closed when target member cannot be resolved`
  - `ban command aborts when target state changes before action execution`
- Likely reason: ban command now calls verify path in cases test expects early abort; template mapping differs (`systemError` vs expected `operationNotAllowed`) for one error path.

## Flaky-risk areas
- Time/retry based logic:
  - `penaltyScheduler` timers
  - voice connect verification retries
  - startup voice auto-join retries
- Concurrency/lock tests:
  - private room mutation races
  - moderation mutation locks
  - rate-limit consume/release serialization
- Any test relying on exact localized strings/diacritics is brittle to text normalization.

## Missing critical coverage
- No full backend HTTP contract tests for dashboard-required `/api/*` surface (session/settings/reaction CRUD/etc).
- No end-to-end startup+shutdown integration test that asserts advisory lock lifecycle and resource teardown in one run.
- Limited multi-process/distributed-state tests (many guards are single-process in-memory).
- CI currently does not run dashboard tests (`dashboard` workflow job runs lint/build/format-check only).

## Failures that must be fixed before refactor
- P0: all 19 failing API tests, especially:
  - `moderation.permission.service.test.js` cluster
  - `moderation.ban.command.test.js` + `moderation.production-hardening.test.js`
  - partial-failure/case-id response regressions
- Rationale:
  - These failures directly cover moderation safety and behavior contracts that migration must preserve.
  - Refactoring with a red baseline risks locking in undetected regressions.
