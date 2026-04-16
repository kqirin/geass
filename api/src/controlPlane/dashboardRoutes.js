const {
  createDashboardOverviewProvider,
  createDashboardGuildProvider,
  createDashboardFeaturesProvider,
  createDashboardResourcesProvider,
} = require('./dashboardProviders');
const { createSetupReadinessProvider } = require('./setupReadinessProvider');
const {
  createCommandLogsProvider,
  createModerationLogsProvider,
  createMutationAuditSystemLogSource,
  createSystemLogsProvider,
} = require('./logsProvider');
const {
  createAuthenticatedDashboardContextProvider,
  createDashboardContextFeaturesProvider,
} = require('./authenticatedDashboardContext');
const { createRequireGuildAccess, requireAuth, withBoundaryChecks } = require('./authBoundary');
const { createProtectedDashboardOverviewProvider } = require('./protectedDashboardProvider');
const { createDashboardPreferencesRouteDefinitions } = require('./preferencesRoutes');
const { createDashboardBotStatusSettingsRouteDefinitions } = require('./botSettingsRoutes');
const { resolveDashboardGuildScope } = require('./guildScope');

function createDashboardRouteDefinitions({
  config,
  getStartupPhase = () => 'unknown_phase',
  getClientReady = () => false,
  getConfiguredStaticGuildIds = () => [],
  getStaticGuildSettings = () => ({}),
  getStaticGuildBindings = () => ({}),
  getPrivateVoiceConfig = () => ({}),
  getTagRoleConfig = () => ({}),
  getStartupVoiceConfig = () => ({}),
  featureGateEvaluator = null,
  preferencesRepository = null,
  botSettingsRepository = null,
  moderationLogSource = null,
  commandLogSource = null,
  systemLogSource = null,
  mutationAuditRecorder = null,
  mutationMaxBodyBytes = undefined,
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const overviewProvider = createDashboardOverviewProvider({
    config,
    getStartupPhase,
    getClientReady,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });
  const guildProvider = createDashboardGuildProvider({
    config,
    getConfiguredStaticGuildIds,
    getStaticGuildSettings,
    getStaticGuildBindings,
    resolveGuildScope,
  });
  const featuresProvider = createDashboardFeaturesProvider({
    config,
    getConfiguredStaticGuildIds,
    getStaticGuildSettings,
    getPrivateVoiceConfig,
    getTagRoleConfig,
    getStartupVoiceConfig,
    resolveGuildScope,
  });
  const resourcesProvider = createDashboardResourcesProvider({
    config,
    getConfiguredStaticGuildIds,
    getStaticGuildSettings,
    getStaticGuildBindings,
    resolveGuildScope,
  });
  const authenticatedContextProvider = createAuthenticatedDashboardContextProvider({
    config,
    getConfiguredStaticGuildIds,
    featureGateEvaluator,
    resolveGuildScope,
  });
  const dashboardContextFeaturesProvider = createDashboardContextFeaturesProvider({
    config,
    getConfiguredStaticGuildIds,
    featureGateEvaluator,
    resolveGuildScope,
  });
  const protectedOverviewProvider = createProtectedDashboardOverviewProvider({
    config,
    getStartupPhase,
    getClientReady,
    getConfiguredStaticGuildIds,
    getStaticGuildSettings,
    getStaticGuildBindings,
    getPrivateVoiceConfig,
    getTagRoleConfig,
    getStartupVoiceConfig,
    featureGateEvaluator,
    resolveGuildScope,
  });
  const setupReadinessProvider = createSetupReadinessProvider({
    config,
    getConfiguredStaticGuildIds,
    getStaticGuildSettings,
    getStaticGuildBindings,
    getPrivateVoiceConfig,
    getTagRoleConfig,
    getStartupVoiceConfig,
    resolveGuildScope,
  });
  const moderationLogsProvider = createModerationLogsProvider({
    moderationLogSource,
  });
  const commandLogsProvider = createCommandLogsProvider({
    commandLogSource,
  });
  const resolvedSystemLogSource =
    systemLogSource ||
    createMutationAuditSystemLogSource({
      mutationAuditRecorder,
    });
  const systemLogsProvider = createSystemLogsProvider({
    systemLogSource: resolvedSystemLogSource,
  });
  const requireDashboardGuildAccess = createRequireGuildAccess({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });
  const preferencesRoutes = createDashboardPreferencesRouteDefinitions({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
    featureGateEvaluator,
    preferencesRepository,
    mutationAuditRecorder,
    ...(mutationMaxBodyBytes !== undefined ? { maxBodyBytes: mutationMaxBodyBytes } : {}),
  });
  const preferencesRouteDefinitions = Array.isArray(preferencesRoutes?.routeDefinitions)
    ? preferencesRoutes.routeDefinitions
    : [];
  const botStatusSettingsRoutes = createDashboardBotStatusSettingsRouteDefinitions({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
    botSettingsRepository,
    mutationAuditRecorder,
    ...(mutationMaxBodyBytes !== undefined ? { maxBodyBytes: mutationMaxBodyBytes } : {}),
  });
  const botStatusSettingsRouteDefinitions = Array.isArray(botStatusSettingsRoutes?.routeDefinitions)
    ? botStatusSettingsRoutes.routeDefinitions
    : [];

  return [
    {
      method: 'GET',
      path: '/api/dashboard/overview',
      group: 'dashboard',
      authMode: 'public_read_only_foundation',
      handler: overviewProvider,
    },
    {
      method: 'GET',
      path: '/api/dashboard/guild',
      group: 'dashboard',
      authMode: 'public_read_only_foundation',
      handler: guildProvider,
    },
    {
      method: 'GET',
      path: '/api/dashboard/features',
      group: 'dashboard',
      authMode: 'public_read_only_foundation',
      handler: featuresProvider,
    },
    {
      method: 'GET',
      path: '/api/dashboard/resources',
      group: 'dashboard',
      authMode: 'public_read_only_foundation',
      handler: resourcesProvider,
    },
    {
      method: 'GET',
      path: '/api/dashboard/context',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(authenticatedContextProvider, [requireAuth, requireDashboardGuildAccess]),
    },
    {
      method: 'GET',
      path: '/api/dashboard/context/features',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(dashboardContextFeaturesProvider, [requireAuth, requireDashboardGuildAccess]),
    },
    {
      method: 'GET',
      path: '/api/dashboard/protected/overview',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(protectedOverviewProvider, [requireAuth, requireDashboardGuildAccess]),
    },
    {
      method: 'GET',
      path: '/api/dashboard/protected/setup-readiness',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(setupReadinessProvider, [requireAuth, requireDashboardGuildAccess]),
    },
    {
      method: 'GET',
      path: '/api/dashboard/protected/logs/moderation',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(moderationLogsProvider, [requireAuth, requireDashboardGuildAccess]),
    },
    {
      method: 'GET',
      path: '/api/dashboard/protected/logs/commands',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(commandLogsProvider, [requireAuth, requireDashboardGuildAccess]),
    },
    {
      method: 'GET',
      path: '/api/dashboard/protected/logs/system',
      group: 'dashboard',
      authMode: 'require_auth_and_guild_access_read_only',
      handler: withBoundaryChecks(systemLogsProvider, [requireAuth, requireDashboardGuildAccess]),
    },
  ]
    .concat(preferencesRouteDefinitions)
    .concat(botStatusSettingsRouteDefinitions);
}

module.exports = {
  createDashboardRouteDefinitions,
};
