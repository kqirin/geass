# Change Log

## Backend
- Added `api/src/controlPlane/setupReadinessProvider.js`.
- Added protected read-only route wiring in `api/src/controlPlane/dashboardRoutes.js`:
  - `GET /api/dashboard/protected/setup-readiness`

## Backend Tests
- Added `api/test/setupReadiness.route.test.js` with auth/access/payload/read-only checks.
- Updated `api/test/controlPlane.cors.test.js` to include setup-readiness CORS coverage.
- Updated `api/test/controlPlane.auth-handoff.test.js` with Bearer-token setup-readiness coverage.
- Updated `api/test/controlPlane.server.test.js` endpoint capability assertions.

## Dashboard
- Added setup-readiness route client in `dashboard/src/lib/apiClient.js`.
- Added setup-readiness view-model helpers in `dashboard/src/lib/setupReadinessViewModel.js`.
- Updated `dashboard/src/hooks/useDashboardData.js` to load setup readiness in protected snapshot and keep safe error fallback.
- Updated `dashboard/src/pages/Dashboard.jsx` with `Kurulum Durumu` section (read-only).

## Dashboard Tests
- Updated `dashboard/test/useDashboardData.test.js` for setup-readiness snapshot behavior.
- Added `dashboard/test/setupReadinessViewModel.test.js`.
- Added `dashboard/test/setupReadinessSection.test.js`.

## Docs
- Added planning/contract/check/final-status docs under `docs/premium-upgrade/18-setup-readiness/`.
