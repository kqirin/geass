const { isSnowflake } = require('../config/static');
const { resolveDashboardGuildScope } = require('./guildScope');

const CONTRACT_VERSION = 1;
const STATUS_READY = 'ready';
const STATUS_WARNING = 'warning';
const STATUS_INCOMPLETE = 'incomplete';

const SECTION_DEFINITIONS = Object.freeze([
  { id: 'static-config', title: 'Statik Yapilandirma' },
  { id: 'private-room', title: 'Ozel Oda Sistemi' },
  { id: 'startup-voice', title: 'Baslangic Ses Kanali' },
  { id: 'moderation-roles', title: 'Moderasyon Rolleri' },
  { id: 'tag-role', title: 'Tag Rol Sistemi' },
  { id: 'command-policy', title: 'Komut Politikalari' },
]);

const COMMAND_POLICY_FLAGS = Object.freeze([
  { key: 'log_enabled', title: 'Log komutu politikasi' },
  { key: 'warn_enabled', title: 'Warn komutu politikasi' },
  { key: 'mute_enabled', title: 'Mute komutu politikasi' },
  { key: 'kick_enabled', title: 'Kick komutu politikasi' },
  { key: 'jail_enabled', title: 'Jail komutu politikasi' },
  { key: 'ban_enabled', title: 'Ban komutu politikasi' },
  { key: 'lock_enabled', title: 'Lock komutu politikasi' },
]);

function normalizeGuildId(rawValue) {
  const normalized = String(rawValue || '')
    .trim()
    .replace(/[^\d]/g, '');
  if (!normalized) return null;
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeQueryGuildId(query = {}) {
  if (!query || typeof query !== 'object') return null;
  const value = query.guildId;
  if (Array.isArray(value)) return normalizeGuildId(value[0]);
  return normalizeGuildId(value);
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasBindingValue(record = {}, targetId = null) {
  if (!targetId) return false;
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) return false;
  return Object.values(toSafeObject(record)).some(
    (value) => String(value || '').trim() === normalizedTargetId
  );
}

function toCheck({
  id = '',
  title = '',
  status = STATUS_READY,
  reasonCode = null,
  description = '',
  targetType = 'config',
  targetKey = '',
  severity = null,
} = {}) {
  return {
    id: String(id || '').trim() || null,
    title: String(title || '').trim() || null,
    status:
      status === STATUS_INCOMPLETE || status === STATUS_WARNING
        ? status
        : STATUS_READY,
    reasonCode:
      reasonCode === undefined || reasonCode === null
        ? null
        : String(reasonCode || '').trim() || null,
    description: String(description || '').trim() || null,
    targetType: String(targetType || 'config').trim() || 'config',
    targetKey: String(targetKey || '').trim() || null,
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error'
        ? severity
        : null,
  };
}

function toIssueFromCheck(check = {}) {
  const status = String(check?.status || STATUS_READY).trim();
  if (status === STATUS_READY) return null;

  const severity =
    check?.severity ||
    (status === STATUS_INCOMPLETE ? 'error' : 'warning');

  return {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error'
        ? severity
        : 'warning',
    reasonCode: String(check?.reasonCode || '').trim() || 'setup_readiness_warning',
    title: String(check?.title || 'Kurulum uyarisi').trim(),
    description: String(check?.description || 'Kurulum durumunda bir uyari bulundu.').trim(),
    targetType: String(check?.targetType || 'config').trim() || 'config',
    targetKey: String(check?.targetKey || '').trim() || null,
  };
}

function toSectionStatus(checks = []) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  if (normalizedChecks.some((check) => check?.status === STATUS_INCOMPLETE)) {
    return STATUS_INCOMPLETE;
  }
  if (normalizedChecks.some((check) => check?.status === STATUS_WARNING)) {
    return STATUS_WARNING;
  }
  return STATUS_READY;
}

