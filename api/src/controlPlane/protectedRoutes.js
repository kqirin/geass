const { createRequireGuildAccess, requireAuth, withBoundaryChecks } = require('./authBoundary');
const { resolveDashboardGuildScope } = require('./guildScope');
const { normalizeRequestPath } = require('./router');

const PROTECTED_ROUTE_PREFIX = '/api/control/private';

function isProtectedControlPlanePath(path) {
  const normalizedPath = normalizeRequestPath(path);
  return (
    normalizedPath === PROTECTED_ROUTE_PREFIX ||
    normalizedPath.startsWith(`${PROTECTED_ROUTE_PREFIX}/`)
  );
}

function createProtectedRouteDefinitions({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const requireGuildAccess = createRequireGuildAccess({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });

  return [
    {
      method: 'GET',
      path: '/api/control/private/status',
      group: 'control_plane_private',
      authMode: 'require_auth_placeholder',
      handler: withBoundaryChecks(
        ({ requestContext }) => ({
          contractVersion: 1,
          mode: 'protected_placeholder',
          message: 'Protected control-plane routes are scaffolded but not enabled.',
          requestId: String(requestContext?.requestId || ''),
        }),
        [requireAuth]
      ),
    },
    {
      method: 'GET',
      path: '/api/control/private/guild-access',
      group: 'control_plane_private',
      authMode: 'require_auth_and_guild_access_placeholder',
      handler: withBoundaryChecks(
        ({ requestContext }) => ({
          contractVersion: 1,
          mode: 'protected_placeholder',
          message: 'Guild-scoped protected control-plane routes are scaffolded but not enabled.',
          guildScope: requestContext?.guildScope || null,
          requestId: String(requestContext?.requestId || ''),
        }),
        [requireAuth, requireGuildAccess]
      ),
    },
  ];
}

module.exports = {
  PROTECTED_ROUTE_PREFIX,
  createProtectedRouteDefinitions,
  isProtectedControlPlanePath,
};
