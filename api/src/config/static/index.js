const {
  DEFAULT_BINDINGS,
  DEFAULT_BOT_PRESENCE,
  DEFAULT_STATIC_SETTINGS,
  STATIC_SERVER_CONFIG,
} = require('./server');
const { config } = require('../../config');

const STATIC_SETTINGS_KEYS = Object.freeze([
  'prefix',
  'log_enabled',
  'log_role',
  'log_safe_list',
  'log_limit',
  'warn_enabled',
  'warn_role',
  'warn_safe_list',
  'warn_limit',
  'mute_enabled',
  'mute_role',
  'mute_penalty_role',
  'mute_safe_list',
  'mute_limit',
  'kick_enabled',
  'kick_role',
  'kick_safe_list',
  'kick_limit',
  'jail_enabled',
  'jail_role',
  'jail_penalty_role',
  'jail_safe_list',
  'jail_limit',
  'ban_enabled',
  'ban_role',
  'ban_safe_list',
  'ban_limit',
  'lock_enabled',
  'lock_role',
  'lock_safe_list',
  'lock_limit',
  'tag_enabled',
  'tag_role',
  'tag_text',
  'startup_voice_channel_id',
  'private_vc_enabled',
  'private_vc_hub_channel',
  'private_vc_required_role',
  'private_vc_category',
  'staff_hierarchy_roles',
  'hard_protected_roles',
  'hard_protected_users',
]);

const STATIC_SETTINGS_KEY_SET = new Set(STATIC_SETTINGS_KEYS);
const LIST_SETTING_KEYS = new Set([
  'log_safe_list',
  'warn_safe_list',
  'mute_safe_list',
  'kick_safe_list',
  'jail_safe_list',
  'ban_safe_list',
  'lock_safe_list',
  'staff_hierarchy_roles',
  'hard_protected_roles',
  'hard_protected_users',
]);

const BINDING_GROUP_KEYS = Object.freeze(['roles', 'channels', 'categories']);
const BOT_PRESENCE_ALLOWED_TYPES = Object.freeze([
  'CUSTOM',
  'PLAYING',
  'LISTENING',
  'WATCHING',
  'COMPETING',
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const next of Object.values(value)) {
    deepFreeze(next);
  }
  return value;
}

function isSnowflake(value) {
  return /^\d{5,32}$/.test(String(value || '').trim());
}

function normalizeSnowflake(value) {
  const normalized = String(value || '').trim().replace(/[^\d]/g, '');
  return isSnowflake(normalized) ? normalized : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function normalizeLimit(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(5000, Math.floor(numeric)));
}

function normalizePrefix(value, fallback = DEFAULT_STATIC_SETTINGS.prefix) {
  const normalized = String(value ?? fallback).trim().slice(0, 3);
  return normalized || fallback;
}

function normalizeIdList(value) {
  if (!value) return '';
  const seen = new Set();
  return String(value)
    .split(',')
    .map((entry) => normalizeSnowflake(entry))
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    })
    .join(',');
}

function normalizeTagText(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().slice(0, 64);
  return normalized || null;
}

function cloneRecord(record = {}) {
  return record && typeof record === 'object' && !Array.isArray(record) ? { ...record } : {};
}

