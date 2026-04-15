const {
  createDashboardFeaturesProvider,
  createDashboardGuildProvider,
  createDashboardOverviewProvider,
  createDashboardResourcesProvider,
} = require('./dashboardProviders');
const { toPublicPrincipal } = require('./authRoutes');
const { createCapabilitiesProvider, createRuntimeMetaProvider } = require('./metaProviders');
const { resolveDashboardGuildScope } = require('./guildScope');

function toSafeGuildScopeSummary(guildScope = {}, requestGuildScope = {}) {
  const requestReasonCode =
    requestGuildScope?.reasonCode === undefined || requestGuildScope?.reasonCode === null
      ? null
      : String(requestGuildScope.reasonCode || '').trim() || null;
  const scopeReasonCode = String(guildScope?.reasonCode || '').trim() || null;

  return {
    mode: String(guildScope?.mode || 'unscoped'),
    valid: guildScope?.valid !== false,
    reasonCode: requestReasonCode !== null ? requestReasonCode : scopeReasonCode,
    guildId: String(requestGuildScope?.guildId || guildScope?.guildId || '') || null,
    requestedGuildId: String(guildScope?.requestedGuildId || '') || null,
    hasAuthoritativeGuild: Boolean(guildScope?.hasAuthoritativeGuild),
    configuredStaticGuildCount: Number(guildScope?.configuredStaticGuildCount || 0),
    hasConfiguredStaticGuild: Boolean(guildScope?.hasConfiguredStaticGuild),
  };
}

async function resolveFeatureGateContext({
  featureGateEvaluator = null,
  guildId = null,
} = {}) {
  if (
    !featureGateEvaluator ||
    typeof featureGateEvaluator.resolveGuildFeatureContext !== 'function'
  ) {
    return {
      modelVersion: 1,
      entitlementModelVersion: 1,
      guildId: String(guildId || '') || null,
      entitlement: {
        modelVersion: 1,
        status: 'unresolved',
        guildId: String(guildId || '') || null,
        planTier: null,
        source: 'unresolved',
        reasonCode: 'feature_gate_evaluator_unavailable',
      },
      capabilities: {},
      summary: {
        totalCapabilities: 0,
        allowedCapabilities: 0,
        deniedCapabilities: 0,
        activeCapabilities: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  try {
    return await featureGateEvaluator.resolveGuildFeatureContext({ guildId });
  } catch {
    return {
      modelVersion: 1,
      entitlementModelVersion: 1,
      guildId: String(guildId || '') || null,
      entitlement: {
        modelVersion: 1,
        status: 'unresolved',
        guildId: String(guildId || '') || null,
        planTier: null,
        source: 'unresolved',
        reasonCode: 'entitlement_resolution_failed',
      },
      capabilities: {},
      summary: {
        totalCapabilities: 0,
        allowedCapabilities: 0,
        deniedCapabilities: 0,
        activeCapabilities: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

function createProtectedDashboardOverviewProvider({
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
  const runtimeMetaProvider = createRuntimeMetaProvider({
    config,
    getStartupPhase,
    getClientReady,
    processRef,
    startedAtMs,
  });
  const capabilitiesProvider = createCapabilitiesProvider({
    config,
    mutableRoutesEnabled: true,
  });

  return async function getProtectedDashboardOverview({ query = {}, authContext = {}, requestContext = {} } = {}) {
    const overview = overviewProvider({ query });
    const guild = guildProvider({ query });
    const features = featuresProvider({ query });
    const resources = resourcesProvider({ query });
    const runtimeMeta = runtimeMetaProvider();
    const capabilities = capabilitiesProvider();
    const requestGuildScope =
      requestContext?.guildScope && typeof requestContext.guildScope === 'object'
        ? requestContext.guildScope
        : {};
    const guildScope = toSafeGuildScopeSummary(guild?.guildScope || {}, requestGuildScope);
    const featureGateContext = await resolveFeatureGateContext({
      featureGateEvaluator,
      guildId: guildScope.guildId,
    });

    return {
      contractVersion: 1,
      mode: 'protected_read_only_overview',
      requestId: String(requestContext?.requestId || ''),
      principal: toPublicPrincipal(authContext?.principal),
      access: {
        allowed: requestGuildScope?.access === 'allowed',
        accessLevel: String(requestGuildScope?.accessLevel || 'authenticated_no_guild_access'),
        guildId: guildScope.guildId,
      },
      guildScope,
      guild: guild?.guild || null,
      runtime: {
        nodeEnv: String(runtimeMeta?.nodeEnv || 'development'),
        startupPhase: String(runtimeMeta?.startupPhase || 'unknown_phase'),
        discordGatewayReady: Boolean(runtimeMeta?.discordGatewayReady),
        controlPlaneEnabled: Boolean(runtimeMeta?.controlPlaneEnabled),
        controlPlaneAuthEnabled: Boolean(runtimeMeta?.controlPlaneAuthEnabled),
        controlPlaneAuthConfigured: Boolean(runtimeMeta?.controlPlaneAuthConfigured),
      },
      capabilities: {
        mutableRoutesEnabled: Boolean(capabilities?.mutableRoutesEnabled),
        authEnabled: Boolean(capabilities?.authEnabled),
        authConfigured: Boolean(capabilities?.authConfigured),
        authRequiredForProtectedRoutes: Boolean(capabilities?.authRequiredForProtectedRoutes),
      },
      plan: {
        status: String(featureGateContext?.entitlement?.status || 'unresolved'),
        tier: String(featureGateContext?.entitlement?.planTier || '') || null,
        source: String(featureGateContext?.entitlement?.source || 'unresolved'),
        reasonCode:
          featureGateContext?.entitlement?.reasonCode === undefined ||
          featureGateContext?.entitlement?.reasonCode === null
            ? null
            : String(featureGateContext.entitlement.reasonCode || '') || null,
      },
      featureGate: {
        modelVersion: Number(featureGateContext?.modelVersion || 1),
        entitlementModelVersion: Number(featureGateContext?.entitlementModelVersion || 1),
        capabilitySummary: featureGateContext?.summary || {
          totalCapabilities: 0,
          allowedCapabilities: 0,
          deniedCapabilities: 0,
          activeCapabilities: 0,
        },
      },
      features: features?.features || {},
      resources: resources?.resources || {},
      generatedAt: String(overview?.now || new Date().toISOString()),
    };
  };
}

module.exports = {
  createProtectedDashboardOverviewProvider,
};
