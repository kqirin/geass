const {
  getCapabilityDefinition,
  isPlanTierAtLeast,
  listCapabilityDefinitions,
} = require('./planCapabilities');
const {
  ENTITLEMENT_MODEL_VERSION,
  toUnresolvedEntitlement,
} = require('./entitlementResolver');

const FEATURE_GATE_MODEL_VERSION = 1;

function createCapabilityDeniedDecision({
  capabilityKey = '',
  requiredPlan = null,
  active = false,
  gatingMode = 'future_only',
  source = 'unresolved',
  planTier = null,
  reasonCode = 'capability_denied',
} = {}) {
  return {
    key: String(capabilityKey || ''),
    allowed: false,
    requiredPlan: requiredPlan ? String(requiredPlan) : null,
    planTier: planTier ? String(planTier) : null,
    source: String(source || 'unresolved'),
    active: Boolean(active),
    gatingMode: String(gatingMode || 'future_only'),
    reasonCode: String(reasonCode || 'capability_denied'),
  };
}

function evaluateCapabilityAgainstEntitlement({
  capabilityKey = '',
  entitlement = null,
} = {}) {
  const definition = getCapabilityDefinition(capabilityKey);
  if (!definition) {
    return createCapabilityDeniedDecision({
      capabilityKey,
      reasonCode: 'capability_unknown',
      source: String(entitlement?.source || 'unresolved'),
      planTier: entitlement?.planTier || null,
      gatingMode: 'unknown',
      active: false,
      requiredPlan: null,
    });
  }

  if (entitlement?.status !== 'resolved' || !entitlement?.planTier) {
    return createCapabilityDeniedDecision({
      capabilityKey: definition.key,
      requiredPlan: definition.requiredPlan,
      active: definition.active,
      gatingMode: definition.gatingMode,
      source: String(entitlement?.source || 'unresolved'),
      planTier: entitlement?.planTier || null,
      reasonCode: 'entitlement_unresolved',
    });
  }

  if (!definition.active) {
    return createCapabilityDeniedDecision({
      capabilityKey: definition.key,
      requiredPlan: definition.requiredPlan,
      active: definition.active,
      gatingMode: definition.gatingMode,
      source: String(entitlement.source || 'unresolved'),
      planTier: String(entitlement.planTier),
      reasonCode: 'capability_not_active',
    });
  }

  if (!isPlanTierAtLeast(entitlement.planTier, definition.requiredPlan)) {
    return createCapabilityDeniedDecision({
      capabilityKey: definition.key,
      requiredPlan: definition.requiredPlan,
      active: definition.active,
      gatingMode: definition.gatingMode,
      source: String(entitlement.source || 'unresolved'),
      planTier: String(entitlement.planTier),
      reasonCode: 'plan_upgrade_required',
    });
  }

  return {
    key: definition.key,
    allowed: true,
    requiredPlan: String(definition.requiredPlan || ''),
    planTier: String(entitlement.planTier),
    source: String(entitlement.source || 'unresolved'),
    active: Boolean(definition.active),
    gatingMode: String(definition.gatingMode || 'enforced'),
    reasonCode: null,
  };
}

function createUnresolvedFeatureContext({
  guildId = null,
  reasonCode = 'entitlement_unresolved',
  source = 'unresolved',
  nowMs = Date.now(),
} = {}) {
  const entitlement = toUnresolvedEntitlement({
    guildId,
    reasonCode,
    source,
    nowMs,
  });
  const capabilities = {};
  for (const definition of listCapabilityDefinitions()) {
    capabilities[definition.key] = createCapabilityDeniedDecision({
      capabilityKey: definition.key,
      requiredPlan: definition.requiredPlan,
      active: definition.active,
      gatingMode: definition.gatingMode,
      source: entitlement.source,
      planTier: entitlement.planTier,
      reasonCode: 'entitlement_unresolved',
    });
  }

  return {
    modelVersion: FEATURE_GATE_MODEL_VERSION,
    entitlementModelVersion: ENTITLEMENT_MODEL_VERSION,
    guildId: guildId || null,
    entitlement,
    capabilities,
    summary: {
      totalCapabilities: Object.keys(capabilities).length,
      allowedCapabilities: 0,
      deniedCapabilities: Object.keys(capabilities).length,
      activeCapabilities: Object.values(capabilities).filter((entry) => entry.active).length,
    },
    generatedAt: new Date(Number(nowMs) || Date.now()).toISOString(),
  };
}

