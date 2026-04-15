const BOT_STATUS_DETAIL_MODE_LEGACY = 'legacy';
const BOT_STATUS_DETAIL_MODE_COMPACT = 'compact';
const BOT_STATUS_DETAIL_MODES = Object.freeze([BOT_STATUS_DETAIL_MODE_COMPACT]);

const DEFAULT_STATUS_COMMAND_SETTINGS = Object.freeze({
  detailMode: null,
});

const DEFAULT_GUILD_BOT_SETTINGS = Object.freeze({
  statusCommand: DEFAULT_STATUS_COMMAND_SETTINGS,
});

function createDefaultStatusCommandSettings() {
  return {
    detailMode: DEFAULT_STATUS_COMMAND_SETTINGS.detailMode,
  };
}

function createDefaultGuildBotSettings() {
  return {
    statusCommand: createDefaultStatusCommandSettings(),
  };
}

function normalizeStatusCommandSettings(rawSettings = {}) {
  const rawDetailMode = rawSettings?.detailMode;
  if (rawDetailMode === null || rawDetailMode === undefined) {
    return createDefaultStatusCommandSettings();
  }

  const normalizedDetailMode = String(rawDetailMode || '').trim().toLowerCase();
  if (
    normalizedDetailMode === BOT_STATUS_DETAIL_MODE_LEGACY ||
    !BOT_STATUS_DETAIL_MODES.includes(normalizedDetailMode)
  ) {
    return createDefaultStatusCommandSettings();
  }

  return {
    detailMode: normalizedDetailMode,
  };
}

function normalizeGuildBotSettings(rawSettings = {}) {
  const source =
    rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  return {
    statusCommand: normalizeStatusCommandSettings(source.statusCommand),
  };
}

function createStorageKey({ guildId = '' } = {}) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) return null;
  return normalizedGuildId;
}

function serializeSettingsFingerprint(settings = {}) {
  const normalized = normalizeGuildBotSettings(settings);
  return JSON.stringify({
    statusCommand: normalized.statusCommand,
  });
}

function cloneStoredRecord(record = null) {
  if (!record || typeof record !== 'object') return null;
  return {
    guildId: String(record.guildId || ''),
    actorId: record.actorId ? String(record.actorId) : null,
    settings: normalizeGuildBotSettings(record.settings),
    revision: Number(record.revision || 0),
    updatedAt: String(record.updatedAt || ''),
  };
}

function toEffectiveStatusCommandSettings(settings = {}) {
  const normalizedDomain =
    settings && typeof settings === 'object' && settings.statusCommand
      ? normalizeStatusCommandSettings(settings.statusCommand)
      : normalizeStatusCommandSettings(settings);

  return {
    detailMode:
      normalizedDomain.detailMode === BOT_STATUS_DETAIL_MODE_COMPACT
        ? BOT_STATUS_DETAIL_MODE_COMPACT
        : BOT_STATUS_DETAIL_MODE_LEGACY,
  };
}

function createInMemoryGuildBotSettingsRepository({ nowFn = Date.now } = {}) {
  const store = new Map();

  function resolveNowIso() {
    const nowValue = Number(nowFn());
    const timestamp = Number.isFinite(nowValue) ? nowValue : Date.now();
    return new Date(timestamp).toISOString();
  }

  async function getByGuildId({ guildId = '' } = {}) {
    const key = createStorageKey({ guildId });
    if (!key) return null;
    return cloneStoredRecord(store.get(key));
  }

  async function upsertByGuildId({ guildId = '', actorId = '', patch = {} } = {}) {
    const key = createStorageKey({ guildId });
    if (!key) {
      return {
        applied: false,
        duplicate: false,
        record: null,
      };
    }

    const existing = store.get(key);
    const baseline = existing?.settings
      ? normalizeGuildBotSettings(existing.settings)
      : createDefaultGuildBotSettings();
    const normalizedPatch = patch && typeof patch === 'object' ? patch : {};
    const patchStatusCommand =
      normalizedPatch.statusCommand &&
      typeof normalizedPatch.statusCommand === 'object' &&
      !Array.isArray(normalizedPatch.statusCommand)
        ? normalizedPatch.statusCommand
        : {};
    const nextSettings = normalizeGuildBotSettings({
      ...baseline,
      ...normalizedPatch,
      statusCommand: {
        ...baseline.statusCommand,
        ...patchStatusCommand,
      },
    });

    const nextFingerprint = serializeSettingsFingerprint(nextSettings);
    const existingFingerprint = existing?.fingerprint || null;
    if (existing && existingFingerprint && existingFingerprint === nextFingerprint) {
      return {
        applied: false,
        duplicate: true,
        record: cloneStoredRecord(existing),
      };
    }

    const normalizedActorId = String(actorId || '').trim();
    const nextRecord = {
      guildId: key,
      actorId: normalizedActorId || null,
      settings: nextSettings,
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

  function __resetForTests() {
    store.clear();
  }

  return {
    getByGuildId,
    upsertByGuildId,
    __resetForTests,
  };
}

let sharedBotSettingsRepository = createInMemoryGuildBotSettingsRepository();

function getSharedBotSettingsRepository() {
  return sharedBotSettingsRepository;
}

function setSharedBotSettingsRepositoryForTests(repository = null) {
  const previous = sharedBotSettingsRepository;
  if (repository && typeof repository === 'object') {
    sharedBotSettingsRepository = repository;
    return previous;
  }
  sharedBotSettingsRepository = createInMemoryGuildBotSettingsRepository();
  return previous;
}

async function resolveStatusCommandRuntimeMode({
  guildId = null,
  repository = null,
} = {}) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) return BOT_STATUS_DETAIL_MODE_LEGACY;

  const resolvedRepository =
    repository && typeof repository.getByGuildId === 'function'
      ? repository
      : getSharedBotSettingsRepository();
  if (!resolvedRepository || typeof resolvedRepository.getByGuildId !== 'function') {
    return BOT_STATUS_DETAIL_MODE_LEGACY;
  }

  try {
    const stored = await resolvedRepository.getByGuildId({
      guildId: normalizedGuildId,
    });
    return toEffectiveStatusCommandSettings(stored?.settings).detailMode;
  } catch {
    return BOT_STATUS_DETAIL_MODE_LEGACY;
  }
}

module.exports = {
  BOT_STATUS_DETAIL_MODE_COMPACT,
  BOT_STATUS_DETAIL_MODE_LEGACY,
  BOT_STATUS_DETAIL_MODES,
  DEFAULT_GUILD_BOT_SETTINGS,
  createDefaultGuildBotSettings,
  createDefaultStatusCommandSettings,
  createInMemoryGuildBotSettingsRepository,
  getSharedBotSettingsRepository,
  normalizeGuildBotSettings,
  normalizeStatusCommandSettings,
  resolveStatusCommandRuntimeMode,
  setSharedBotSettingsRepositoryForTests,
  toEffectiveStatusCommandSettings,
};
