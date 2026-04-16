const BOT_STATUS_DETAIL_MODE_LEGACY = 'legacy';
const BOT_STATUS_DETAIL_MODE_COMPACT = 'compact';
const BOT_STATUS_DETAIL_MODES = Object.freeze([BOT_STATUS_DETAIL_MODE_COMPACT]);
const BOT_COMMAND_KEY_DURUM = 'durum';

const DEFAULT_STATUS_COMMAND_SETTINGS = Object.freeze({
  detailMode: null,
});

const DEFAULT_DURUM_COMMAND_SETTINGS = Object.freeze({
  enabled: null,
  detailMode: null,
});

const DEFAULT_COMMAND_SETTINGS = Object.freeze({
  [BOT_COMMAND_KEY_DURUM]: DEFAULT_DURUM_COMMAND_SETTINGS,
});

const DEFAULT_GUILD_BOT_SETTINGS = Object.freeze({
  statusCommand: DEFAULT_STATUS_COMMAND_SETTINGS,
  commands: DEFAULT_COMMAND_SETTINGS,
});

function createDefaultStatusCommandSettings() {
  return {
    detailMode: DEFAULT_STATUS_COMMAND_SETTINGS.detailMode,
  };
}

function createDefaultDurumCommandSettings() {
  return {
    enabled: DEFAULT_DURUM_COMMAND_SETTINGS.enabled,
    detailMode: DEFAULT_DURUM_COMMAND_SETTINGS.detailMode,
  };
}

function createDefaultCommandSettings() {
  return {
    [BOT_COMMAND_KEY_DURUM]: createDefaultDurumCommandSettings(),
  };
}

function createDefaultGuildBotSettings() {
  return {
    statusCommand: createDefaultStatusCommandSettings(),
    commands: createDefaultCommandSettings(),
  };
}

function toNormalizedOptionalDetailMode(rawDetailMode) {
  if (rawDetailMode === null || rawDetailMode === undefined) return null;

  const normalizedDetailMode = String(rawDetailMode || '').trim().toLowerCase();
  if (
    normalizedDetailMode === BOT_STATUS_DETAIL_MODE_LEGACY ||
    !BOT_STATUS_DETAIL_MODES.includes(normalizedDetailMode)
  ) {
    return null;
  }
  return normalizedDetailMode;
}

function normalizeStatusCommandSettings(rawSettings = {}) {
  return {
    detailMode: toNormalizedOptionalDetailMode(rawSettings?.detailMode),
  };
}

function normalizeDurumCommandSettings(rawSettings = {}) {
  const rawEnabled = rawSettings?.enabled;
  const normalizedEnabled =
    typeof rawEnabled === 'boolean' ? rawEnabled : null;

  return {
    enabled: normalizedEnabled,
    detailMode: toNormalizedOptionalDetailMode(rawSettings?.detailMode),
  };
}

function normalizeCommandSettings(rawSettings = {}) {
  const source =
    rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  return {
    [BOT_COMMAND_KEY_DURUM]: normalizeDurumCommandSettings(
      source[BOT_COMMAND_KEY_DURUM]
    ),
  };
}

