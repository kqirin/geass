# Mutation Pipeline

## Request path
1. Route resolution enters protected mutation handler (`PUT /api/dashboard/protected/preferences`).
2. Auth gate executes (`requireAuth`).
3. Guild access gate executes (`createRequireGuildAccess(...)`).
4. Optional origin/CSRF seam executes (enabled only when allowed origins are configured from `controlPlane.auth.publicBaseUrl`).
5. Request body is read with a hard byte ceiling.
6. `Content-Type` is enforced as `application/json`.
7. JSON payload is parsed and validated against the preference schema.
8. Mutation handler executes repository upsert.
9. Audit seam records mutation attempt result.
10. Stable JSON response is returned through the standard `ok/data` or `ok/error` envelope.

## Safety gates
- Auth required: unauthenticated requests fail before mutation logic.
- Guild access required: authenticated but unauthorized users fail before mutation logic.
- Payload size bound: oversized bodies return `413 payload_too_large`.
- Media type bound: non-JSON bodies return `415 unsupported_media_type`.
- Schema validation: malformed/unknown/invalid fields return bounded `400 invalid_request_body`.
- Conservative mutation errors: internal failures map to `500 internal_error` without sensitive internals.

## Failure modes
- Auth disabled: `503 auth_disabled`
- Auth not configured: `503 auth_not_configured`
- Unauthenticated: `401 unauthenticated`
- No guild access: `403 guild_access_denied`
- Unsupported media type: `415 unsupported_media_type`
- Oversized body: `413 payload_too_large`
- Invalid payload: `400 invalid_request_body`
- Unexpected internal fault: `500 internal_error`

## Future extension points
- Swap repository implementation (in-memory -> DB-backed) without changing route contract.
- Add per-mutation validators while reusing the same pipeline.
- Add stricter operator/admin/premium preconditions as additional checks.
- Add idempotency-key semantics for non-idempotent operations.
- Reuse the same audit recorder contract for higher-risk bot mutations once explicitly unlocked in future phases.
