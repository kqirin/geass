# AURI Architecture

## Backend (`api/src`)
- `interfaces/http`: Express composition, middlewares, route modules.
- `application/security`: security primitives (session signing/verification).
- `infrastructure/repositories`: DB access abstractions.
- `bot`: moderation runtime, command handlers, shared services.
- `bootstrap`: startup validation and process bootstrap helpers.

## Frontend (`dashboard/src`)
- `lib`: shared API client and error helpers.
- `hooks`: page-level orchestration hooks.
- `components/Dashboard`: feature tabs (moderation, messages, embed sender, VC control, weekly staff, reaction rules).
- `components/AppErrorBoundary`: global UI crash boundary.
- `pages`: route screens (`Login`, `Dashboard`).
