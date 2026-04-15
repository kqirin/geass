const { normalizeGuildId } = require('./guildScope');
const { isKnownPlanTier, normalizePlanTier, PLAN_TIERS } = require('./planCapabilities');

const ENTITLEMENT_MODEL_VERSION = 1;

function normalizeManualPlanOverrides(overrides = {}) {
  const normalized = {};
  const entries =
    overrides && typeof overrides === 'object' ? Object.entries(overrides) : [];
  for (const [rawGuildId, rawPlanTier] of entries) {
    const guildId = normalizeGuildId(rawGuildId);
    if (!guildId) continue;
    const planTier = normalizePlanTier(rawPlanTier, null);
    if (!planTier) continue;
    normalized[guildId] = planTier;
  }
  return normalized;
}

function toUnresolvedEntitlement({
  guildId = null,
  source = 'unresolved',
  reasonCode = 'entitlement_unresolved',
  nowMs = Date.now(),
} = {}) {
  return {
    modelVersion: ENTITLEMENT_MODEL_VERSION,
    status: 'unresolved',
    guildId: guildId || null,
    planTier: null,
    source: String(source || 'unresolved'),
    reasonCode: String(reasonCode || 'entitlement_unresolved'),
    resolvedAt: new Date(Number(nowMs) || Date.now()).toISOString(),
  };
}

function toResolvedEntitlement({
  guildId = null,
  planTier = PLAN_TIERS.FREE,
  source = 'config_default',
  nowMs = Date.now(),
} = {}) {
  return {
    modelVersion: ENTITLEMENT_MODEL_VERSION,
    status: 'resolved',
    guildId: guildId || null,
    planTier: String(planTier || PLAN_TIERS.FREE),
    source: String(source || 'config_default'),
    reasonCode: null,
    resolvedAt: new Date(Number(nowMs) || Date.now()).toISOString(),
  };
}

function createGuildEntitlementResolver({
  config = {},
  guildPlanRepository = null,
  nowFn = Date.now,
} = {}) {
  const defaultPlanRaw = String(
    config?.controlPlane?.premium?.defaultPlan ?? PLAN_TIERS.FREE
  )
    .trim()
    .toLowerCase();
  const defaultPlanTier = isKnownPlanTier(defaultPlanRaw) ? defaultPlanRaw : null;
  const manualOverrides = normalizeManualPlanOverrides(
    config?.controlPlane?.premium?.manualPlanOverrides
  );

  function nowMs() {
    const value = Number(nowFn());
    return Number.isFinite(value) ? value : Date.now();
  }

  async function resolveGuildEntitlement({ guildId = null } = {}) {
    const normalizedGuildId = normalizeGuildId(guildId);
    const timestampMs = nowMs();

    if (!normalizedGuildId) {
      return toUnresolvedEntitlement({
        guildId: null,
        source: 'unresolved',
        reasonCode: 'guild_id_required',
        nowMs: timestampMs,
      });
    }

    const manualPlanTier = manualOverrides[normalizedGuildId];
    if (manualPlanTier) {
      return toResolvedEntitlement({
        guildId: normalizedGuildId,
        planTier: manualPlanTier,
        source: 'config_manual_override',
        nowMs: timestampMs,
      });
    }

    if (
      guildPlanRepository &&
      typeof guildPlanRepository.getGuildPlanRecord === 'function'
    ) {
      const record = await guildPlanRepository.getGuildPlanRecord({
        guildId: normalizedGuildId,
      });
      if (record) {
        const recordPlanTier = normalizePlanTier(record?.planTier, null);
        if (!recordPlanTier) {
          return toUnresolvedEntitlement({
            guildId: normalizedGuildId,
            source: 'repository',
            reasonCode: 'repository_plan_invalid',
            nowMs: timestampMs,
          });
        }

        return toResolvedEntitlement({
          guildId: normalizedGuildId,
          planTier: recordPlanTier,
          source: 'repository',
          nowMs: timestampMs,
        });
      }
    }

    if (defaultPlanTier) {
      return toResolvedEntitlement({
        guildId: normalizedGuildId,
        planTier: defaultPlanTier,
        source: 'config_default',
        nowMs: timestampMs,
      });
    }

    return toUnresolvedEntitlement({
      guildId: normalizedGuildId,
      source: 'config_default',
      reasonCode: 'default_plan_invalid',
      nowMs: timestampMs,
    });
  }

  return {
    resolveGuildEntitlement,
  };
}

module.exports = {
  ENTITLEMENT_MODEL_VERSION,
  createGuildEntitlementResolver,
  normalizeManualPlanOverrides,
  toResolvedEntitlement,
  toUnresolvedEntitlement,
};