function toSummary(sections = []) {
  const normalizedSections = Array.isArray(sections) ? sections : [];
  const allChecks = normalizedSections.flatMap((section) =>
    Array.isArray(section?.checks) ? section.checks : []
  );
  const totalChecks = allChecks.length;
  const passedChecks = allChecks.filter((check) => check?.status === STATUS_READY).length;
  const warningChecks = allChecks.filter((check) => check?.status === STATUS_WARNING).length;
  const failedChecks = allChecks.filter((check) => check?.status === STATUS_INCOMPLETE).length;

  const weightedScore =
    totalChecks > 0
      ? ((passedChecks + warningChecks * 0.5) / totalChecks) * 100
      : 100;
  const score = Math.max(0, Math.min(100, Math.round(weightedScore)));
  const status =
    failedChecks > 0
      ? STATUS_INCOMPLETE
      : warningChecks > 0
        ? STATUS_WARNING
        : STATUS_READY;

  return {
    status,
    score,
    totalChecks,
    passedChecks,
    warningChecks,
    failedChecks,
  };
}

function buildStaticConfigSection({
  guildId = null,
  hasExplicitStaticConfig = false,
} = {}) {
  const checks = [];
  if (hasExplicitStaticConfig) {
    checks.push(
      toCheck({
        id: 'static-config-source',
        title: 'Sunucuya ozel statik config',
        status: STATUS_READY,
        reasonCode: 'static_config_explicit_present',
        description: 'Bu sunucu icin explicit statik config bulundu.',
        targetType: 'config',
        targetKey: 'static_server_config.guilds',
      })
    );
  } else {
    checks.push(
      toCheck({
        id: 'static-config-source',
        title: 'Sunucuya ozel statik config',
        status: STATUS_WARNING,
        reasonCode: 'static_config_defaults_in_use',
        description:
          'Bu sunucu explicit statik config yerine defaults ayarlariyla calisiyor.',
        targetType: 'config',
        targetKey: 'static_server_config.defaults',
      })
    );
  }

  return {
    id: 'static-config',
    title: 'Statik Yapilandirma',
    status: toSectionStatus(checks),
    checks,
  };
}

function toExistenceCheck({
  id = '',
  title = '',
  configuredId = null,
  targetType = 'config',
  targetKey = '',
  missingReasonCode = 'resource_missing',
  invalidReasonCode = 'resource_id_invalid',
  unverifiedReasonCode = 'resource_existence_unverified',
  missingDescription = 'Kaynak ayari bulunamadi.',
  invalidDescription = 'Kaynak ID formati gecersiz.',
  unverifiedDescription = 'Kaynak varligi dogrulanamadi.',
  bindings = {},
} = {}) {
  const normalizedConfiguredId = String(configuredId || '').trim();
  if (!normalizedConfiguredId) {
    return toCheck({
      id,
      title,
      status: STATUS_INCOMPLETE,
      reasonCode: missingReasonCode,
      description: missingDescription,
      targetType,
      targetKey,
    });
  }

  if (!isSnowflake(normalizedConfiguredId)) {
    return toCheck({
      id,
      title,
      status: STATUS_INCOMPLETE,
      reasonCode: invalidReasonCode,
      description: invalidDescription,
      targetType,
      targetKey,
    });
  }

  if (hasBindingValue(bindings, normalizedConfiguredId)) {
    return toCheck({
      id,
      title,
      status: STATUS_READY,
      reasonCode: null,
      description: 'Ayarlandi ve bagli kaynak kayitlarinda goruldu.',
      targetType,
      targetKey,
    });
  }

  return toCheck({
    id,
    title,
    status: STATUS_WARNING,
    reasonCode: unverifiedReasonCode,
    description: unverifiedDescription,
    targetType,
    targetKey,
  });
}

