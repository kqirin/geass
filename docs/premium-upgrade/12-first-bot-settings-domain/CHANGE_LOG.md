# Change Log (12 - First Bot Settings Domain)

| File | Purpose | Default bot behavior changed? | Why safe | Rollback simplicity |
|---|---|---|---|---|
| `api/src/controlPlane/botSettingsRepository.js` | Adds guild-scoped bot settings model/repository with safe defaults and effective legacy fallback mapping. | No | In-memory isolated slice, narrow schema (`statusCommand.detailMode`), fail-safe normalization. | Remove module and repository wiring. |
| `api/src/controlPlane/botSettingsRoutes.js` | Adds protected GET/PUT control-plane routes for status-command bot settings with validation, origin guard, mutation pipeline, and audit integration. | No | Reuses existing auth + guild access + bounded body + audit seams; no destructive domains exposed. | Remove route module and route registration. |
| `api/src/controlPlane/dashboardRoutes.js` | Registers new protected bot settings domain routes. | No | Additive route wiring only. | Revert route-definition concat and import. |
| `api/src/controlPlane/publicRoutes.js` | Passes optional bot settings repository through route-construction seam. | No | Additive dependency threading only. | Revert added option pass-through. |
| `api/src/controlPlane/server.js` | Threads optional bot settings repository through server public-route setup seam. | No | Additive wiring; existing route behavior unchanged. | Revert added option pass-through. |
| `api/src/bot/commands/durum.js` | Adds runtime read of status detail mode and compact formatter branch for `.durum` output only. | No (only when explicitly configured) | Fallback is always legacy when unset/error; permissions and command semantics unchanged. | Remove detail-mode resolver branch and keep legacy formatter. |
| `api/test/controlPlane.server.test.js` | Extends integration coverage for new bot settings endpoint across disabled/auth/guild-access/validation/audit/no-secret-leak paths. | No | Test-only assertions validating fail-closed boundaries and stable shapes. | Revert added assertions/requests. |
| `api/test/durum.command.test.js` | Adds runtime compact-mode behavior test and shared settings repo reset for deterministic command tests. | No | Test-only runtime verification for presentation-only change. | Revert added test blocks. |
| `docs/premium-upgrade/12-first-bot-settings-domain/PLAN.md` | Documents scope, safety rationale, deferrals, and proof objective. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/12-first-bot-settings-domain/SETTINGS_CONTRACT.md` | Documents protected endpoint contract, auth/guild requirements, schema, validation, and exclusions. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/12-first-bot-settings-domain/RUNTIME_INTEGRATION.md` | Documents exact runtime read path and low-risk behavior surface. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/12-first-bot-settings-domain/CHANGE_LOG.md` | Tracks file-level purpose/safety/rollback notes for this phase. | No | Documentation only. | Delete file. |
| `docs/premium-upgrade/12-first-bot-settings-domain/FINAL_STATUS.md` | Captures test outcomes and readiness status for next phase. | No | Documentation only. | Delete file. |