function mergeDeep(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return cloneRecord(base);
  }

  const out = cloneRecord(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergeDeep(out[key], value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const wrapped = new Error(`${name}_parse_failed`);
    wrapped.code = 'STATIC_CONFIG_ENV_PARSE_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }
}

function normalizeBindings(input = {}, fallback = DEFAULT_BINDINGS) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};

  for (const groupName of BINDING_GROUP_KEYS) {
    const base = cloneRecord(fallback[groupName]);
    const override = cloneRecord(source[groupName]);
    out[groupName] = Object.fromEntries(
      Object.entries({ ...base, ...override })
        .map(([key, value]) => [key, normalizeSnowflake(value)])
        .filter(([, value]) => Boolean(value))
    );
  }

  const fallbackEmojis =
    fallback.emojis && typeof fallback.emojis === 'object' ? fallback.emojis : {};
  const overrideEmojis =
    source.emojis && typeof source.emojis === 'object' ? source.emojis : {};
  const emojiGroups = { ...fallbackEmojis, ...overrideEmojis };
  out.emojis = Object.fromEntries(
    Object.entries(emojiGroups).map(([groupName, groupValue]) => [
      groupName,
      Object.fromEntries(
        Object.entries({ ...(fallbackEmojis[groupName] || {}), ...(groupValue || {}) })
          .map(([key, value]) => [key, normalizeSnowflake(value)])
          .filter(([, value]) => Boolean(value))
      ),
    ])
  );

  return deepFreeze(out);
}

function normalizeStaticSettings(input = {}, fallback = DEFAULT_STATIC_SETTINGS) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};

  for (const key of STATIC_SETTINGS_KEYS) {
    const fallbackValue = fallback[key];
    const rawValue = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallbackValue;

    if (key === 'prefix') {
      out[key] = normalizePrefix(rawValue, fallbackValue);
      continue;
    }
    if (key === 'tag_text') {
      out[key] = normalizeTagText(rawValue, fallbackValue);
      continue;
    }
    if (LIST_SETTING_KEYS.has(key)) {
      out[key] = normalizeIdList(rawValue);
      continue;
    }
    if (key.endsWith('_enabled')) {
      out[key] = normalizeBoolean(rawValue, normalizeBoolean(fallbackValue));
      continue;
    }
    if (key.endsWith('_limit')) {
      out[key] = normalizeLimit(rawValue, normalizeLimit(fallbackValue));
      continue;
    }
    if (
      key === 'startup_voice_channel_id' ||
      key.endsWith('_role') ||
      key.endsWith('_penalty_role') ||
      key.endsWith('_channel') ||
      key.endsWith('_category')
    ) {
      out[key] = normalizeSnowflake(rawValue);
      continue;
    }

    out[key] = rawValue;
  }

  return deepFreeze(out);
}

function normalizeBotPresence(input = {}, fallback = DEFAULT_BOT_PRESENCE) {
  const source = input && typeof input === 'object' ? input : {};
  const rawType = String(source.type ?? fallback.type ?? 'CUSTOM').trim().toUpperCase();
  const type = BOT_PRESENCE_ALLOWED_TYPES.includes(rawType) ? rawType : fallback.type;
  const text = String(source.text ?? fallback.text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);

  return deepFreeze({
    enabled: normalizeBoolean(source.enabled, normalizeBoolean(fallback.enabled, true)),
    type,
    text: text || fallback.text,
  });
}

function normalizeGuildStaticConfig(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const baseSettings =
    fallback.settings && typeof fallback.settings === 'object' ? fallback.settings : DEFAULT_STATIC_SETTINGS;
  const baseBindings =
    fallback.bindings && typeof fallback.bindings === 'object' ? fallback.bindings : DEFAULT_BINDINGS;

  return deepFreeze({
    settings: normalizeStaticSettings(source.settings, baseSettings),
    bindings: normalizeBindings(source.bindings, baseBindings),
  });
}

function buildStaticServerConfig() {
  const envOverride = parseJsonEnv('STATIC_SERVER_CONFIG_JSON') || {};
  const merged = mergeDeep(STATIC_SERVER_CONFIG, envOverride);
  const startupVoiceChannelId = normalizeSnowflake(config.discord.startupVoiceChannelId);

  if (
    startupVoiceChannelId &&
    !String(merged?.defaults?.settings?.startup_voice_channel_id || '').trim()
  ) {
    merged.defaults = mergeDeep(merged.defaults, {
      settings: {
        startup_voice_channel_id: startupVoiceChannelId,
      },
    });
  }

  const defaults = normalizeGuildStaticConfig(merged.defaults, {
    settings: DEFAULT_STATIC_SETTINGS,
    bindings: DEFAULT_BINDINGS,
  });

  const guilds = Object.fromEntries(
    Object.entries(merged.guilds || {}).map(([guildId, guildConfig]) => [
      String(guildId || '').trim(),
      normalizeGuildStaticConfig(guildConfig, defaults),
    ])
  );

  return deepFreeze({
    defaults,
    guilds,
    botPresence: normalizeBotPresence(merged.botPresence, DEFAULT_BOT_PRESENCE),
  });
}