function buildPrivateRoomSection({
  settings = {},
  privateVoiceConfig = {},
  bindings = {},
} = {}) {
  const checks = [];
  const enabled =
    privateVoiceConfig.enabled === true || settings.private_vc_enabled === true;
  checks.push(
    toCheck({
      id: 'private-vc-enabled',
      title: 'Ozel oda sistemi aktifligi',
      status: enabled ? STATUS_READY : STATUS_WARNING,
      reasonCode: enabled ? 'private_vc_enabled' : 'private_vc_disabled',
      description: enabled
        ? 'Ozel oda sistemi aktif.'
        : 'Ozel oda sistemi pasif. Gerekiyorsa panel sonraki asamada acilabilir.',
      targetType: 'config',
      targetKey: 'private_vc_enabled',
      severity: enabled ? null : 'info',
    })
  );

  if (enabled) {
    checks.push(
      toExistenceCheck({
        id: 'private-vc-hub-channel',
        title: 'Oda olusturma hub kanali',
        configuredId:
          privateVoiceConfig.hubChannelId || settings.private_vc_hub_channel || null,
        targetType: 'channel',
        targetKey: 'private_vc_hub_channel',
        missingReasonCode: 'private_vc_hub_channel_missing',
        invalidReasonCode: 'private_vc_hub_channel_invalid',
        unverifiedReasonCode: 'private_vc_hub_channel_unverified',
        missingDescription: 'Ozel oda hub kanali ayari bulunamadi.',
        invalidDescription: 'Ozel oda hub kanal ID formati gecersiz.',
        unverifiedDescription:
          'Ozel oda hub kanali static binding kaydinda dogrulanamadi.',
        bindings: bindings.channels,
      })
    );
    checks.push(
      toExistenceCheck({
        id: 'private-vc-required-role',
        title: 'Ozel oda gerekli rol',
        configuredId:
          privateVoiceConfig.requiredRoleId ||
          settings.private_vc_required_role ||
          null,
        targetType: 'role',
        targetKey: 'private_vc_required_role',
        missingReasonCode: 'private_vc_required_role_missing',
        invalidReasonCode: 'private_vc_required_role_invalid',
        unverifiedReasonCode: 'private_vc_required_role_unverified',
        missingDescription: 'Ozel oda gerekli rol ayari bulunamadi.',
        invalidDescription: 'Ozel oda gerekli rol ID formati gecersiz.',
        unverifiedDescription:
          'Ozel oda gerekli rol static binding kaydinda dogrulanamadi.',
        bindings: bindings.roles,
      })
    );
  } else {
    checks.push(
      toCheck({
        id: 'private-vc-hub-channel',
        title: 'Oda olusturma hub kanali',
        status: STATUS_READY,
        reasonCode: 'private_vc_hub_channel_not_required',
        description: 'Sistem pasif oldugu icin bu ayar zorunlu degil.',
        targetType: 'channel',
        targetKey: 'private_vc_hub_channel',
      })
    );
    checks.push(
      toCheck({
        id: 'private-vc-required-role',
        title: 'Ozel oda gerekli rol',
        status: STATUS_READY,
        reasonCode: 'private_vc_required_role_not_required',
        description: 'Sistem pasif oldugu icin bu ayar zorunlu degil.',
        targetType: 'role',
        targetKey: 'private_vc_required_role',
      })
    );
  }

  const configuredCategoryId =
    privateVoiceConfig.categoryId || settings.private_vc_category || null;
  if (!configuredCategoryId) {
    checks.push(
      toCheck({
        id: 'private-vc-category',
        title: 'Ozel oda kategori bagi',
        status: STATUS_WARNING,
        reasonCode: 'private_vc_category_not_set',
        description:
          'Ozel oda kategori ayari bos. Bu ayar opsiyoneldir ancak duzenli kurulum icin onerilir.',
        targetType: 'category',
        targetKey: 'private_vc_category',
        severity: 'info',
      })
    );
  } else if (!isSnowflake(configuredCategoryId)) {
    checks.push(
      toCheck({
        id: 'private-vc-category',
        title: 'Ozel oda kategori bagi',
        status: STATUS_INCOMPLETE,
        reasonCode: 'private_vc_category_invalid',
        description: 'Ozel oda kategori ID formati gecersiz.',
        targetType: 'category',
        targetKey: 'private_vc_category',
      })
    );
  } else if (hasBindingValue(bindings.categories, configuredCategoryId)) {
    checks.push(
      toCheck({
        id: 'private-vc-category',
        title: 'Ozel oda kategori bagi',
        status: STATUS_READY,
        reasonCode: null,
        description: 'Ozel oda kategori ayari static binding kayitlarinda goruldu.',
        targetType: 'category',
        targetKey: 'private_vc_category',
      })
    );
  } else {
    checks.push(
      toCheck({
        id: 'private-vc-category',
        title: 'Ozel oda kategori bagi',
        status: STATUS_WARNING,
        reasonCode: 'private_vc_category_unverified',
        description:
          'Ozel oda kategori varligi static binding kayitlarindan dogrulanamadi.',
        targetType: 'category',
        targetKey: 'private_vc_category',
      })
    );
  }

  return {
    id: 'private-room',
    title: 'Ozel Oda Sistemi',
    status: toSectionStatus(checks),
    checks,
  };
}

