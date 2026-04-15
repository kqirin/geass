# Environment Matrix

## Mode 1: Local Bot-Only
- Purpose: run Discord bot runtime without control-plane/dashboard access.
- Required env:
  - `TOKEN`
  - `TARGET_GUILD_ID`
  - database: `DATABASE_URL` (recommended) or discrete DB fields
- Required flags:
  - `ENABLE_CONTROL_PLANE_API=0`
  - `ENABLE_CONTROL_PLANE_AUTH=0`
- Optional:
  - `PORT` (health listener)
  - shared-state/scheduler flags (typically disabled)

## Mode 2: Local Bot + Dashboard
- Purpose: local frontend against local backend with cookie auth flow.
- Required env (backend):
  - mode 1 env +
  - `ENABLE_CONTROL_PLANE_API=1`
  - `ENABLE_CONTROL_PLANE_AUTH=1` (if OAuth flow is being tested)
  - `CLIENT_ID`
  - `CLIENT_SECRET`
  - `REDIRECT_URI=http://localhost:3000/api/auth/callback`
  - `SESSION_SECRET` (>=16 chars)
  - `CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT=http://localhost:5173/`
- CORS/origin:
  - `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN` optional in local dev (defaults allow `http://localhost:5173` and `http://127.0.0.1:5173`)
- Dashboard env:
  - `VITE_API_BASE=http://localhost:3000`
  - `VITE_CLIENT_ID`
  - `VITE_GUILD_ID` (or `VITE_SINGLE_GUILD_ID` as applicable)

## Mode 3: Railway Backend/Bot
- Purpose: hosted bot + backend API/control-plane runtime.
- Required env:
  - mode 1 core env +
  - `NODE_ENV=production`
  - `PORT` (Railway injects this automatically)
  - `ENABLE_CONTROL_PLANE_API=1`
  - `ENABLE_CONTROL_PLANE_AUTH=1` (if dashboard auth is required)
  - `CLIENT_ID`
  - `CLIENT_SECRET`
  - `REDIRECT_URI=https://your-api.up.railway.app/api/auth/callback`
  - `SESSION_SECRET` (strong random)
  - `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN=https://your-dashboard.pages.dev`
  - `CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT=https://your-dashboard.pages.dev/`
  - `CONTROL_PLANE_PUBLIC_BASE_URL=https://your-api.up.railway.app`
- Recommended:
  - `CONTROL_PLANE_AUTH_COOKIE_SECURE=1`
  - `CONTROL_PLANE_AUTH_COOKIE_SAMESITE=Lax` (or `None` only with HTTPS)
  - `DB_SSL=1` if DB URL does not already enforce TLS

## Mode 4: Static Dashboard Host (Cloudflare Pages/Vercel)
- Purpose: host dashboard bundle separately from API runtime.
- Required env:
  - `VITE_API_BASE=https://your-api.up.railway.app`
  - `VITE_CLIENT_ID=<discord oauth client id>`
  - `VITE_GUILD_ID` or `VITE_SINGLE_GUILD_ID` as needed by your selected guild model
- Backend alignment required:
  - backend `CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN` must match deployed dashboard origin
  - backend redirect targets must match deployed dashboard URL

## Safe Flag Combinations
1. Bot-only hard off:
   - `ENABLE_CONTROL_PLANE_API=0`
   - `ENABLE_CONTROL_PLANE_AUTH=0`
2. Read-only control-plane:
   - `ENABLE_CONTROL_PLANE_API=1`
   - `ENABLE_CONTROL_PLANE_AUTH=0`
3. Full auth/dashboard path:
   - `ENABLE_CONTROL_PLANE_API=1`
   - `ENABLE_CONTROL_PLANE_AUTH=1`
   - OAuth + session + origin env fully configured

## Optional Infrastructure Flags
- Shared state:
  - `ENABLE_CONTROL_PLANE_SHARED_STATE=1`
  - `CONTROL_PLANE_SHARED_STATE_PROVIDER=redis`
  - `CONTROL_PLANE_SHARED_STATE_REDIS_URL`
- Scheduler:
  - `ENABLE_CONTROL_PLANE_SCHEDULER=1`
  - `CONTROL_PLANE_SCHEDULER_PROVIDER=memory|hardened`
  - hardened Redis flags when provider is `hardened`
