const { ChannelType } = require('discord.js');
const { config } = require('../config');
const {
  BOT_PRESENCE_ALLOWED_TYPES,
  getConfiguredStaticGuildIds,
  getPrivateRoomPanelEmojis,
  getStaticBotPresence,
  getStaticGuildBindings,
  getStaticGuildSettings,
  isSnowflake,
} = require('../config/static');

const ENABLED_ACTION_SPECS = Object.freeze([
  { enabledKey: 'log_enabled' },
  { enabledKey: 'warn_enabled' },
  { enabledKey: 'mute_enabled' },
  { enabledKey: 'kick_enabled' },
  { enabledKey: 'jail_enabled', requiredExtraRoleKeys: ['jail_penalty_role'] },
  { enabledKey: 'ban_enabled' },
  { enabledKey: 'lock_enabled', roleKey: 'lock_role' },
  { enabledKey: 'tag_enabled', roleKey: 'tag_role' },
  { enabledKey: 'private_vc_enabled', roleKey: 'private_vc_required_role', requiredChannelKeys: ['private_vc_hub_channel'] },
]);

function normalizeIdList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function buildDuplicateValueErrors(scope, bindings = {}) {
  const seen = new Map();
  const errors = [];

  for (const [bindingKey, bindingValue] of Object.entries(bindings || {})) {
    const value = String(bindingValue || '').trim();
    if (!value) continue;
    const existing = seen.get(value);
    if (existing) {
      errors.push(`${scope} duplicate binding: ${existing} ve ${bindingKey} ayni ID'ye bakiyor (${value})`);
      continue;
    }
    seen.set(value, bindingKey);
  }

  return errors;
}

async function resolveGuild(client, guildId) {
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

async function resolveRole(guild, roleId) {
  if (!roleId) return null;
  return guild?.roles?.cache?.get?.(roleId) || (await guild?.roles?.fetch?.(roleId).catch(() => null));
}

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  return guild?.channels?.cache?.get?.(channelId) || (await guild?.channels?.fetch?.(channelId).catch(() => null));
}

async function resolveEmoji(client, guild, emojiId) {
  if (!emojiId) return null;
  return (
    guild?.emojis?.cache?.get?.(emojiId) ||
    client?.emojis?.cache?.get?.(emojiId) ||
    (await guild?.emojis?.fetch?.(emojiId).catch(() => null)) ||
    (await client?.emojis?.fetch?.(emojiId).catch(() => null))
  );
}