function buildStartupVoiceSection({
  settings = {},
  startupVoiceConfig = {},
  bindings = {},
} = {}) {
  const checks = [];
  const staticChannelId = String(settings.startup_voice_channel_id || '').trim();
  const resolvedChannelId = String(startupVoiceConfig.channelId || '').trim();

  if (!resolvedChannelId) {
    checks.push(
      toCheck({
        id: 'startup-voice-configured',
        title: 'Baslangic ses kanali ayari',
        status: STATUS_WARNING,
        reasonCode: 'startup_voice_channel_not_configured',
        description:
          'startup_voice_channel_id ayari bulunamadi. Bot acilisinda ses kanalina katilim yapmaz.',
        targetType: 'channel',
        targetKey: 'startup_voice_channel_id',
        severity: 'info',
      })
    );
  } else {
    if (staticChannelId) {
      checks.push(
        toCheck({
          id: 'startup-voice-config-source',
          title: 'Baslangic ses kanali kaynak',
          status: STATUS_READY,
          reasonCode: 'startup_voice_channel_static_configured',
          description: 'Baslangic ses kanali static config uzerinden ayarlanmis.',
          targetType: 'config',
          targetKey: 'startup_voice_channel_id',
        })
      );
    } else {
      checks.push(
        toCheck({
          id: 'startup-voice-config-source',
          title: 'Baslangic ses kanali kaynak',
          status: STATUS_WARNING,
          reasonCode: 'startup_voice_channel_env_fallback',
          description:
            'Static ayar bos, startup ses kanali env fallback ile cozuldu.',
          targetType: 'config',
          targetKey: 'startup_voice_channel_id',
          severity: 'info',
        })
      );
    }

    if (!isSnowflake(resolvedChannelId)) {
      checks.push(
        toCheck({
          id: 'startup-voice-channel-id',
          title: 'Baslangic ses kanali ID formati',
          status: STATUS_INCOMPLETE,
          reasonCode: 'startup_voice_channel_invalid',
          description: 'Baslangic ses kanal ID formati gecersiz.',
          targetType: 'channel',
          targetKey: 'startup_voice_channel_id',
        })
      );
    } else if (hasBindingValue(bindings.channels, resolvedChannelId)) {
      checks.push(
        toCheck({
          id: 'startup-voice-channel-id',
          title: 'Baslangic ses kanali kaydi',
          status: STATUS_READY,
          reasonCode: null,
          description: 'Baslangic ses kanali static binding kayitlarinda goruldu.',
          targetType: 'channel',
          targetKey: 'startup_voice_channel_id',
        })
      );
    } else {
      checks.push(
        toCheck({
          id: 'startup-voice-channel-id',
          title: 'Baslangic ses kanali kaydi',
          status: STATUS_WARNING,
          reasonCode: 'startup_voice_channel_unverified',
          description:
            'Baslangic ses kanali varligi static binding kayitlarindan dogrulanamadi.',
          targetType: 'channel',
          targetKey: 'startup_voice_channel_id',
        })
      );
    }
  }

  return {
    id: 'startup-voice',
    title: 'Baslangic Ses Kanali',
    status: toSectionStatus(checks),
    checks,
  };
}

