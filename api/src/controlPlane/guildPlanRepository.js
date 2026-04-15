const { normalizeGuildId } = require('./guildScope');
const { normalizePlanTier } = require('./planCapabilities');

function clonePlanRecord(record = null) {
  if (!record || typeof record !== 'object') return null;
  return {
    guildId: String(record.guildId || ''),
    planTier: String(record.planTier || ''),
    source: String(record.source || 'repository'),
    updatedAt: String(record.updatedAt || ''),
  };
}

function normalizeSeedRecords(seedRecords = {}) {
  const output = {};
  const entries =
    seedRecords && typeof seedRecords === 'object' ? Object.entries(seedRecords) : [];

  for (const [guildId, rawPlan] of entries) {
    const normalizedGuildId = normalizeGuildId(guildId);
    if (!normalizedGuildId) continue;
    const normalizedPlanTier = normalizePlanTier(rawPlan, null);
    if (!normalizedPlanTier) continue;
    output[normalizedGuildId] = normalizedPlanTier;
  }

  return output;
}

function createInMemoryGuildPlanRepository({
  seedRecords = {},
  nowFn = Date.now,
} = {}) {
  const store = new Map();
  const normalizedSeeds = normalizeSeedRecords(seedRecords);
  const seededAt = new Date(Number(nowFn()) || Date.now()).toISOString();

  for (const [guildId, planTier] of Object.entries(normalizedSeeds)) {
    store.set(guildId, {
      guildId,
      planTier,
      source: 'repository_seed',
      updatedAt: seededAt,
    });
  }

  function nowIso() {
    const nowValue = Number(nowFn());
    const nowMs = Number.isFinite(nowValue) ? nowValue : Date.now();
    return new Date(nowMs).toISOString();
  }

  async function getGuildPlanRecord({ guildId = null } = {}) {
    const normalizedGuildId = normalizeGuildId(guildId);
    if (!normalizedGuildId) return null;
    return clonePlanRecord(store.get(normalizedGuildId));
  }

  async function setGuildPlanRecord({
    guildId = null,
    planTier = null,
    source = 'repository_manual',
  } = {}) {
    const normalizedGuildId = normalizeGuildId(guildId);
    const normalizedPlanTier = normalizePlanTier(planTier, null);
    if (!normalizedGuildId || !normalizedPlanTier) {
      return {
        applied: false,
        record: null,
      };
    }

    const nextRecord = {
      guildId: normalizedGuildId,
      planTier: normalizedPlanTier,
      source: String(source || 'repository_manual'),
      updatedAt: nowIso(),
    };
    store.set(normalizedGuildId, nextRecord);
    return {
      applied: true,
      record: clonePlanRecord(nextRecord),
    };
  }

  return {
    getGuildPlanRecord,
    setGuildPlanRecord,
  };
}

module.exports = {
  createInMemoryGuildPlanRepository,
};
