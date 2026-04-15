# Retry And Dedupe Model

## Job identity model
- Identity is keyed by `jobName + jobKey`.
- Helper utilities create stable keyed job tokens for dedupe use cases.
- Identity is the source of truth for duplicate suppression and cancellation.

## Dedupe / cancel / replace behavior
- `scheduleDelayedJob` with an existing key returns `accepted: false` (explicit duplicate).
- `replaceDelayedJob` (or `replaceExisting: true`) cancels old job state and replaces it.
- `cancelJob` removes queued state and local timer handle for the keyed job.
- All operations are explicit and return structured result metadata.

## Retry behavior in this phase
- Retry is policy-driven (`maxAttempts`, `baseDelayMs`, `maxDelayMs`, `backoff`).
- Retry metadata is persisted in job record fields (`attempts`, `lastErrorCode`, next run time).
- Final failure is contained to job scope; request paths continue fail-safe.

## What is intentionally deferred
- Full dead-letter queue flow.
- Global cross-node exactly-once execution guarantee.
- Rich operator tooling for retry replay control.

## Safe adoption guidance for future critical jobs
- Start with idempotent job handlers that can safely re-run.
- Use stable domain keys for dedupe (`guildId|entityId|action` style).
- Require explicit replace semantics for mutable delayed intents.
- Add domain-level verification and recovery checks before moving critical moderation/voice flows.
