const MESSAGE_AUTOMATION_MODULE_WELCOME = 'welcome';
const MESSAGE_AUTOMATION_MODULE_GOODBYE = 'goodbye';
const MESSAGE_AUTOMATION_MODULE_BOOST = 'boost';

const MESSAGE_AUTOMATION_MODULE_KEYS = Object.freeze([
  MESSAGE_AUTOMATION_MODULE_WELCOME,
  MESSAGE_AUTOMATION_MODULE_GOODBYE,
  MESSAGE_AUTOMATION_MODULE_BOOST,
]);

const MESSAGE_AUTOMATION_THUMBNAIL_MODE_NONE = 'none';
const MESSAGE_AUTOMATION_THUMBNAIL_MODE_USER_AVATAR = 'user_avatar';
const MESSAGE_AUTOMATION_THUMBNAIL_MODES = Object.freeze([
  MESSAGE_AUTOMATION_THUMBNAIL_MODE_NONE,
  MESSAGE_AUTOMATION_THUMBNAIL_MODE_USER_AVATAR,
]);

const DEFAULT_MODULE_SETTINGS = Object.freeze({
  [MESSAGE_AUTOMATION_MODULE_WELCOME]: Object.freeze({
    enabled: false,
    channelId: null,
    plainMessage: 'Hoş geldin {user_mention}',
    embed: Object.freeze({
      enabled: true,
      title: 'Yeni Üye',
      description: 'Sunucumuza hoş geldin, {user_mention}!',
      color: '#7c3aed',
      imageUrl: null,
      thumbnailMode: MESSAGE_AUTOMATION_THUMBNAIL_MODE_USER_AVATAR,
      footer: '{server_name}',
    }),
  }),
  [MESSAGE_AUTOMATION_MODULE_GOODBYE]: Object.freeze({
    enabled: false,
    channelId: null,
    plainMessage: 'Güle güle {user_name}',
    embed: Object.freeze({
      enabled: true,
      title: 'Üye Ayrıldı',
      description: '{user_name} sunucudan ayrıldı.',
      color: '#ef4444',
      imageUrl: null,
      thumbnailMode: MESSAGE_AUTOMATION_THUMBNAIL_MODE_USER_AVATAR,
      footer: '{server_name}',
    }),
  }),
  [MESSAGE_AUTOMATION_MODULE_BOOST]: Object.freeze({
    enabled: false,
    channelId: null,
    plainMessage: '{user_mention} sunucuyu boostladı!',
    embed: Object.freeze({
      enabled: true,
      title: 'Sunucu Boostlandı',
      description: 'Teşekkürler, {user_mention}!',
      color: '#cc97ff',
      imageUrl: null,
      thumbnailMode: MESSAGE_AUTOMATION_THUMBNAIL_MODE_USER_AVATAR,
      footer: '{server_name}',
    }),
  }),
});

const DISCORD_SNOWFLAKE_LIKE_REGEX = /^\d{15,25}$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

function createDefaultModuleSettings(moduleKey = MESSAGE_AUTOMATION_MODULE_WELCOME) {
  const source = DEFAULT_MODULE_SETTINGS[moduleKey] || DEFAULT_MODULE_SETTINGS.welcome;
  return {
    enabled: source.enabled,
    channelId: source.channelId,
    plainMessage: source.plainMessage,
    embed: {
      enabled: source.embed.enabled,
      title: source.embed.title,
      description: source.embed.description,
      color: source.embed.color,
      imageUrl: source.embed.imageUrl,
      thumbnailMode: source.embed.thumbnailMode,
      footer: source.embed.footer,
    },
  };
}

function createDefaultMessageAutomationSettings() {
  return {
    [MESSAGE_AUTOMATION_MODULE_WELCOME]: createDefaultModuleSettings(
      MESSAGE_AUTOMATION_MODULE_WELCOME
    ),
    [MESSAGE_AUTOMATION_MODULE_GOODBYE]: createDefaultModuleSettings(
      MESSAGE_AUTOMATION_MODULE_GOODBYE
    ),
    [MESSAGE_AUTOMATION_MODULE_BOOST]: createDefaultModuleSettings(
      MESSAGE_AUTOMATION_MODULE_BOOST
    ),
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return Boolean(fallback);
}

function normalizeSnowflakeLike(value, fallback = null) {
  if (value === null || value === undefined) return null;
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;
  if (!DISCORD_SNOWFLAKE_LIKE_REGEX.test(normalizedValue)) return fallback;
  return normalizedValue;
}

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') return String(fallback || '');
  return value;
}

function normalizeColor(value, fallback = '#7c3aed') {
  if (typeof value !== 'string') return String(fallback || '#7c3aed');
  const normalizedValue = String(value || '').trim();
  if (!HEX_COLOR_REGEX.test(normalizedValue)) return String(fallback || '#7c3aed');
  return normalizedValue.toLowerCase();
}

function normalizeUrl(value, fallback = null) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return fallback;

  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;
  try {
    const parsed = new URL(normalizedValue);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function normalizeThumbnailMode(value, fallback = MESSAGE_AUTOMATION_THUMBNAIL_MODE_NONE) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (!normalizedValue) return String(fallback || MESSAGE_AUTOMATION_THUMBNAIL_MODE_NONE);
  if (!MESSAGE_AUTOMATION_THUMBNAIL_MODES.includes(normalizedValue)) {
    return String(fallback || MESSAGE_AUTOMATION_THUMBNAIL_MODE_NONE);
  }
  return normalizedValue;
}

