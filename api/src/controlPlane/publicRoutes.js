const { createDashboardRouteDefinitions } = require('./dashboardRoutes');
const {
  createRuntimeMetaProvider,
  createCapabilitiesProvider,
  createConfigSummaryProvider,
} = require('./metaProviders');

function toEndpointList(routeDefinitions = []) {
  return routeDefinitions.map(
    (route) => `${String(route?.method || 'GET').toUpperCase()} ${String(route?.path || '')}`
  );
}

function createPublicRouteDefinitions({
  config = {},
  getStartupPhase = () => 'unknown_phase',
  getClientReady = () => false,
  processRef = process,
  startedAtMs = Date.now(),
  getConfiguredStaticGuildIds = () => [],
  getStaticGuildSettings = () => ({}),
  getStaticGuildBindings = () => ({}),
  getPrivateVoiceConfig = () => ({}),
  getTagRoleConfig = () => ({}),
  getStartupVoiceConfig = () => ({}),
  featureGateEvaluator = null,
  preferencesRepository = null,
  botSettingsRepository = null,
  mutationAuditRecorder = null,
  mutationMaxBodyBytes = undefined,
  authRouteDefinitions = [],
  additionalCapabilityEndpoints = [],
} = {}) {
  const dashboardRouteDefinitions = createDashboardRouteDefinitions({
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
    preferencesRepository,
    botSettingsRepository,
    mutationAuditRecorder,
    mutationMaxBodyBytes,
  });

  const dashboardEndpointList = toEndpointList(dashboardRouteDefinitions);
  const authEndpointList = toEndpointList(
    Array.isArray(authRouteDefinitions) ? authRouteDefinitions : []
  );
  const runtimeMetaProvider = createRuntimeMetaProvider({
    config,
    getStartupPhase,
    getClientReady,
    processRef,
    startedAtMs,
  });
  const mutableRoutesEnabled =
    Boolean(config?.controlPlane?.auth?.enabled) &&
    dashboardRouteDefinitions.some((route) => {
      const method = String(route?.method || 'GET').trim().toUpperCase();
      const path = String(route?.path || '').trim();
      return method !== 'GET' && path.startsWith('/api/dashboard/protected/');
    });
  const capabilitiesProvider = createCapabilitiesProvider({
    config,
    mutableRoutesEnabled,
    additionalEndpoints: authEndpointList.concat(dashboardEndpointList).concat(
      Array.isArray(additionalCapabilityEndpoints) ? additionalCapabilityEndpoints : []
    ),
  });
  const configSummaryProvider = createConfigSummaryProvider({
    config,
    getConfiguredStaticGuildIds,
  });

  const routeDefinitions = [
    {
      method: 'GET',
      path: '/api/meta/runtime',
      group: 'meta',
      authMode: 'public_read_only_foundation',
      handler: runtimeMetaProvider,
    },
    {
      method: 'GET',
      path: '/api/meta/capabilities',
      group: 'meta',
      authMode: 'public_read_only_foundation',
      handler: capabilitiesProvider,
    },
    {
      method: 'GET',
      path: '/api/meta/config-summary',
      group: 'meta',
      authMode: 'public_read_only_foundation',
      handler: configSummaryProvider,
    },
  ].concat(Array.isArray(authRouteDefinitions) ? authRouteDefinitions : []).concat(dashboardRouteDefinitions);

  return {
    routeDefinitions,
    endpointList: toEndpointList(routeDefinitions),
  };
}

module.exports = {
  createPublicRouteDefinitions,
  toEndpointList,
};
