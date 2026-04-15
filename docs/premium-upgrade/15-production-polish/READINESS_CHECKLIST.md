# Readiness Checklist

| Check | Status | Evidence |
|---|---|---|
| Tests green | PASS | `npm.cmd test` -> `273/273` passed |
| Focused control-plane/shared-state/scheduler tests green | PASS | `npm.cmd test -- test/controlPlane.server.test.js test/featureGates.foundation.test.js test/sharedState.foundation.test.js test/scheduler.foundation.test.js` -> `27/27` passed |
| Lint acceptable | PASS | `npm.cmd run lint` passed with `--max-warnings=0` |
| Env docs updated | PASS | `api/.env.example` clarified and expanded for current control-plane plan/env keys |
| Auth flag behavior verified | PASS | `controlPlane.server.test.js` coverage for disabled/enabled/configured auth paths |
| Control-plane disabled behavior verified | PASS | Disabled mode returns legacy `200 ok` health semantics |
| Protected route/auth behavior verified | PASS | Protected endpoints fail closed with `auth_disabled`, `auth_not_configured`, or `unauthenticated` as expected |
| Premium gate defaults verified | PASS | Feature-gate tests verify fail-closed behavior when entitlement is unresolved/invalid |
| Shared-state optional mode verified | PASS | `sharedState.foundation.test.js` covers memory mode + redis fallback behavior |
| Scheduler optional mode verified | PASS | `scheduler.foundation.test.js` covers memory/hardened paths + fallback + adoption wiring |
| Safe deploy baseline verified | PASS WITH CAVEATS | Runtime validation green; non-blocking Prettier backlog remains |

## Caveats
- `npm.cmd run format:check` still fails on pre-existing formatting drift (32 files).
- Protected write routes enforce strict origin checks; deployment must align browser origin with configured control-plane public base URL.