const staticServerConfig = buildStaticServerConfig();

function getConfiguredStaticGuildIds() {
  return Object.keys(staticServerConfig.guilds);
}

function resolveStaticGuildConfig(guildId) {
  const safeGuildId = String(guildId || '').trim();
  if (safeGuildId && staticServerConfig.guilds[safeGuildId]) {
    return staticServerConfig.guilds[safeGuildId];
  }
  return staticServerConfig.defaults;
}

function getStaticGuildSettings(guildId) {
  return resolveStaticGuildConfig(guildId).settings;
}

function getStaticGuildBindings(guildId) {
  return resolveStaticGuildConfig(guildId).bindings;
}

function getStaticBotPresence() {
  return staticServerConfig.botPresence;
}

function getPrivateVoiceConfig(guildId) {
  const settings = getStaticGuildSettings(guildId);
  return deepFreeze({
    enabled: settings.private_vc_enabled === true,
    hubChannelId: settings.private_vc_hub_channel || null,
    requiredRoleId: settings.private_vc_required_role || null,
    categoryId: settings.private_vc_category || null,
  });
}

function getStartupVoiceConfig(guildId) {
  const settings = getStaticGuildSettings(guildId);
  const envChannelId = normalizeSnowflake(config.discord.startupVoiceChannelId);
  return deepFreeze({
    channelId: settings.startup_voice_channel_id || envChannelId || null,
  });
}

function getTagRoleConfig(guildId) {
  const settings = getStaticGuildSettings(guildId);
  return deepFreeze({
    enabled: settings.tag_enabled === true,
    roleId: settings.tag_role || null,
    tagText: settings.tag_text || null,
  });
}

function getPrivateRoomPanelEmojis(guildId) {
  const bindings = getStaticGuildBindings(guildId);
  return bindings.emojis?.privateRoomPanel || {};
}

function isStaticSettingKey(key) {
  return STATIC_SETTINGS_KEY_SET.has(String(key || '').trim());
}

function filterStaticSettings(input = {}) {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => isStaticSettingKey(key))
  );
}

function filterDynamicSettings(input = {}) {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => {
      const normalized = String(key || '').trim();
      if (!normalized || normalized === 'guild_id') return false;
      if (normalized.startsWith('clear_')) return false;
      return !isStaticSettingKey(normalized);
    })
  );
}

function buildAuthoritativeSettings(guildId, runtimeSettings = null) {
  const dynamicSettings = filterDynamicSettings(runtimeSettings || {});
  return {
    ...dynamicSettings,
    ...getStaticGuildSettings(guildId),
  };
}

module.exports = {
  BOT_PRESENCE_ALLOWED_TYPES,
  DEFAULT_BINDINGS,
  DEFAULT_BOT_PRESENCE,
  DEFAULT_STATIC_SETTINGS,
  STATIC_SETTINGS_KEYS,
  buildAuthoritativeSettings,
  filterDynamicSettings,
  filterStaticSettings,
  getConfiguredStaticGuildIds,
  getPrivateRoomPanelEmojis,
  getStartupVoiceConfig,
  getPrivateVoiceConfig,
  getStaticBotPresence,
  getStaticGuildBindings,
  getStaticGuildSettings,
  getTagRoleConfig,
  isSnowflake,
  isStaticSettingKey,
  normalizeBotPresence,
  normalizeStaticSettings,
  resolveStaticGuildConfig,
  staticServerConfig,
};