function createFeatureGateEvaluator({
  entitlementResolver = null,
  nowFn = Date.now,
} = {}) {
  const resolveGuildEntitlement =
    entitlementResolver &&
    typeof entitlementResolver.resolveGuildEntitlement === 'function'
      ? entitlementResolver.resolveGuildEntitlement
      : async ({ guildId = null } = {}) =>
          toUnresolvedEntitlement({
            guildId,
            source: 'unresolved',
            reasonCode: 'entitlement_resolver_missing',
            nowMs: nowFn(),
          });

  function nowMs() {
    const value = Number(nowFn());
    return Number.isFinite(value) ? value : Date.now();
  }

  async function resolveGuildFeatureContext({ guildId = null } = {}) {
    const resolvedAtMs = nowMs();
    let entitlement = null;
    try {
      entitlement = await resolveGuildEntitlement({ guildId });
    } catch {
      return createUnresolvedFeatureContext({
        guildId,
        reasonCode: 'entitlement_resolution_failed',
        source: 'unresolved',
        nowMs: resolvedAtMs,
      });
    }

    if (entitlement?.status !== 'resolved' || !entitlement?.planTier) {
      return createUnresolvedFeatureContext({
        guildId: entitlement?.guildId || guildId || null,
        reasonCode: String(entitlement?.reasonCode || 'entitlement_unresolved'),
        source: String(entitlement?.source || 'unresolved'),
        nowMs: resolvedAtMs,
      });
    }

    const capabilities = {};
    for (const definition of listCapabilityDefinitions()) {
      capabilities[definition.key] = evaluateCapabilityAgainstEntitlement({
        capabilityKey: definition.key,
        entitlement,
      });
    }

    const capabilityValues = Object.values(capabilities);
    const allowedCapabilities = capabilityValues.filter((entry) => entry.allowed).length;

    return {
      modelVersion: FEATURE_GATE_MODEL_VERSION,
      entitlementModelVersion: ENTITLEMENT_MODEL_VERSION,
      guildId: entitlement.guildId || guildId || null,
      entitlement: {
        modelVersion: ENTITLEMENT_MODEL_VERSION,
        status: 'resolved',
        guildId: entitlement.guildId || guildId || null,
        planTier: String(entitlement.planTier),
        source: String(entitlement.source || 'unresolved'),
        reasonCode: null,
        resolvedAt: String(entitlement.resolvedAt || new Date(resolvedAtMs).toISOString()),
      },
      capabilities,
      summary: {
        totalCapabilities: capabilityValues.length,
        allowedCapabilities,
        deniedCapabilities: capabilityValues.length - allowedCapabilities,
        activeCapabilities: capabilityValues.filter((entry) => entry.active).length,
      },
      generatedAt: new Date(resolvedAtMs).toISOString(),
    };
  }

  async function evaluateCapability({ guildId = null, capabilityKey = '' } = {}) {
    const featureContext = await resolveGuildFeatureContext({ guildId });
    const decision =
      featureContext.capabilities[String(capabilityKey || '').trim()] ||
      evaluateCapabilityAgainstEntitlement({
        capabilityKey,
        entitlement: featureContext.entitlement,
      });

    return {
      modelVersion: FEATURE_GATE_MODEL_VERSION,
      guildId: featureContext.guildId,
      entitlement: featureContext.entitlement,
      decision,
      generatedAt: featureContext.generatedAt,
    };
  }

  return {
    evaluateCapability,
    resolveGuildFeatureContext,
  };
}

module.exports = {
  FEATURE_GATE_MODEL_VERSION,
  createFeatureGateEvaluator,
  createUnresolvedFeatureContext,
  evaluateCapabilityAgainstEntitlement,
};
