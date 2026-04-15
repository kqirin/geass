# Audit Model

## What gets recorded
Each mutation attempt records a bounded audit entry with:
- `mutationType` (for this phase: `dashboard_preferences_upsert`)
- `actorId`
- `actorType`
- `requestId`
- scope summary:
  - `guildId`
  - `path`
  - `method`
- `result` (`rejected`, `failed`, `succeeded`)
- `reasonCode` (when available)
- `timestamp`

## Where it is recorded
- Default recorder: in-memory bounded ring buffer (`createInMemoryMutationAuditRecorder`).
- Recorder can be injected (tests/useful future adapters), enabling easy migration to DB/log sinks later without changing mutation handlers.

## What is intentionally excluded
- OAuth tokens or raw Authorization headers
- Session secrets/cookie values
- Raw request payload dumps
- Discord permission bitfields and other sensitive auth/session internals

## How future dangerous mutations reuse this seam
- New mutation handlers can keep the same `auditRecorder.record(...)` contract.
- Future phases can increase strictness by:
  - adding mandatory durable sink (DB table/structured log ingestion)
  - recording richer action metadata
  - correlating with moderation case IDs and approval workflows
- This phase validates the minimum safe structure without enabling dangerous bot mutations.