function normalizeModuleSettings(moduleKey = MESSAGE_AUTOMATION_MODULE_WELCOME, rawSettings = {}) {
  const fallback = createDefaultModuleSettings(moduleKey);
  const source =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? rawSettings
      : {};
  const rawEmbed =
    source.embed && typeof source.embed === 'object' && !Array.isArray(source.embed)
      ? source.embed
      : {};

  return {
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    channelId: normalizeSnowflakeLike(source.channelId, fallback.channelId),
    plainMessage: normalizeString(source.plainMessage, fallback.plainMessage),
    embed: {
      enabled: normalizeBoolean(rawEmbed.enabled, fallback.embed.enabled),
      title: normalizeString(rawEmbed.title, fallback.embed.title),
      description: normalizeString(rawEmbed.description, fallback.embed.description),
      color: normalizeColor(rawEmbed.color, fallback.embed.color),
      imageUrl: normalizeUrl(rawEmbed.imageUrl, fallback.embed.imageUrl),
      thumbnailMode: normalizeThumbnailMode(
        rawEmbed.thumbnailMode,
        fallback.embed.thumbnailMode
      ),
      footer: normalizeString(rawEmbed.footer, fallback.embed.footer),
    },
  };
}

function normalizeMessageAutomationSettings(rawSettings = {}) {
  const source =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? rawSettings
      : {};
  return {
    [MESSAGE_AUTOMATION_MODULE_WELCOME]: normalizeModuleSettings(
      MESSAGE_AUTOMATION_MODULE_WELCOME,
      source[MESSAGE_AUTOMATION_MODULE_WELCOME]
    ),
    [MESSAGE_AUTOMATION_MODULE_GOODBYE]: normalizeModuleSettings(
      MESSAGE_AUTOMATION_MODULE_GOODBYE,
      source[MESSAGE_AUTOMATION_MODULE_GOODBYE]
    ),
    [MESSAGE_AUTOMATION_MODULE_BOOST]: normalizeModuleSettings(
      MESSAGE_AUTOMATION_MODULE_BOOST,
      source[MESSAGE_AUTOMATION_MODULE_BOOST]
    ),
  };
}

function mergeMessageAutomationPatch({
  baselineSettings = {},
  patchSettings = {},
} = {}) {
  const baseline = normalizeMessageAutomationSettings(baselineSettings);
  const patch =
    patchSettings && typeof patchSettings === 'object' && !Array.isArray(patchSettings)
      ? patchSettings
      : {};

  const next = createDefaultMessageAutomationSettings();
  for (const moduleKey of MESSAGE_AUTOMATION_MODULE_KEYS) {
    const baselineModule =
      baseline[moduleKey] && typeof baseline[moduleKey] === 'object'
        ? baseline[moduleKey]
        : createDefaultModuleSettings(moduleKey);
    const patchModule =
      patch[moduleKey] && typeof patch[moduleKey] === 'object' && !Array.isArray(patch[moduleKey])
        ? patch[moduleKey]
        : null;
    const patchEmbed =
      patchModule?.embed &&
      typeof patchModule.embed === 'object' &&
      !Array.isArray(patchModule.embed)
        ? patchModule.embed
        : null;

    next[moduleKey] = {
      ...baselineModule,
      ...(patchModule || {}),
      embed: {
        ...baselineModule.embed,
        ...(patchEmbed || {}),
      },
    };
  }

  return normalizeMessageAutomationSettings(next);
}

function createStorageKey({ guildId = '' } = {}) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) return null;
  return normalizedGuildId;
}

function serializeSettingsFingerprint(settings = {}) {
  return JSON.stringify(normalizeMessageAutomationSettings(settings));
}

function cloneStoredRecord(record = null) {
  if (!record || typeof record !== 'object') return null;
  return {
    guildId: String(record.guildId || ''),
    actorId: record.actorId ? String(record.actorId) : null,
    settings: normalizeMessageAutomationSettings(record.settings),
    revision: Number(record.revision || 0),
    updatedAt: String(record.updatedAt || ''),
  };
}

function createInMemoryMessageAutomationRepository({ nowFn = Date.now } = {}) {
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

  async function upsertByGuildId({
    guildId = '',
    actorId = '',
    patch = {},
  } = {}) {
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
      ? normalizeMessageAutomationSettings(existing.settings)
      : createDefaultMessageAutomationSettings();
    const nextSettings = mergeMessageAutomationPatch({
      baselineSettings: baseline,
      patchSettings: patch,
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

let sharedMessageAutomationRepository = createInMemoryMessageAutomationRepository();

function getSharedMessageAutomationRepository() {
  return sharedMessageAutomationRepository;
}

function setSharedMessageAutomationRepositoryForTests(repository = null) {
  const previous = sharedMessageAutomationRepository;
  if (repository && typeof repository === 'object') {
    sharedMessageAutomationRepository = repository;
    return previous;
  }
  sharedMessageAutomationRepository = createInMemoryMessageAutomationRepository();
  return previous;
}

module.exports = {
  MESSAGE_AUTOMATION_MODULE_BOOST,
  MESSAGE_AUTOMATION_MODULE_GOODBYE,
  MESSAGE_AUTOMATION_MODULE_KEYS,
  MESSAGE_AUTOMATION_MODULE_WELCOME,
  MESSAGE_AUTOMATION_THUMBNAIL_MODE_NONE,
  MESSAGE_AUTOMATION_THUMBNAIL_MODE_USER_AVATAR,
  MESSAGE_AUTOMATION_THUMBNAIL_MODES,
  createDefaultMessageAutomationSettings,
  createDefaultModuleSettings,
  createInMemoryMessageAutomationRepository,
  getSharedMessageAutomationRepository,
  mergeMessageAutomationPatch,
  normalizeMessageAutomationSettings,
  setSharedMessageAutomationRepositoryForTests,
};