function normalizeGuildBotSettings(rawSettings = {}) {
  const source =
    rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  return {
    statusCommand: normalizeStatusCommandSettings(source.statusCommand),
    commands: normalizeCommandSettings(source.commands),
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
    commands: normalized.commands,
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

function toEffectiveDurumCommandSettings(settings = {}) {
  const normalizedStatusDomain =
    settings && typeof settings === 'object' && settings.statusCommand
      ? normalizeStatusCommandSettings(settings.statusCommand)
      : normalizeStatusCommandSettings(settings);
  const normalizedDurumCommand =
    settings && typeof settings === 'object' && settings.commands
      ? normalizeDurumCommandSettings(settings?.commands?.[BOT_COMMAND_KEY_DURUM])
      : createDefaultDurumCommandSettings();

  const detailMode =
    normalizedDurumCommand.detailMode === BOT_STATUS_DETAIL_MODE_COMPACT
      ? BOT_STATUS_DETAIL_MODE_COMPACT
      : normalizedStatusDomain.detailMode === BOT_STATUS_DETAIL_MODE_COMPACT
        ? BOT_STATUS_DETAIL_MODE_COMPACT
        : BOT_STATUS_DETAIL_MODE_LEGACY;
  const enabled =
    typeof normalizedDurumCommand.enabled === 'boolean'
      ? normalizedDurumCommand.enabled
      : true;

  return {
    enabled,
    detailMode,
  };
}

function toEffectiveStatusCommandSettings(settings = {}) {
  const normalizedDurumSettings = toEffectiveDurumCommandSettings(settings);
  return {
    detailMode: normalizedDurumSettings.detailMode,
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
    const patchCommands =
      normalizedPatch.commands &&
      typeof normalizedPatch.commands === 'object' &&
      !Array.isArray(normalizedPatch.commands)
        ? normalizedPatch.commands
        : {};
    const patchDurumCommand =
      patchCommands[BOT_COMMAND_KEY_DURUM] &&
      typeof patchCommands[BOT_COMMAND_KEY_DURUM] === 'object' &&
      !Array.isArray(patchCommands[BOT_COMMAND_KEY_DURUM])
        ? patchCommands[BOT_COMMAND_KEY_DURUM]
        : {};

    const nextSettings = normalizeGuildBotSettings({
      ...baseline,
      ...normalizedPatch,
      statusCommand: {
        ...baseline.statusCommand,
        ...patchStatusCommand,
      },
      commands: {
        ...baseline.commands,
        ...patchCommands,
        [BOT_COMMAND_KEY_DURUM]: {
          ...baseline.commands[BOT_COMMAND_KEY_DURUM],
          ...patchDurumCommand,
        },
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

async function resolveDurumCommandRuntimeSettings({
  guildId = null,
  repository = null,
} = {}) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) {
    return {
      enabled: true,
      detailMode: BOT_STATUS_DETAIL_MODE_LEGACY,
    };
  }

  const resolvedRepository =
    repository && typeof repository.getByGuildId === 'function'
      ? repository
      : getSharedBotSettingsRepository();
  if (!resolvedRepository || typeof resolvedRepository.getByGuildId !== 'function') {
    return {
      enabled: true,
      detailMode: BOT_STATUS_DETAIL_MODE_LEGACY,
    };
  }

  try {
    const stored = await resolvedRepository.getByGuildId({
      guildId: normalizedGuildId,
    });
    return toEffectiveDurumCommandSettings(stored?.settings);
  } catch {
    return {
      enabled: true,
      detailMode: BOT_STATUS_DETAIL_MODE_LEGACY,
    };
  }
}

async function resolveStatusCommandRuntimeMode({
  guildId = null,
  repository = null,
} = {}) {
  const runtimeSettings = await resolveDurumCommandRuntimeSettings({
    guildId,
    repository,
  });
  return runtimeSettings.detailMode;
}

module.exports = {
  BOT_COMMAND_KEY_DURUM,
  BOT_STATUS_DETAIL_MODE_COMPACT,
  BOT_STATUS_DETAIL_MODE_LEGACY,
  BOT_STATUS_DETAIL_MODES,
  DEFAULT_GUILD_BOT_SETTINGS,
  createDefaultCommandSettings,
  createDefaultDurumCommandSettings,
  createDefaultGuildBotSettings,
  createDefaultStatusCommandSettings,
  createInMemoryGuildBotSettingsRepository,
  getSharedBotSettingsRepository,
  normalizeCommandSettings,
  normalizeDurumCommandSettings,
  normalizeGuildBotSettings,
  normalizeStatusCommandSettings,
  resolveDurumCommandRuntimeSettings,
  resolveStatusCommandRuntimeMode,
  setSharedBotSettingsRepositoryForTests,
  toEffectiveDurumCommandSettings,
  toEffectiveStatusCommandSettings,
};
