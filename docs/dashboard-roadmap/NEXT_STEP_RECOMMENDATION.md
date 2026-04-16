# Next Step Recommendation

## Recommended Next Implementation Step

Title:
- Implement a read-only "Setup Readiness" backend endpoint and dashboard section.

Why this is the best next step:
- It delivers immediate operational value without changing moderation/runtime behavior.
- It reuses existing validation logic (`validateStaticConfig`) and surfaces real blockers for later wizard/write phases.
- It creates the safest foundation for the future "Kurulum Sihirbazi" flow.

## Exact Scope

In scope:
- Add protected read-only endpoint:
  - `GET /api/dashboard/protected/setup-readiness`
- Return per-selected-guild readiness payload:
  - missing/invalid role/channel/category references
  - private room setup completeness
  - startup voice readiness (configured, exists, voice-type, permission-ready)
  - command policy completeness indicators (read-only)
- Add dashboard UI section to render readiness cards and warnings.

Out of scope (do not touch):
- No new write endpoints.
- No migration of static config precedence.
- No runtime moderation or private-room behavior changes.
- No schema migrations required for this step.

## Acceptance Criteria

1. Authenticated operator can load setup readiness for selected guild from protected route.
2. Response includes structured issue list with stable reason codes.
3. Dashboard displays readiness status and actionable missing-config hints.
4. Existing `.durum` command settings and preferences flows remain unchanged.
5. No bot command behavior changes observed in runtime smoke checks.

