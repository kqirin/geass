# Adapter Model

## Scheduler abstraction interface
- `scheduleDelayedJob({ jobName, jobKey, delayMs, handler, replaceExisting, retry, metadata, payload })`
- `replaceDelayedJob(...)` (same as schedule with explicit replace semantics)
- `cancelJob({ jobName, jobKey })`
- `getJobStatus({ jobName, jobKey })`
- `getSummary()`
- `close()`

## Backend implementations
- Memory backend: `api/src/scheduler/memoryScheduler.js`
  - in-process record store for scheduled jobs
  - always available
- Optional hardened backend: `api/src/scheduler/hardenedScheduler.js`
  - backed by shared-state selector
  - uses Redis when configured
  - exposes active store provider and fallback status

## Backend selector and config
- Selector: `api/src/scheduler/schedulerBackendSelector.js`
- Config path: `config.controlPlane.scheduler`
  - `enabled`
  - `provider` (`memory` or `hardened`)
  - `fallbackToMemory`
  - `hardened.defaultRecordTtlMs`
  - `hardened.redis.url`
  - `hardened.redis.keyPrefix`
  - `hardened.redis.connectTimeoutMs`
  - `hardened.redis.fallbackToMemory`
  - `adoption.authExpiryCleanupEnabled`

## Fallback behavior
- Scheduler disabled: no scheduled adoption work runs.
- Scheduler enabled with memory provider: memory backend is active.
- Scheduler enabled with hardened provider:
  - Redis configured and reachable: hardened Redis-backed state path is active.
  - Redis unavailable/misconfigured: explicit fallback path can use memory backend/store and exposes reason codes.

## Failure behavior
- Job handler failures use retry policy metadata.
- Final failure does not crash request flow; failures are isolated per job.
- Expiry cleanup scheduling in auth/session domain is best-effort and non-fatal.
- Runtime summaries expose safe reason codes only (no secret URLs/tokens).

## Future extension points
- Add stronger durable polling/replay workers for critical jobs.
- Add DLQ/dead-letter model for repeated failures.
- Add lease/claim semantics for strict multi-node execution guarantees.
- Migrate selected higher-risk domains only after domain-specific invariants are documented.