function buildModerationRolesSection({ settings = {}, bindings = {} } = {}) {
  const checks = [];

  const muteEnabled = settings.mute_enabled === true;
  const muteRoleId = String(settings.mute_penalty_role || '').trim();
  if (!muteEnabled) {
    checks.push(
      toCheck({
        id: 'moderation-mute-role',
        title: 'Mute ceza rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_mute_disabled',
        description: 'Mute komut politikasi pasif oldugu icin mute ceza rolu zorunlu degil.',
        targetType: 'role',
        targetKey: 'mute_penalty_role',
        severity: 'info',
      })
    );
  } else if (!muteRoleId) {
    checks.push(
      toCheck({
        id: 'moderation-mute-role',
        title: 'Mute ceza rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_mute_role_not_configured',
        description: 'Mute aktif ancak mute_penalty_role ayari bulunamadi.',
        targetType: 'role',
        targetKey: 'mute_penalty_role',
      })
    );
  } else if (!isSnowflake(muteRoleId)) {
    checks.push(
      toCheck({
        id: 'moderation-mute-role',
        title: 'Mute ceza rolu',
        status: STATUS_INCOMPLETE,
        reasonCode: 'moderation_mute_role_invalid',
        description: 'mute_penalty_role ID formati gecersiz.',
        targetType: 'role',
        targetKey: 'mute_penalty_role',
      })
    );
  } else if (hasBindingValue(bindings.roles, muteRoleId)) {
    checks.push(
      toCheck({
        id: 'moderation-mute-role',
        title: 'Mute ceza rolu',
        status: STATUS_READY,
        reasonCode: null,
        description: 'Mute ceza rolu static binding kayitlarinda goruldu.',
        targetType: 'role',
        targetKey: 'mute_penalty_role',
      })
    );
  } else {
    checks.push(
      toCheck({
        id: 'moderation-mute-role',
        title: 'Mute ceza rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_mute_role_unverified',
        description: 'Mute ceza rolu varligi static binding kayitlarindan dogrulanamadi.',
        targetType: 'role',
        targetKey: 'mute_penalty_role',
      })
    );
  }

  const jailEnabled = settings.jail_enabled === true;
  const jailRoleId = String(settings.jail_penalty_role || '').trim();
  if (!jailEnabled) {
    checks.push(
      toCheck({
        id: 'moderation-jail-role',
        title: 'Jail ceza rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_jail_disabled',
        description: 'Jail komut politikasi pasif oldugu icin jail ceza rolu zorunlu degil.',
        targetType: 'role',
        targetKey: 'jail_penalty_role',
        severity: 'info',
      })
    );
  } else if (!jailRoleId) {
    checks.push(
      toCheck({
        id: 'moderation-jail-role',
        title: 'Jail ceza rolu',
        status: STATUS_INCOMPLETE,
        reasonCode: 'moderation_jail_role_missing',
        description: 'Jail aktif ancak jail_penalty_role ayari bulunamadi.',
        targetType: 'role',
        targetKey: 'jail_penalty_role',
      })
    );
  } else if (!isSnowflake(jailRoleId)) {
    checks.push(
      toCheck({
        id: 'moderation-jail-role',
        title: 'Jail ceza rolu',
        status: STATUS_INCOMPLETE,
        reasonCode: 'moderation_jail_role_invalid',
        description: 'jail_penalty_role ID formati gecersiz.',
        targetType: 'role',
        targetKey: 'jail_penalty_role',
      })
    );
  } else if (hasBindingValue(bindings.roles, jailRoleId)) {
    checks.push(
      toCheck({
        id: 'moderation-jail-role',
        title: 'Jail ceza rolu',
        status: STATUS_READY,
        reasonCode: null,
        description: 'Jail ceza rolu static binding kayitlarinda goruldu.',
        targetType: 'role',
        targetKey: 'jail_penalty_role',
      })
    );
  } else {
    checks.push(
      toCheck({
        id: 'moderation-jail-role',
        title: 'Jail ceza rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_jail_role_unverified',
        description: 'Jail ceza rolu varligi static binding kayitlarindan dogrulanamadi.',
        targetType: 'role',
        targetKey: 'jail_penalty_role',
      })
    );
  }

  const lockEnabled = settings.lock_enabled === true;
  const lockRoleId = String(settings.lock_role || '').trim();
  if (!lockEnabled) {
    checks.push(
      toCheck({
        id: 'moderation-lock-role',
        title: 'Lock rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_lock_disabled',
        description: 'Lock komut politikasi pasif oldugu icin lock rolu zorunlu degil.',
        targetType: 'role',
        targetKey: 'lock_role',
        severity: 'info',
      })
    );
  } else if (!lockRoleId) {
    checks.push(
      toCheck({
        id: 'moderation-lock-role',
        title: 'Lock rolu',
        status: STATUS_INCOMPLETE,
        reasonCode: 'moderation_lock_role_missing',
        description: 'Lock aktif ancak lock_role ayari bulunamadi.',
        targetType: 'role',
        targetKey: 'lock_role',
      })
    );
  } else if (!isSnowflake(lockRoleId)) {
    checks.push(
      toCheck({
        id: 'moderation-lock-role',
        title: 'Lock rolu',
        status: STATUS_INCOMPLETE,
        reasonCode: 'moderation_lock_role_invalid',
        description: 'lock_role ID formati gecersiz.',
        targetType: 'role',
        targetKey: 'lock_role',
      })
    );
  } else if (hasBindingValue(bindings.roles, lockRoleId)) {
    checks.push(
      toCheck({
        id: 'moderation-lock-role',
        title: 'Lock rolu',
        status: STATUS_READY,
        reasonCode: null,
        description: 'Lock rolu static binding kayitlarinda goruldu.',
        targetType: 'role',
        targetKey: 'lock_role',
      })
    );
  } else {
    checks.push(
      toCheck({
        id: 'moderation-lock-role',
        title: 'Lock rolu',
        status: STATUS_WARNING,
        reasonCode: 'moderation_lock_role_unverified',
        description: 'Lock rolu varligi static binding kayitlarindan dogrulanamadi.',
        targetType: 'role',
        targetKey: 'lock_role',
      })
    );
  }

  return {
    id: 'moderation-roles',
    title: 'Moderasyon Rolleri',
    status: toSectionStatus(checks),
    checks,
  };
}

