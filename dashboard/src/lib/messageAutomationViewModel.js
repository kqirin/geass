export const MESSAGE_AUTOMATION_MODULES = Object.freeze([
  {
    id: 'welcome',
    label: 'Hoş Geldin',
    subtitle: 'Sunucuya katılan üyeler için mesaj ayarı',
  },
  {
    id: 'goodbye',
    label: 'Hoşça Kal',
    subtitle: 'Sunucudan ayrılan üyeler için mesaj ayarı',
  },
  {
    id: 'boost',
    label: 'Boost',
    subtitle: 'Sunucuyu boostlayan üyeler için mesaj ayarı',
  },
]);

export const MESSAGE_AUTOMATION_SUPPORTED_VARIABLES = Object.freeze([
  'user_mention',
  'user_name',
  'user_id',
  'server_name',
  'server_id',
  'member_count',
  'boost_count',
  'date',
]);

export const MESSAGE_AUTOMATION_PREVIEW_CONTEXT = Object.freeze({
  user_mention: '@kirin',
  user_name: 'kirin',
  user_id: '123456789012345678',
  server_name: 'geass ded.',
  server_id: '999999999999999001',
  member_count: '29',
  boost_count: '8',
  date: '17.04.2026',
});

const DEFAULT_MESSAGE_AUTOMATION_SETTINGS = Object.freeze({
  welcome: Object.freeze({
    enabled: false,
    channelId: null,
    plainMessage: 'Hoş geldin {user_mention}',
    embed: Object.freeze({
      enabled: true,
      title: 'Yeni Üye',
      description: 'Sunucumuza hoş geldin, {user_mention}!',
      color: '#7c3aed',
      imageUrl: null,
      thumbnailMode: 'user_avatar',
      footer: '{server_name}',
    }),
  }),
  goodbye: Object.freeze({
    enabled: false,
    channelId: null,
    plainMessage: 'Güle güle {user_name}',
    embed: Object.freeze({
      enabled: true,
      title: 'Üye Ayrıldı',
      description: '{user_name} sunucudan ayrıldı.',
      color: '#ef4444',
      imageUrl: null,
      thumbnailMode: 'user_avatar',
      footer: '{server_name}',
    }),
  }),
  boost: Object.freeze({
    enabled: false,
    channelId: null,
    plainMessage: '{user_mention} sunucuyu boostladı!',
    embed: Object.freeze({
      enabled: true,
      title: 'Sunucu Boostlandı',
      description: 'Teşekkürler, {user_mention}!',
      color: '#cc97ff',
      imageUrl: null,
      thumbnailMode: 'user_avatar',
      footer: '{server_name}',
    }),
  }),
});

export function isHexColor(value = '') {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim());
}

function createDefaultModuleSettings(moduleId = 'welcome') {
  const fallback = DEFAULT_MESSAGE_AUTOMATION_SETTINGS[moduleId]
    || DEFAULT_MESSAGE_AUTOMATION_SETTINGS.welcome;
  return {
    enabled: fallback.enabled,
    channelId: fallback.channelId,
    plainMessage: fallback.plainMessage,
    embed: {
      enabled: fallback.embed.enabled,
      title: fallback.embed.title,
      description: fallback.embed.description,
      color: fallback.embed.color,
      imageUrl: fallback.embed.imageUrl,
      thumbnailMode: fallback.embed.thumbnailMode,
      footer: fallback.embed.footer,
    },
  };
}

export function createDefaultMessageAutomationSettings() {
  return {
    welcome: createDefaultModuleSettings('welcome'),
    goodbye: createDefaultModuleSettings('goodbye'),
    boost: createDefaultModuleSettings('boost'),
  };
}

function normalizeString(value = '', fallback = '') {
  if (typeof value !== 'string') return String(fallback || '');
  return value;
}

function normalizeImageUrl(value = null, fallback = null) {
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

function normalizeModuleSettings(moduleId = 'welcome', rawModule = {}) {
  const fallback = createDefaultModuleSettings(moduleId);
  const source = rawModule && typeof rawModule === 'object' ? rawModule : {};
  const rawEmbed = source.embed && typeof source.embed === 'object' ? source.embed : {};

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    channelId:
      source.channelId === null || typeof source.channelId === 'string'
        ? source.channelId
        : fallback.channelId,
    plainMessage: normalizeString(source.plainMessage, fallback.plainMessage),
    embed: {
      enabled:
        typeof rawEmbed.enabled === 'boolean'
          ? rawEmbed.enabled
          : fallback.embed.enabled,
      title: normalizeString(rawEmbed.title, fallback.embed.title),
      description: normalizeString(rawEmbed.description, fallback.embed.description),
      color: isHexColor(rawEmbed.color)
        ? String(rawEmbed.color || '').trim().toLowerCase()
        : fallback.embed.color,
      imageUrl: normalizeImageUrl(rawEmbed.imageUrl, fallback.embed.imageUrl),
      thumbnailMode:
        rawEmbed.thumbnailMode === 'none' || rawEmbed.thumbnailMode === 'user_avatar'
          ? rawEmbed.thumbnailMode
          : fallback.embed.thumbnailMode,
      footer: normalizeString(rawEmbed.footer, fallback.embed.footer),
    },
  };
}

export function normalizeMessageAutomationSettings(rawSettings = {}) {
  const source = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  return {
    welcome: normalizeModuleSettings('welcome', source.welcome),
    goodbye: normalizeModuleSettings('goodbye', source.goodbye),
    boost: normalizeModuleSettings('boost', source.boost),
  };
}

export function normalizeMessageAutomationPayload(rawPayload = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    contractVersion:
      Number(source.contractVersion) === 1 ? 1 : 1,
    guildId: String(source.guildId || '').trim() || null,
    settings: normalizeMessageAutomationSettings(source.settings),
    updatedAt: String(source.updatedAt || '').trim() || null,
    mutation:
      source.mutation && typeof source.mutation === 'object'
        ? source.mutation
        : null,
  };
}

export function resolveMessageAutomationVariables(
  rawTemplate = '',
  sampleContext = MESSAGE_AUTOMATION_PREVIEW_CONTEXT
) {
  if (typeof rawTemplate !== 'string') return '';
  const context =
    sampleContext && typeof sampleContext === 'object'
      ? sampleContext
      : MESSAGE_AUTOMATION_PREVIEW_CONTEXT;

  return rawTemplate.replace(/\{([a-z_]+)\}/gi, (full, key) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!MESSAGE_AUTOMATION_SUPPORTED_VARIABLES.includes(normalizedKey)) {
      return full;
    }
    const value = context[normalizedKey];
    return value === undefined || value === null ? full : String(value);
  });
}
