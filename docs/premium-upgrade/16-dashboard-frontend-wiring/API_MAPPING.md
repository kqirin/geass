# API Mapping (16)

| Frontend call | Backend endpoint | Expected success payload | Unauth / no-access / error behavior | Used by |
|---|---|---|---|---|
| `getAuthStatus()` | `GET /api/auth/status` | `data.auth` status (`enabled/configured/authenticated`), optional principal/session summaries | Never treated as protected. `503` details map to `auth_unavailable` UI state. | `useDashboardData` bootstrap |
| `getAuthMe()` | `GET /api/auth/me` | `data.principal`, `data.session` | `401 -> unauthenticated`, `503 -> auth_unavailable` | `useDashboardData` bootstrap |
| `getAuthGuilds()` | `GET /api/auth/guilds` | `data.guilds[]`, `data.summary` | `401 -> unauthenticated`, `503 -> auth_unavailable` | `useDashboardData` bootstrap + guild selector |
| `getAuthPlan({ guildId })` | `GET /api/auth/plan` | `data.plan`, `data.access.targetGuildId`, `data.capabilities`, `data.capabilitySummary` | `401 -> unauthenticated`, `403 guild_access_denied -> no_access`, `503 -> auth_unavailable` | protected snapshot load in `useDashboardData` |
| `postAuthLogout()` | `POST /api/auth/logout` | `data.loggedOut === true` | failure ignored for safe local logout fallback | logout action in `useDashboardData` / `DashboardHeader` |
| login URL redirect | `GET /api/auth/login` | redirect to OAuth provider | `503` is surfaced by backend if auth not configured | `Login` page and unauthenticated dashboard action |
| `getDashboardContextFeatures({ guildId })` | `GET /api/dashboard/context/features` | plan + capability matrix (`data.capabilities`, `data.capabilitySummary`) | `401`/`403`/`503` mapped to dashboard states | `useDashboardData` protected snapshot |
| `getProtectedOverview({ guildId })` | `GET /api/dashboard/protected/overview` | protected overview summary (runtime, plan, features/resources metadata) | `401`/`403`/`503` mapped to dashboard states | `useDashboardData`, `SystemHealthCard`, Dashboard summary cards |
| `getDashboardPreferences({ guildId })` | `GET /api/dashboard/protected/preferences` | `data.preferences`, `data.plan`, `data.capabilities` | `401`/`403`/`503` mapped to dashboard states | preferences card initial load |
| `putDashboardPreferences({ guildId, preferences })` | `PUT /api/dashboard/protected/preferences` | updated `data.preferences`, `data.mutation`, plan/capability envelope | `403 capability_denied` shown as save error; `401`/`403 guild_access_denied`/`503` safely degrade view state | preferences save action |
| `getStatusCommandSettings({ guildId })` | `GET /api/dashboard/protected/bot-settings/status-command` | `data.settings`, `data.effective`, `data.updatedAt` | `401`/`403`/`503` mapped to dashboard states | status-command card initial load |
| `putStatusCommandSettings({ guildId, detailMode })` | `PUT /api/dashboard/protected/bot-settings/status-command` | updated settings/effective + mutation envelope | mutation error surfaced as save failure; auth/access errors safely degrade state | status-command save action |

## Notes
- All calls are centralized in `dashboard/src/lib/apiClient.js`.
- `guildId` is passed via query params when available to avoid ambiguous guild scope.
- Response envelope unwrapping supports backend shape: `{ ok: true, data: ... }`.
