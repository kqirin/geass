# Migration Guardrails (Hard Rules)

## Mandatory rules for every future Codex step
1. No multi-domain refactors in one step.
- A step may touch only one primary domain (example: permission service OR private rooms, not both).

2. No code moves/renames without preserving imports and tests in the same step.
- If a module is moved, all import paths and directly related tests must be updated atomically.

3. Green tests are required before entering the next phase.
- Minimum gate: `api` tests + `dashboard` tests + lint/build checks must pass for the current baseline.

4. Use behavior-preserving adapter-first strategy.
- New implementations must be introduced behind compatibility adapters before replacing old call sites.

5. Put risky new capabilities behind feature flags.
- Default flag state must keep current production behavior unchanged.

6. Enforce compatibility mode before cutover.
- Run legacy and new paths in parallel/read-compare mode where possible before switching writes/actions.

7. No dashboard change without matching backend contract update.
- Any UI API request change requires explicit backend contract update and contract test update in same step.

8. No distributed-state change without fallback path.
- If moving from in-memory to shared state, keep a reversible compatibility fallback until proven stable.

## Additional repository-specific safety constraints
1. Preserve moderation safety semantics first.
- Permission/hierarchy/rate-limit behavior must remain fail-closed at all times.

2. Preserve scheduler semantics across restarts.
- Timed penalties and private-room cleanup behavior must remain durable and restart-safe.

3. Preserve authoritative verification paths.
- Ban/unban and timeout verification must not be downgraded to cache-only assumptions.

4. Do not alter message templates incidentally.
- User-visible moderation outputs are contract surface; text changes require explicit contract update.

## Definition of done for each migration step
- Scope stayed single-domain.
- Test gates are green.
- Behavior contracts affected by the step were re-validated.
- Rollback path is documented and executable.