function buildTagRoleSection({
  settings = {},
  tagRoleConfig = {},
  bindings = {},
} = {}) {
  const checks = [];
  const tagEnabled = tagRoleConfig.enabled === true || settings.tag_enabled === true;

  checks.push(
    toCheck({
      id: 'tag-role-enabled',
      title: 'Tag rol sistemi aktifligi',
      status: tagEnabled ? STATUS_READY : STATUS_WARNING,
      reasonCode: tagEnabled ? 'tag_enabled' : 'tag_disabled',
      description: tagEnabled
        ? 'Tag rol sistemi aktif.'
        : 'Tag rol sistemi pasif. Gerekiyorsa panel sonraki asamada acilabilir.',
      targetType: 'config',
      targetKey: 'tag_enabled',
      severity: tagEnabled ? null : 'info',
    })
  );

  if (tagEnabled) {
    const roleId = String(tagRoleConfig.roleId || settings.tag_role || '').trim();
    if (!roleId) {
      checks.push(
        toCheck({
          id: 'tag-role-id',
          title: 'Tag rol ayari',
          status: STATUS_INCOMPLETE,
          reasonCode: 'tag_role_missing',
          description: 'Tag sistemi aktif ancak tag_role ayari bulunamadi.',
          targetType: 'role',
          targetKey: 'tag_role',
        })
      );
    } else if (!isSnowflake(roleId)) {
      checks.push(
        toCheck({
          id: 'tag-role-id',
          title: 'Tag rol ayari',
          status: STATUS_INCOMPLETE,
          reasonCode: 'tag_role_invalid',
          description: 'tag_role ID formati gecersiz.',
          targetType: 'role',
          targetKey: 'tag_role',
        })
      );
    } else if (hasBindingValue(bindings.roles, roleId)) {
      checks.push(
        toCheck({
          id: 'tag-role-id',
          title: 'Tag rol ayari',
          status: STATUS_READY,
          reasonCode: null,
          description: 'Tag rolu static binding kayitlarinda goruldu.',
          targetType: 'role',
          targetKey: 'tag_role',
        })
      );
    } else {
      checks.push(
        toCheck({
          id: 'tag-role-id',
          title: 'Tag rol ayari',
          status: STATUS_WARNING,
          reasonCode: 'tag_role_unverified',
          description: 'Tag rolu varligi static binding kayitlarindan dogrulanamadi.',
          targetType: 'role',
          targetKey: 'tag_role',
        })
      );
    }

    const tagText = String(tagRoleConfig.tagText || settings.tag_text || '').trim();
    if (!tagText) {
      checks.push(
        toCheck({
          id: 'tag-text',
          title: 'Tag metni',
          status: STATUS_INCOMPLETE,
          reasonCode: 'tag_text_missing',
          description: 'Tag sistemi aktif ancak tag_text ayari bulunamadi.',
          targetType: 'config',
          targetKey: 'tag_text',
        })
      );
    } else {
      checks.push(
        toCheck({
          id: 'tag-text',
          title: 'Tag metni',
          status: STATUS_READY,
          reasonCode: null,
          description: 'Tag metni ayari bulundu.',
          targetType: 'config',
          targetKey: 'tag_text',
        })
      );
    }
  } else {
    checks.push(
      toCheck({
        id: 'tag-role-id',
        title: 'Tag rol ayari',
        status: STATUS_READY,
        reasonCode: 'tag_role_not_required',
        description: 'Tag sistemi pasif oldugu icin rol ayari zorunlu degil.',
        targetType: 'role',
        targetKey: 'tag_role',
      })
    );
    checks.push(
      toCheck({
        id: 'tag-text',
        title: 'Tag metni',
        status: STATUS_READY,
        reasonCode: 'tag_text_not_required',
        description: 'Tag sistemi pasif oldugu icin metin ayari zorunlu degil.',
        targetType: 'config',
        targetKey: 'tag_text',
      })
    );
  }

  return {
    id: 'tag-role',
    title: 'Tag Rol Sistemi',
    status: toSectionStatus(checks),
    checks,
  };
}