async function validateGuildStaticConfig(client, guildId) {
  const errors = [];
  const warnings = [];
  const roleValidationErrorSet = new Set();
  const guild = await resolveGuild(client, guildId);
  const settings = getStaticGuildSettings(guildId);
  const bindings = getStaticGuildBindings(guildId);
  const pushRoleValidationError = (roleKey, roleId) => {
    const message = `Role bulunamadi veya gecersiz: ${roleKey}=${roleId} (guild=${guildId})`;
    if (roleValidationErrorSet.has(message)) return;
    roleValidationErrorSet.add(message);
    errors.push(message);
  };

  if (!guild) {
    errors.push(`Static config guild bulunamadi: ${guildId}`);
    return { guildId, errors, warnings };
  }

  if (!String(settings.prefix || '').trim()) {
    errors.push(`Static config prefix bos olamaz: guild=${guildId}`);
  }

  for (const spec of ENABLED_ACTION_SPECS) {
    if (settings[spec.enabledKey] !== true) continue;
    if (spec.roleKey) {
      const primaryRoleId = settings[spec.roleKey];
      if (!primaryRoleId) {
        errors.push(`Eksik zorunlu static config: ${spec.roleKey} (guild=${guildId})`);
        continue;
      }

      const primaryRole = await resolveRole(guild, primaryRoleId);
      if (!primaryRole || primaryRole.id === guild.id || primaryRole.name === '@everyone') {
        pushRoleValidationError(spec.roleKey, primaryRoleId);
      }
    }

    for (const extraRoleKey of spec.requiredExtraRoleKeys || []) {
      const extraRoleId = settings[extraRoleKey];
      if (!extraRoleId) {
        errors.push(`Eksik zorunlu static config: ${extraRoleKey} (guild=${guildId})`);
        continue;
      }
      const extraRole = await resolveRole(guild, extraRoleId);
      if (!extraRole || extraRole.id === guild.id || extraRole.name === '@everyone') {
        pushRoleValidationError(extraRoleKey, extraRoleId);
      }
    }

    for (const channelKey of spec.requiredChannelKeys || []) {
      const channelId = settings[channelKey];
      if (!channelId) {
        errors.push(`Eksik zorunlu static config: ${channelKey} (guild=${guildId})`);
        continue;
      }
      const channel = await resolveChannel(guild, channelId);
      if (!channel) {
        errors.push(`Kanal bulunamadi: ${channelKey}=${channelId} (guild=${guildId})`);
      }
    }
  }

  for (const key of [
    'mute_penalty_role',
    'jail_penalty_role',
    'lock_role',
    'tag_role',
    'private_vc_required_role',
  ]) {
    const roleId = settings[key];
    if (!roleId) continue;
    const role = await resolveRole(guild, roleId);
    if (!role || role.id === guild.id || role.name === '@everyone') {
      pushRoleValidationError(key, roleId);
    }
  }

  for (const roleId of normalizeIdList(settings.staff_hierarchy_roles)) {
    const role = await resolveRole(guild, roleId);
    if (!role) errors.push(`Hierarchy rolu bulunamadi: ${roleId} (guild=${guildId})`);
  }

  for (const roleId of normalizeIdList(settings.hard_protected_roles)) {
    const role = await resolveRole(guild, roleId);
    if (!role) errors.push(`Hard protected rol bulunamadi: ${roleId} (guild=${guildId})`);
  }

  for (const userId of normalizeIdList(settings.hard_protected_users)) {
    if (!isSnowflake(userId)) {
      errors.push(`Hard protected user ID gecersiz: ${userId} (guild=${guildId})`);
    }
  }

  if (settings.private_vc_hub_channel) {
    const hub = await resolveChannel(guild, settings.private_vc_hub_channel);
    if (!hub) {
      errors.push(`Private VC hub channel bulunamadi: ${settings.private_vc_hub_channel} (guild=${guildId})`);
    } else if (hub.type !== ChannelType.GuildVoice && hub.type !== ChannelType.GuildStageVoice) {
      errors.push(`Private VC hub channel ses kanali degil: ${hub.id} (guild=${guildId})`);
    }
  }

  if (settings.private_vc_category) {
    const category = await resolveChannel(guild, settings.private_vc_category);
    if (!category) {
      errors.push(`Private VC category bulunamadi: ${settings.private_vc_category} (guild=${guildId})`);
    } else if (category.type !== ChannelType.GuildCategory) {
      errors.push(`Private VC category gecersiz tipte: ${category.id} (guild=${guildId})`);
    }
  }

  if (settings.startup_voice_channel_id) {
    const startupVoiceChannel = await resolveChannel(guild, settings.startup_voice_channel_id);
    if (!startupVoiceChannel) {
      warnings.push(
        `Startup voice channel bulunamadi: ${settings.startup_voice_channel_id} (guild=${guildId})`
      );
    } else if (
      startupVoiceChannel.type !== ChannelType.GuildVoice &&
      startupVoiceChannel.type !== ChannelType.GuildStageVoice
    ) {
      warnings.push(
        `Startup voice channel ses kanali degil: ${startupVoiceChannel.id} (guild=${guildId})`
      );
    }
  }

  for (const [bindingName, channelId] of Object.entries(bindings.channels || {})) {
    const channel = await resolveChannel(guild, channelId);
    if (!channel) errors.push(`Static channel binding bulunamadi: ${bindingName}=${channelId} (guild=${guildId})`);
  }

  for (const [bindingName, categoryId] of Object.entries(bindings.categories || {})) {
    const category = await resolveChannel(guild, categoryId);
    if (!category) {
      errors.push(`Static category binding bulunamadi: ${bindingName}=${categoryId} (guild=${guildId})`);
      continue;
    }
    if (category.type !== ChannelType.GuildCategory) {
      errors.push(`Static category binding kategori degil: ${bindingName}=${categoryId} (guild=${guildId})`);
    }
  }

  for (const [bindingName, roleId] of Object.entries(bindings.roles || {})) {
    const role = await resolveRole(guild, roleId);
    if (!role) errors.push(`Static role binding bulunamadi: ${bindingName}=${roleId} (guild=${guildId})`);
  }

  for (const [groupName, emojiBindings] of Object.entries(bindings.emojis || {})) {
    for (const [bindingName, emojiId] of Object.entries(emojiBindings || {})) {
      const emoji = await resolveEmoji(client, guild, emojiId);
      if (!emoji) {
        errors.push(`Static emoji binding bulunamadi: ${groupName}.${bindingName}=${emojiId} (guild=${guildId})`);
      }
    }
    errors.push(...buildDuplicateValueErrors(`emoji.${groupName}`, emojiBindings));
  }

  errors.push(...buildDuplicateValueErrors('role', bindings.roles));
  errors.push(...buildDuplicateValueErrors('channel', bindings.channels));
  errors.push(...buildDuplicateValueErrors('category', bindings.categories));

  const panelEmojiBindings = getPrivateRoomPanelEmojis(guildId);
  if (Object.keys(panelEmojiBindings).length === 0) {
    warnings.push(`Private room panel emoji binding bos: guild=${guildId}`);
  }

  return { guildId, errors, warnings };
}

async function validateStaticConfig(client, logSystem = () => {}, _logError = () => {}) {
  const errors = [];
  const warnings = [];
  const guildIds = getConfiguredStaticGuildIds();
  const configuredGuildIds = new Set(guildIds);
  const botPresence = getStaticBotPresence();
  const requiredGuildIds = [
    config.discord.targetGuildId,
    config.oauth.singleGuildId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (botPresence.enabled && !String(botPresence.text || '').trim()) {
    errors.push('Static bot presence text bos olamaz');
  }
  if (!BOT_PRESENCE_ALLOWED_TYPES.includes(String(botPresence.type || '').trim().toUpperCase())) {
    errors.push(`Static bot presence type gecersiz: ${botPresence.type}`);
  }

  for (const guildId of requiredGuildIds) {
    if (!configuredGuildIds.has(guildId)) {
      errors.push(`Eksik static guild config: ${guildId}`);
    }
  }

  if (guildIds.length === 0) {
    warnings.push('Hic explicit static guild config tanimlanmamis; sadece defaults aktif');
  }

  for (const guildId of guildIds) {
    const result = await validateGuildStaticConfig(client, guildId);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  for (const warning of warnings) {
    logSystem(`static_config_warning: ${warning}`, 'WARN');
  }

  if (errors.length > 0) {
    const error = new Error(`Static config validation failed: ${errors.join(' | ')}`);
    const firstError = String(errors[0] || 'unknown').slice(0, 220);
    logSystem(
      `static_config_validation_failed: ${firstError} (errors=${errors.length}, warnings=${warnings.length})`,
      'ERROR'
    );
    throw error;
  }

  logSystem('Static config validation passed', 'INFO');
}

module.exports = {
  validateStaticConfig,
  validateGuildStaticConfig,
};
