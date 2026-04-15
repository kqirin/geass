# Static Dashboard Guide

## Scope
This guide covers deployment preparation for hosting `dashboard/` on a free static host (Cloudflare Pages or Vercel style) without performing deployment.

## Build and Output
- Working directory: `dashboard`
- Install:
  - `npm ci` (or `npm install`)
- Build command:
  - `npm run build`
- Output directory:
  - `dist`

## Required Dashboard Environment Variables
- `VITE_API_BASE=https://your-api.up.railway.app`
- `VITE_CLIENT_ID=<discord oauth client id>`
- `VITE_GUILD_ID` (or `VITE_SINGLE_GUILD_ID` depending selected scope)

## How Dashboard Points to Railway Backend
- `VITE_API_BASE` drives the API client base URL.
- OAuth login starts at backend endpoint:
  - `${VITE_API_BASE}/api/auth/login`
- Backend callback and post-login redirect are configured on API side:
  - `REDIRECT_URI` (Discord callback target)
  - `CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT` (dashboard return URL)

## Cloudflare Pages / Vercel Style Flow
1. Connect repository and select `dashboard/` as project root.
2. Set build command to `npm run build`.
3. Set output directory to `dist`.
4. Configure `VITE_*` env variables in the host dashboard.
5. Deploy preview first, then production.

## What Not to Hardcode
- Do not hardcode Railway URL in source files.
- Do not hardcode dashboard domain in backend source.
- Keep all origin/redirect/base URL values in environment variables.
- Do not hardcode secrets in `dashboard/` (only `VITE_*` public values belong there).

## Common Failure Cases
1. `VITE_API_BASE` missing or pointing to wrong API domain.
2. Backend CORS allowed origin not matching deployed dashboard origin.
3. Discord OAuth redirect mismatch between backend env and portal config.
4. HTTPS mixed-content issues if API URL is non-HTTPS in production.