function buildCommandPolicySection({ settings = {} } = {}) {
  const checks = COMMAND_POLICY_FLAGS.map((flag) => {
    const rawValue = settings[flag.key];
    if (typeof rawValue === 'boolean') {
      return toCheck({
        id: `command-policy-${flag.key}`,
        title: flag.title,
        status: STATUS_READY,
        reasonCode: null,
        description: `Mevcut durum: ${rawValue ? 'acik' : 'kapali'} (salt-okunur gorunum).`,
        targetType: 'config',
        targetKey: flag.key,
      });
    }
    return toCheck({
      id: `command-policy-${flag.key}`,
      title: flag.title,
      status: STATUS_WARNING,
      reasonCode: 'command_policy_flag_missing',
      description: 'Komut politikasinin mevcut durumu okunamadi.',
      targetType: 'config',
      targetKey: flag.key,
    });
  });

  return {
    id: 'command-policy',
    title: 'Komut Politikalari',
    status: toSectionStatus(checks),
    checks,
  };
}

function buildFallbackPayload(guildId = null) {
  const checks = [
    toCheck({
      id: 'guild-scope-missing',
      title: 'Sunucu kapsami',
      status: STATUS_INCOMPLETE,
      reasonCode: 'setup_readiness_guild_missing',
      description: 'Kurulum durumu icin guild kapsami cozulmedi.',
      targetType: 'config',
      targetKey: 'guildId',
    }),
  ];
  const section = {
    id: 'static-config',
    title: 'Statik Yapilandirma',
    status: STATUS_INCOMPLETE,
    checks,
  };
  const summary = toSummary([section]);
  return {
    contractVersion: CONTRACT_VERSION,
    guildId: guildId || null,
    summary,
    sections: [section],
    issues: checks.map(toIssueFromCheck).filter(Boolean),
  };
}

