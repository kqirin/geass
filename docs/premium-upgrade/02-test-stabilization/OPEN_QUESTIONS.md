# Open Questions

1. Should the behavior contract explicitly state native actor permission precedence?
- Current runtime behavior requires native Discord command permission (`ModerateMembers`/`KickMembers`/`BanMembers`) before deeper hierarchy/capability checks.
- Making this explicit in baseline contract text would reduce future fixture drift.

2. Should moderation permission tests use a shared actor-fixture helper that defaults native permissions per command bucket?
- This would reduce repetitive setup and lower the chance of command-gate false negatives in hierarchy-focused tests.

3. Do we want an additional negative test that explicitly asserts command-gate precedence when native permission is missing?
- This would lock in current fail-closed ordering and clarify policy intent.
