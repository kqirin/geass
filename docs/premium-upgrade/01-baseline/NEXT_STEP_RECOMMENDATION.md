# Next Step Recommendation

## Step title
Stabilize the baseline by bringing the API test suite to green without changing production runtime behavior.

## Why this should be next
- Current baseline has 19 failing API tests in moderation-critical areas (permission gate, ban behavior, partial-failure messaging).
- Premium migration on top of a red baseline is unsafe because regressions cannot be distinguished from pre-existing drift.
- This step is high-leverage and low-risk when constrained to tests and non-invasive test harness helpers.

## Expected files to touch
- `api/test/moderation.permission.service.test.js`
- `api/test/moderation.ban.command.test.js`
- `api/test/moderation.production-hardening.test.js`
- `api/test/moderation.case-id-response.test.js`
- `api/test/moderation.partial-failure.test.js`
- `api/test/messageEncoding.test.js`
- Optional: small shared test helper files under `api/test/` if needed for fixture consistency.

## What must remain unchanged
- No production behavior changes in `api/src/**` and `dashboard/src/**`.
- No dependency changes.
- No command/event contract changes documented in `BEHAVIOR_CONTRACTS.md`.
- No file renames or deletes.

## Exit criteria
- `api` test run is fully green (no failing tests).
- `dashboard` tests remain green.
- Updated tests explicitly reflect the frozen baseline behavior contracts from this package.
