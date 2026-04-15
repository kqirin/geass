# Failure Triage (API Baseline Stabilization)

## Run context
- Date: 2026-04-10
- Command: `npm.cmd test` (in `api/`)
- Initial result: 245 total, 233 passed, 12 failed
- Failure concentration: all 12 failures in `api/test/moderation.permission.service.test.js`

## Categorization

| # | Failing test | Observed failure | Category | Why |
|---|---|---|---|---|
| 1 | `actor target ve bot native hierarchy uygunsa moderation izni verilir` | `false !== true` | outdated test | Actor fixture lacked native `ModerateMembers` permission; check failed at command gate. |
| 2 | `actor ile target esit highest role position ise hierarchy reddi gelir` | got `missing_command_permission` instead of hierarchy reason | outdated test | Fixture did not satisfy native actor permission precondition. |
| 3 | `actor targettan dusukse native hierarchy reddi gelir` | got `missing_command_permission` instead of hierarchy reason | outdated test | Same fixture drift: missing native actor permission. |
| 4 | `target sunucu sahibi ise actor yuksek olsa bile reddedilir` | got `missing_command_permission` instead of `target_is_owner` | outdated test | Command-gate failure happened before hierarchy branch due to fixture permissions. |
| 5 | `actor sunucu sahibi ise hierarchy override alir ama command role gate yine korunur` | `false !== true` | outdated test | Owner override does not bypass native command permission gate; fixture missing native permission. |
| 6 | `actor yeterli olsa bile bot moderatable degilse bot hierarchy reddi gelir` | stage mismatch (`command_gate` vs expected `bot_capability`) | outdated test | Native actor permission missing, so test never reached bot capability checks. |
| 7 | `command role varsa bile native hierarchy yetersizse hedefte islem reddedilir` | got `missing_command_permission` instead of hierarchy reason | outdated test | Same missing native actor permission. |
| 8 | `target cachede yoksa authoritative fetch ile resolve edilir` | `false !== true` | outdated test | Command-gate denied before authoritative target resolution due to fixture permissions. |
| 9 | `timeout native moderatable reddi admin hedefte dedicated reasonCode ile doner` | got `missing_command_permission` instead of `target_timeout_protected` | outdated test | Native actor permission missing; execution requirement branch not reached. |
|10 | `kick ve ban native kickable bannable durumlariyla uyumlu fail-closed calisir` | got `missing_command_permission` instead of bot hierarchy reason | outdated test | Actor fixture lacked native `KickMembers`/`BanMembers` permissions. |
|11 | `audit log native hierarchy alanlarini dolu ve actorLevelsiz uretir` | got `missing_command_permission` instead of hierarchy reason | outdated test | Fixture blocked at command gate before expected hierarchy audit event. |
|12 | `native snapshot no-role hedefte null authority yerine zero-position alanlari verir` | got `missing_command_permission` instead of hierarchy reason | outdated test | Same fixture drift: missing native actor permission. |

## Summary by category
- code bug: 0
- outdated test: 12
- ambiguous policy: 0 (see open question for explicit contract wording)
- brittle assertion: 0
- environment issue: 0

## Fix approach used
- Smallest safe change: test fixture updates only in `api/test/moderation.permission.service.test.js`.
- No runtime code changes for this stabilization step.
