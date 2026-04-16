# 18 - Setup Readiness Plan

## Goal
Add a **read-only** protected setup-readiness endpoint and dashboard section so guild operators can see whether core bot setup is complete, warning-level, or incomplete.

## Scope
- Backend: `GET /api/dashboard/protected/setup-readiness`
- Dashboard: new `Kurulum Durumu` section in existing premium layout
- Tests: backend route/auth/access/payload + dashboard data/view-model coverage
- Docs: contract, checks, changelog, final status

## Out Of Scope
- No runtime moderation/private-room/reaction-role behavior changes
- No auth handoff, bearer, CORS, cookie strategy changes
- No write endpoints for setup readiness
- No fake save actions in dashboard
- No schema/migration changes

## Implementation Notes
1. Add a dedicated setup-readiness provider in control-plane layer.
2. Reuse static config accessors (`getStaticGuildSettings`, `getPrivateVoiceConfig`, `getTagRoleConfig`, `getStartupVoiceConfig`).
3. Use the same route guard pattern as other protected dashboard routes (`requireAuth` + guild access).
4. Return stable contract with `contractVersion: 1`.
5. Keep checks fail-closed but safe: warnings/incomplete only, no mutations.
6. Load setup readiness in dashboard protected snapshot; tolerate readiness-only fetch failure with safe local error state.

## Deliverables
- Endpoint and provider implementation
- Dashboard section UI and view-state handling
- Test coverage additions
- Documentation under `docs/premium-upgrade/18-setup-readiness/`
