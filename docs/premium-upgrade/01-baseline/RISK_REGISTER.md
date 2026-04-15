# Migration Risk Register

## Risk 1: Permission Gate Drift vs Expected Safety Semantics
- Risk title: Permission stage ordering drift
- Severity: High
- Affected files/modules: `api/src/bot/services/permissionService.js`, `api/src/bot/moderation.js`, moderation tests
- Why risky: 11 active test failures indicate mismatch between expected hierarchy/bot-capability reasoning and current deny stage.
- Rollback impact: Incorrect moderation authorization in production is high-impact and hard to audit retroactively.
- Mitigation strategy: Reconcile test fixtures and runtime behavior, then freeze explicit contract tests for deny-stage ordering.
- Address timing: Before premium features

## Risk 2: Ban/Unban Authoritative Correctness Regression
- Risk title: Ban/unban fail-closed and verify-path drift
- Severity: High
- Affected files/modules: `api/src/bot/commands/ban.js`, `api/src/bot/commands/unban.js`, `api/src/bot/services/guildBanState.js`
- Why risky: Failing tests show divergence in unresolved-target handling and error mapping; this can emit false success or wrong failure type.
- Rollback impact: Incorrect ban state can cause moderation incidents and stale cache confusion.
- Mitigation strategy: Stabilize ban/unban contract with deterministic tests around unresolved IDs, state-change race, and verify result mapping.
- Address timing: Before premium features

## Risk 3: Single-Process In-Memory State Assumptions
- Risk title: Non-distributed locks and counters
- Severity: High
- Affected files/modules: `cache.js`, `permissionService.js`, `actionExecution.js`, `penaltyScheduler.js`, `privateRoomService.js`, `voiceManager.js`
- Why risky: Many correctness controls rely on local Maps/Sets; horizontal scaling or multi-instance premium deployment can break guarantees.
- Rollback impact: Duplicate actions, race conditions, inconsistent enforcement across instances.
- Mitigation strategy: Keep single-instance mode through migration phases; add adapter layer before any distributed-state rollout.
- Address timing: Before any premium feature requiring multi-instance

## Risk 4: Private Room Service Complexity and Coupling
- Risk title: High-complexity room lifecycle refactor risk
- Severity: High
- Affected files/modules: `api/src/voice/privateRoomService.js`, `privateVoiceRepository.js`
- Why risky: Large stateful module combines interaction UX, channel overwrite safety, persistence, and cleanup timers.
- Rollback impact: Broken room ownership/access control and irreversible user-facing disruption.
- Mitigation strategy: Extract only behind adapter boundaries; migrate one sub-flow at a time (e.g., read-only observability first).
- Address timing: After baseline tests are green, before premium private-room extensions

## Risk 5: Timed Penalty Scheduler Timing/Recovery Risk
- Risk title: Timer and reconcile correctness under restart
- Severity: High
- Affected files/modules: `api/src/bot/penaltyScheduler.js`, `timed_penalties` tables
- Why risky: Scheduler mixes long timeouts, reconcile interval, and restore actions (mute/jail/vcmute).
- Rollback impact: Penalties may fail to revoke or revoke incorrectly.
- Mitigation strategy: Preserve scheduler contract exactly; add migration-time replay tests and startup reconcile assertions.
- Address timing: Before premium features that add new penalty types

## Risk 6: Reaction Rule Side-Effect Safety
- Risk title: Reaction action execution integrity
- Severity: Medium
- Affected files/modules: `api/src/application/reactionActions/service.js`, `reactionRuleRepository.js`
- Why risky: Rule engine performs role mutations, message sends, DM sends, grouped reaction removals with cooldown and only-once semantics.
- Rollback impact: Spam, duplicated actions, or over-privileged role assignment.
- Mitigation strategy: Keep rule model and execution semantics stable; add golden tests for each action type before internal changes.
- Address timing: Before premium reaction capabilities

## Risk 7: Dashboard-to-Backend Contract Gap
- Risk title: Frontend expects `/api/*` contract not detected in scanned backend runtime
- Severity: High
- Affected files/modules: `dashboard/src/hooks/useDashboardData.js`, `dashboard/src/lib/apiClient.js`, scanned `api/src` runtime
- Why risky: Dashboard depends on many endpoints, but no matching HTTP route layer was found in current backend scan.
- Rollback impact: Premium dashboard work can dead-end or break auth/settings/reaction flows.
- Mitigation strategy: First establish and freeze explicit API contract source-of-truth + contract tests.
- Address timing: Before premium dashboard features

## Risk 8: User-Facing Text/Encoding Regression
- Risk title: Message catalog and warning-text encoding drift
- Severity: Medium
- Affected files/modules: `application/messages/catalog.js`, `templateService.js`, moderation partial-failure paths
- Why risky: Existing test failures show encoding/diacritic mismatch; staff cues rely on precise text semantics.
- Rollback impact: Confusing moderation UX and brittle automation/tests.
- Mitigation strategy: Freeze normalized text expectations in contract tests; avoid incidental copy edits in migration steps.
- Address timing: Before premium UX/message customization

## Risk 9: Static Config Validation as Startup Hard Gate
- Risk title: Strict static config startup dependency
- Severity: Medium
- Affected files/modules: `api/src/bootstrap/validateStaticConfig.js`, `api/src/config/static/*`
- Why risky: Invalid role/channel/emoji bindings can block startup or degrade feature readiness.
- Rollback impact: Production startup failures after config migration.
- Mitigation strategy: Add preflight config lint in pipeline and phased config migration tooling.
- Address timing: Before premium config/schema changes

## Risk 10: CI Signal Gaps
- Risk title: Incomplete CI confidence boundary
- Severity: Medium
- Affected files/modules: `.github/workflows/ci.yml`, dashboard tests
- Why risky: Dashboard tests are not run in CI; migration can silently break client logic while build still passes.
- Rollback impact: Regressions detected only after deployment/manual QA.
- Mitigation strategy: Add dashboard test stage and baseline contract gate before migration phases.
- Address timing: Before premium feature implementation
