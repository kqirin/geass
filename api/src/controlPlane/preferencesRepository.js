const ALLOWED_DASHBOARD_DEFAULT_VIEWS = Object.freeze([
  'overview',
  'guild',
  'features',
  'resources',
  'protected_overview',
]);

const ALLOWED_ADVANCED_LAYOUT_MODES = Object.freeze([
  'focus',
  'split',
]);

const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  defaultView: 'overview',
  compactMode: false,
  dismissedNoticeIds: Object.freeze([]),
  advancedLayoutMode: null,
});

function createDefaultDashboardPreferences() {
  return {
    defaultView: DEFAULT_DASHBOARD_PREFERENCES.defaultView,
    compactMode: DEFAULT_DASHBOARD_PREFERENCES.compactMode,
    dismissedNoticeIds: [],
    advancedLayoutMode: DEFAULT_DASHBOARD_PREFERENCES.advancedLayoutMode,
  };
}

function normalizeDismissedNoticeIds(rawValue) {
  if (!Array.isArray(rawValue)) return [];
  const uniqueIds = new Set();
  const normalized = [];

  for (const entry of rawValue) {
    const value = String(entry || '').trim();
    if (!value) continue;
    if (value.length > 64) continue;
    if (!/^[a-zA-Z0-9_.:-]+$/.test(value)) continue;
    if (uniqueIds.has(value)) continue;
    uniqueIds.add(value);
    normalized.push(value);
    if (normalized.length >= 32) break;
  }

  return normalized;
}

function normalizeDashboardPreferences(rawPreferences = {}) {
  const fallback = createDefaultDashboardPreferences();
  const defaultViewCandidate = String(rawPreferences?.defaultView || '').trim();
  const normalizedDefaultView = ALLOWED_DASHBOARD_DEFAULT_VIEWS.includes(defaultViewCandidate)
    ? defaultViewCandidate
    : fallback.defaultView;
  const advancedLayoutModeCandidate = String(
    rawPreferences?.advancedLayoutMode || ''
  ).trim();
  const normalizedAdvancedLayoutMode =
    ALLOWED_ADVANCED_LAYOUT_MODES.includes(advancedLayoutModeCandidate)
      ? advancedLayoutModeCandidate
      : fallback.advancedLayoutMode;

  return {
    defaultView: normalizedDefaultView,
    compactMode:
      typeof rawPreferences?.compactMode === 'boolean'
        ? rawPreferences.compactMode
        : fallback.compactMode,
    dismissedNoticeIds: normalizeDismissedNoticeIds(rawPreferences?.dismissedNoticeIds),
    advancedLayoutMode: normalizedAdvancedLayoutMode,
  };
}

function createStorageKey({ actorId = '', guildId = '' } = {}) {
  const normalizedActorId = String(actorId || '').trim();
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedActorId || !normalizedGuildId) return null;
  return `${normalizedActorId}:${normalizedGuildId}`;
}

function serializePreferencesFingerprint(preferences = {}) {
  const normalized = normalizeDashboardPreferences(preferences);
  return JSON.stringify({
    defaultView: normalized.defaultView,
    compactMode: normalized.compactMode,
    dismissedNoticeIds: normalized.dismissedNoticeIds,
    advancedLayoutMode: normalized.advancedLayoutMode,
  });
}

function cloneStoredRecord(record = null) {
  if (!record || typeof record !== 'object') return null;
  return {
    actorId: String(record.actorId || ''),
    guildId: String(record.guildId || ''),
    preferences: normalizeDashboardPreferences(record.preferences),
    revision: Number(record.revision || 0),
    updatedAt: String(record.updatedAt || ''),
  };
}

function createInMemoryDashboardPreferencesRepository({
  nowFn = Date.now,
} = {}) {
  const store = new Map();

  function resolveNowIso() {
    const nowValue = Number(nowFn());
    const timestamp = Number.isFinite(nowValue) ? nowValue : Date.now();
    return new Date(timestamp).toISOString();
  }

  async function getByActorAndGuild({ actorId = '', guildId = '' } = {}) {
    const key = createStorageKey({ actorId, guildId });
    if (!key) return null;
    return cloneStoredRecord(store.get(key));
  }

  async function upsertByActorAndGuild({
    actorId = '',
    guildId = '',
    patch = {},
  } = {}) {
    const key = createStorageKey({ actorId, guildId });
    if (!key) {
      return {
        applied: false,
        duplicate: false,
        record: null,
      };
    }

    const existing = store.get(key);
    const baseline = existing?.preferences
      ? normalizeDashboardPreferences(existing.preferences)
      : createDefaultDashboardPreferences();
    const normalizedPatch = patch && typeof patch === 'object' ? patch : {};
    const nextPreferences = normalizeDashboardPreferences({
      ...baseline,
      ...normalizedPatch,
    });

    const nextFingerprint = serializePreferencesFingerprint(nextPreferences);
    const existingFingerprint = existing?.fingerprint || null;
    if (existing && existingFingerprint && existingFingerprint === nextFingerprint) {
      return {
        applied: false,
        duplicate: true,
        record: cloneStoredRecord(existing),
      };
    }

    const nextRecord = {
      actorId: String(actorId || '').trim(),
      guildId: String(guildId || '').trim(),
      preferences: nextPreferences,
      revision: Number(existing?.revision || 0) + 1,
      updatedAt: resolveNowIso(),
      fingerprint: nextFingerprint,
    };
    store.set(key, nextRecord);

    return {
      applied: true,
      duplicate: false,
      record: cloneStoredRecord(nextRecord),
    };
  }

  return {
    getByActorAndGuild,
    upsertByActorAndGuild,
  };
}

module.exports = {
  ALLOWED_ADVANCED_LAYOUT_MODES,
  ALLOWED_DASHBOARD_DEFAULT_VIEWS,
  DEFAULT_DASHBOARD_PREFERENCES,
  createDefaultDashboardPreferences,
  createInMemoryDashboardPreferencesRepository,
  normalizeDashboardPreferences,
};