function createSetupReadinessProvider({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  getStaticGuildSettings = () => ({}),
  getStaticGuildBindings = () => ({}),
  getPrivateVoiceConfig = () => ({}),
  getTagRoleConfig = () => ({}),
  getStartupVoiceConfig = () => ({}),
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  return function getSetupReadiness({ query = {}, requestContext = {} } = {}) {
    const configuredStaticGuildIds = Array.isArray(getConfiguredStaticGuildIds?.())
      ? getConfiguredStaticGuildIds()
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      : [];
    const requestScopedGuildId = normalizeGuildId(requestContext?.guildScope?.guildId);
    const requestedGuildId = normalizeQueryGuildId(query);
    const fallbackScope = resolveGuildScope({
      config,
      requestedGuildId,
      getConfiguredStaticGuildIds,
    });
    const guildId = requestScopedGuildId || normalizeGuildId(fallbackScope?.guildId);

    if (!guildId) {
      return buildFallbackPayload(requestedGuildId || null);
    }

    const settings = toSafeObject(getStaticGuildSettings(guildId));
    const bindings = toSafeObject(getStaticGuildBindings(guildId));
    const privateVoiceConfig = toSafeObject(getPrivateVoiceConfig(guildId));
    const tagRoleConfig = toSafeObject(getTagRoleConfig(guildId));
    const startupVoiceConfig = toSafeObject(getStartupVoiceConfig(guildId));
    const hasExplicitStaticConfig = configuredStaticGuildIds.includes(guildId);

    const sections = [
      buildStaticConfigSection({
        guildId,
        hasExplicitStaticConfig,
      }),
      buildPrivateRoomSection({
        settings,
        privateVoiceConfig,
        bindings,
      }),
      buildStartupVoiceSection({
        settings,
        startupVoiceConfig,
        bindings,
      }),
      buildModerationRolesSection({
        settings,
        bindings,
      }),
      buildTagRoleSection({
        settings,
        tagRoleConfig,
        bindings,
      }),
      buildCommandPolicySection({
        settings,
      }),
    ];

    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const orderedSections = SECTION_DEFINITIONS.map((sectionDef) => {
      const existing = sectionById.get(sectionDef.id);
      if (existing) return existing;
      return {
        id: sectionDef.id,
        title: sectionDef.title,
        status: STATUS_WARNING,
        checks: [],
      };
    });

    const issues = orderedSections
      .flatMap((section) =>
        (Array.isArray(section?.checks) ? section.checks : [])
          .map((check) => toIssueFromCheck(check))
          .filter(Boolean)
      )
      .sort((left, right) => {
        const rank = { error: 0, warning: 1, info: 2 };
        return (rank[left?.severity] ?? 3) - (rank[right?.severity] ?? 3);
      });
    const summary = toSummary(orderedSections);

    return {
      contractVersion: CONTRACT_VERSION,
      guildId,
      summary,
      sections: orderedSections,
      issues,
    };
  };
}

module.exports = {
  CONTRACT_VERSION,
  STATUS_READY,
  STATUS_WARNING,
  STATUS_INCOMPLETE,
  createSetupReadinessProvider,
};
