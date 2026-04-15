const { evaluateGuildAccessPolicy } = require('./guildAccessPolicy');
const { toPublicPrincipal } = require('./authRoutes');
const {
  summarizePrincipalGuildAccess,
  toPublicGuildSummaries,
} = require('./authGuildProviders');
const { resolveDashboardGuildScope } = require('./guildScope');

function normalizeQueryGuildId(query = {}) {
  if (!query || typeof query !== 'object') return null;
  const value = Array.isArray(query.guildId) ? query.guildId[0] : query.guildId;
  return String(value || '').trim() || null;
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

function toSafeFeatureGateSummary(featureContext = {}) {
  return {
    modelVersion: Number(featureContext?.modelVersion || 1),
    entitlementModelVersion: Number(featureContext?.entitlementModelVersion || 1),
    entitlement: {
      status: String(featureContext?.entitlement?.status || 'unresolved'),
      tier: String(featureContext?.entitlement?.planTier || '') || null,
      source: String(featureContext?.entitlement?.source || 'unresolved'),
      reasonCode:
        featureContext?.entitlement?.reasonCode === undefined ||
        featureContext?.entitlement?.reasonCode === null
          ? null
          : String(featureContext.entitlement.reasonCode || '') || null,
    },
    summary: featureContext?.summary || {
      totalCapabilities: 0,
      allowedCapabilities: 0,
      deniedCapabilities: 0,
      activeCapabilities: 0,
    },
    generatedAt: String(featureContext?.generatedAt || new Date().toISOString()),
  };
}

function createAuthenticatedDashboardContextProvider({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  featureGateEvaluator = null,
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const guildScopeResolver =
    typeof resolveGuildScope === 'function' ? resolveGuildScope : resolveDashboardGuildScope;

  return async function getAuthenticatedDashboardContext({ authContext = {}, requestContext = {}, query = {} } = {}) {
    const access = evaluateGuildAccessPolicy({
      authContext,
      principal: authContext?.principal,
      requestedGuildId: normalizeQueryGuildId(query),
      config,
      getConfiguredStaticGuildIds,
      resolveGuildScope: guildScopeResolver,
    });
    const guildSummary = summarizePrincipalGuildAccess(authContext?.principal);
    const featureContext = await resolveFeatureGateContext({
      featureGateEvaluator,
      guildId: access.targetGuildId,
    });

    return {
      contractVersion: 1,
      mode: 'authenticated_read_only',
      requestId: String(requestContext?.requestId || ''),
      principal: toPublicPrincipal(authContext?.principal),
      guildScope: access.scope,
      access: {
        allowed: access.allowed,
        accessLevel: access.accessLevel,
        targetGuildId: access.targetGuildId,
      },
      guild: access.guild,
      principalGuilds: {
        summary: {
          guildCount: guildSummary.guildCount,
          operatorGuildCount: guildSummary.operatorGuildCount,
        },
        entries: toPublicGuildSummaries(authContext?.principal),
      },
      featureGate: toSafeFeatureGateSummary(featureContext),
    };
  };
}

function createDashboardContextFeaturesProvider({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  featureGateEvaluator = null,
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const guildScopeResolver =
    typeof resolveGuildScope === 'function' ? resolveGuildScope : resolveDashboardGuildScope;

  return async function getDashboardContextFeatures({
    authContext = {},
    requestContext = {},
    query = {},
  } = {}) {
    const access = evaluateGuildAccessPolicy({
      authContext,
      principal: authContext?.principal,
      requestedGuildId: normalizeQueryGuildId(query),
      config,
      getConfiguredStaticGuildIds,
      resolveGuildScope: guildScopeResolver,
    });
    const featureContext = await resolveFeatureGateContext({
      featureGateEvaluator,
      guildId: access.targetGuildId,
    });

    return {
      contractVersion: 1,
      mode: 'authenticated_feature_gate_context',
      requestId: String(requestContext?.requestId || ''),
      guildScope: access.scope,
      access: {
        allowed: access.allowed,
        accessLevel: access.accessLevel,
        targetGuildId: access.targetGuildId,
      },
      plan: {
        status: String(featureContext?.entitlement?.status || 'unresolved'),
        tier: String(featureContext?.entitlement?.planTier || '') || null,
        source: String(featureContext?.entitlement?.source || 'unresolved'),
        reasonCode:
          featureContext?.entitlement?.reasonCode === undefined ||
          featureContext?.entitlement?.reasonCode === null
            ? null
            : String(featureContext.entitlement.reasonCode || '') || null,
      },
      capabilities: featureContext?.capabilities || {},
      capabilitySummary: featureContext?.summary || {
        totalCapabilities: 0,
        allowedCapabilities: 0,
        deniedCapabilities: 0,
        activeCapabilities: 0,
      },
      generatedAt: String(featureContext?.generatedAt || new Date().toISOString()),
    };
  };
}

module.exports = {
  createDashboardContextFeaturesProvider,
  createAuthenticatedDashboardContextProvider,
};
