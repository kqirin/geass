# Plan (17 - Deploy Preparation)

## What was added in this phase
- Deployment-safe environment clarification for Railway backend/bot and static dashboard hosting.
- Minimal backend compatibility updates for credentialed cross-origin dashboard traffic:
  - explicit dashboard origin allow-list support
  - CORS preflight handling for API routes
  - cookie safety hardening for `SameSite=None`
- Focused control-plane tests for CORS/cookie behavior.
- Deployment runbooks and environment matrix for local vs production operation modes.

## Why this is the safest next step
- Changes are config- and boundary-layer focused; no moderation command logic or bot action behavior was changed.
- Protected dashboard write routes remain fail-closed.
- No production domain is hardcoded; placeholders and explicit env wiring are used instead.
- Local development defaults remain usable (including localhost dashboard origin defaults in development mode).

## What was intentionally not deployed
- No Railway deployment was executed.
- No dashboard deployment was executed.
- No Discord Developer Portal settings were changed.
- No production secret values were set in this repository.

## What remains for actual production launch
1. Provision real domains/URLs for backend and static dashboard.
2. Set production env vars in Railway and static host.
3. Register exact OAuth redirect URIs in Discord Developer Portal.
4. Run browser-level auth/cookie/CORS smoke tests on real domains.
5. Execute publish/deploy checklist and rollback drill.
