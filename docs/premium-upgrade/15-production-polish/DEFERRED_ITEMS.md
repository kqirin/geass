# Deferred Items

| Item | Risk | Why deferred now | Suggested future phase |
|---|---|---|---|
| Prettier backlog (`npm.cmd run format:check` reports 32 files) | Low | Style-only change set would create high review noise and merge-conflict risk in a production-readiness pass. | Post-integration hygiene sweep after dashboard/frontend branch cut |
| Cross-origin control-plane write strategy (origin checks tied to `CONTROL_PLANE_PUBLIC_BASE_URL`) | Medium | Current behavior is safe/fail-closed; changing origin strategy now risks auth/session regressions. | Dashboard deployment integration hardening/runbook phase |
| Legacy env placeholders still present (`METRICS_TOKEN`, `CORS_ORIGIN` not runtime-enforced) | Low | Not blocking runtime correctness; requires broader env-contract cleanup decision across ops docs and deploy templates. | Config contract cleanup/documentation consolidation phase |
| Full dashboard package lint/build/test gating | Low | Mission scope is backend/control-plane readiness; frontend checks should run in dedicated integration gate with UI changes. | Dashboard/frontend integration gate |
