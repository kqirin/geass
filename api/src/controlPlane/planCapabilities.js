const PLAN_TIERS = Object.freeze({
  FREE: 'free',
  PRO: 'pro',
  BUSINESS: 'business',
});

const PLAN_TIER_ORDER = Object.freeze([
  PLAN_TIERS.FREE,
  PLAN_TIERS.PRO,
  PLAN_TIERS.BUSINESS,
]);

const CAPABILITY_KEYS = Object.freeze({
  PROTECTED_DASHBOARD: 'protected_dashboard',
  DASHBOARD_PREFERENCES_READ: 'dashboard_preferences_read',
  DASHBOARD_PREFERENCES_WRITE: 'dashboard_preferences_write',
  ADVANCED_DASHBOARD_PREFERENCES: 'advanced_dashboard_preferences',
  FUTURE_REACTION_RULES_WRITE: 'future_reaction_rules_write',
  FUTURE_PRIVATE_ROOM_ADVANCED: 'future_private_room_advanced',
  FUTURE_MODERATION_WRITE: 'future_moderation_write',
});

const CAPABILITY_DEFINITIONS = Object.freeze({
  [CAPABILITY_KEYS.PROTECTED_DASHBOARD]: Object.freeze({
    key: CAPABILITY_KEYS.PROTECTED_DASHBOARD,
    requiredPlan: PLAN_TIERS.FREE,
    active: true,
    gatingMode: 'enforced',
  }),
  [CAPABILITY_KEYS.DASHBOARD_PREFERENCES_READ]: Object.freeze({
    key: CAPABILITY_KEYS.DASHBOARD_PREFERENCES_READ,
    requiredPlan: PLAN_TIERS.FREE,
    active: true,
    gatingMode: 'enforced',
  }),
  [CAPABILITY_KEYS.DASHBOARD_PREFERENCES_WRITE]: Object.freeze({
    key: CAPABILITY_KEYS.DASHBOARD_PREFERENCES_WRITE,
    requiredPlan: PLAN_TIERS.FREE,
    active: true,
    gatingMode: 'enforced',
  }),
  [CAPABILITY_KEYS.ADVANCED_DASHBOARD_PREFERENCES]: Object.freeze({
    key: CAPABILITY_KEYS.ADVANCED_DASHBOARD_PREFERENCES,
    requiredPlan: PLAN_TIERS.PRO,
    active: true,
    gatingMode: 'enforced',
  }),
  [CAPABILITY_KEYS.FUTURE_REACTION_RULES_WRITE]: Object.freeze({
    key: CAPABILITY_KEYS.FUTURE_REACTION_RULES_WRITE,
    requiredPlan: PLAN_TIERS.PRO,
    active: false,
    gatingMode: 'future_only',
  }),
  [CAPABILITY_KEYS.FUTURE_PRIVATE_ROOM_ADVANCED]: Object.freeze({
    key: CAPABILITY_KEYS.FUTURE_PRIVATE_ROOM_ADVANCED,
    requiredPlan: PLAN_TIERS.BUSINESS,
    active: false,
    gatingMode: 'future_only',
  }),
  [CAPABILITY_KEYS.FUTURE_MODERATION_WRITE]: Object.freeze({
    key: CAPABILITY_KEYS.FUTURE_MODERATION_WRITE,
    requiredPlan: PLAN_TIERS.BUSINESS,
    active: false,
    gatingMode: 'future_only',
  }),
});

function isKnownPlanTier(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PLAN_TIER_ORDER.includes(normalized);
}

function normalizePlanTier(value, fallback = PLAN_TIERS.FREE) {
  const normalized = String(value || '').trim().toLowerCase();
  if (isKnownPlanTier(normalized)) return normalized;
  if (fallback === null || fallback === undefined) return null;

  const normalizedFallback = String(fallback || '').trim().toLowerCase();
  if (isKnownPlanTier(normalizedFallback)) return normalizedFallback;
  return PLAN_TIERS.FREE;
}

function getPlanTierRank(value) {
  const normalized = normalizePlanTier(value, null);
  if (!normalized) return -1;
  return PLAN_TIER_ORDER.indexOf(normalized);
}

function isPlanTierAtLeast(planTier, requiredPlanTier) {
  const currentRank = getPlanTierRank(planTier);
  const requiredRank = getPlanTierRank(requiredPlanTier);
  if (currentRank < 0 || requiredRank < 0) return false;
  return currentRank >= requiredRank;
}

function getCapabilityDefinition(capabilityKey = '') {
  const normalizedKey = String(capabilityKey || '').trim();
  return CAPABILITY_DEFINITIONS[normalizedKey] || null;
}

function listCapabilityDefinitions() {
  return Object.values(CAPABILITY_DEFINITIONS);
}

function listCapabilityKeys() {
  return Object.keys(CAPABILITY_DEFINITIONS);
}

module.exports = {
  CAPABILITY_DEFINITIONS,
  CAPABILITY_KEYS,
  PLAN_TIER_ORDER,
  PLAN_TIERS,
  getCapabilityDefinition,
  getPlanTierRank,
  isKnownPlanTier,
  isPlanTierAtLeast,
  listCapabilityDefinitions,
  listCapabilityKeys,
  normalizePlanTier,
};
