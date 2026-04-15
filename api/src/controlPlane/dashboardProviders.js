const { resolveDashboardGuildScope } = require('./guildScope');

function normalizeQueryGuildId(query = {}) {
  if (!query || typeof query !== 'object') return null;
  const value = query.guildId;
  if (Array.isArray(value)) return String(value[0] || '').trim() || null;
  return String(value || '').trim() || null;
}

function toRecordCount(record) {
  if (!record || typeof record !== 'object') return 0;
  return Object.keys(record).length;
}

function toNestedRecordCount(record = {}) {
  if (!record || typeof record !== 'object') return 0;
  return Object.values(record).reduce((sum, value) => sum + toRecordCount(value), 0);
}

function toIdListCount(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean).length;
}

function buildScopeSummary(scope) {
  return {
    mode: scope.mode,
    valid: scope.valid,
    reasonCode: scope.reasonCode,
    guildId: scope.guildId,
    requestedGuildId: scope.requestedGuildId,
    hasAuthoritativeGuild: scope.hasAuthoritativeGuild,
    configuredStaticGuildCount: scope.configuredStaticGuildCount,
    hasConfiguredStaticGuild: scope.hasConfiguredStaticGuild,
  };
}

function createDashboardOverviewProvider({
  config,
  getStartupPhase = () => 'unknown_phase',
  getClientReady = () => false,
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  return function getDashboardOverview({ query } = {}) {
    const scope = resolveGuildScope({
      config,
      requestedGuildId: normalizeQueryGuildId(query),
      getConfiguredStaticGuildIds,
    });

    return {
      contractVersion: 1,
      mode: 'read_only',
      runtime: {
        nodeEnv: String(config?.nodeEnv || 'development'),
        startupPhase: String(getStartupPhase() || 'unknown_phase'),
        discordGatewayReady: Boolean(getClientReady()),
        controlPlaneEnabled: Boolean(config?.controlPlane?.enabled),
      },
      guildScope: buildScopeSummary(scope),
      now: new Date().toISOString(),
    };
  };
}

function createDashboardGuildProvider({
  config,
  getConfiguredStaticGuildIds = () => [],
  getStaticGuildSettings = () => ({}),
  getStaticGuildBindings = () => ({}),
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  return function getDashboardGuild({ query } = {}) {
    const scope = resolveGuildScope({
      config,
      requestedGuildId: normalizeQueryGuildId(query),
      getConfiguredStaticGuildIds,
    });
    const settings = scope.guildId ? getStaticGuildSettings(scope.guildId) : null;
    const bindings = scope.guildId ? getStaticGuildBindings(scope.guildId) : null;

    return {
      contractVersion: 1,
      guildScope: buildScopeSummary(scope),
      guild: scope.guildId
        ? {
            id: scope.guildId,
            prefix: String(settings?.prefix || '.'),
            hasExplicitStaticConfig: scope.hasConfiguredStaticGuild,
            startupVoiceChannelConfigured: Boolean(settings?.startup_voice_channel_id || config?.discord?.startupVoiceChannelId),
            bindingCounts: {
              roles: toRecordCount(bindings?.roles),
              channels: toRecordCount(bindings?.channels),
              categories: toRecordCount(bindings?.categories),
              emojiGroups: toRecordCount(bindings?.emojis),
              emojis: toNestedRecordCount(bindings?.emojis),
            },
          }
        : null,
    };
  };
}

function createDashboardFeaturesProvider({
  config,
  getConfiguredStaticGuildIds = () => [],
  getStaticGuildSettings = () => ({}),
  getPrivateVoiceConfig = () => ({}),
  getTagRoleConfig = () => ({}),
  getStartupVoiceConfig = () => ({}),
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  return function getDashboardFeatures({ query } = {}) {
    const scope = resolveGuildScope({
      config,
      requestedGuildId: normalizeQueryGuildId(query),
      getConfiguredStaticGuildIds,
    });
    const settings = scope.guildId ? getStaticGuildSettings(scope.guildId) : {};
    const privateVoice = scope.guildId ? getPrivateVoiceConfig(scope.guildId) : {};
    const tagRole = scope.guildId ? getTagRoleConfig(scope.guildId) : {};
    const startupVoice = scope.guildId ? getStartupVoiceConfig(scope.guildId) : {};

    return {
      contractVersion: 1,
      guildScope: buildScopeSummary(scope),
      features: {
        moderation: {
          logEnabled: settings.log_enabled === true,
          warnEnabled: settings.warn_enabled === true,
          muteEnabled: settings.mute_enabled === true,
          kickEnabled: settings.kick_enabled === true,
          jailEnabled: settings.jail_enabled === true,
          banEnabled: settings.ban_enabled === true,
          lockEnabled: settings.lock_enabled === true,
        },
        tagRole: {
          enabled: tagRole.enabled === true,
          roleConfigured: Boolean(tagRole.roleId),
          tagTextConfigured: Boolean(tagRole.tagText),
        },
        privateVoice: {
          enabled: privateVoice.enabled === true,
          hubChannelConfigured: Boolean(privateVoice.hubChannelId),
          requiredRoleConfigured: Boolean(privateVoice.requiredRoleId),
          categoryConfigured: Boolean(privateVoice.categoryId),
        },
        startupVoiceAutoJoin: {
          channelConfigured: Boolean(startupVoice.channelId),
        },
        controlPlane: {
          enabled: Boolean(config?.controlPlane?.enabled),
          readOnly: true,
        },
      },
    };
  };
}

function createDashboardResourcesProvider({
  config,
  getConfiguredStaticGuildIds = () => [],
  getStaticGuildSettings = () => ({}),
  getStaticGuildBindings = () => ({}),
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  return function getDashboardResources({ query } = {}) {
    const scope = resolveGuildScope({
      config,
      requestedGuildId: normalizeQueryGuildId(query),
      getConfiguredStaticGuildIds,
    });
    const settings = scope.guildId ? getStaticGuildSettings(scope.guildId) : {};
    const bindings = scope.guildId ? getStaticGuildBindings(scope.guildId) : {};

    return {
      contractVersion: 1,
      guildScope: buildScopeSummary(scope),
      resources: {
        staticConfig: {
          configuredGuildCount: scope.configuredStaticGuildCount,
          selectedGuildHasExplicitConfig: scope.hasConfiguredStaticGuild,
        },
        bindings: {
          roleCount: toRecordCount(bindings.roles),
          channelCount: toRecordCount(bindings.channels),
          categoryCount: toRecordCount(bindings.categories),
          emojiGroupCount: toRecordCount(bindings.emojis),
          emojiCount: toNestedRecordCount(bindings.emojis),
        },
        roleConfiguration: {
          lockRoleConfigured: Boolean(settings.lock_role),
          tagRoleConfigured: Boolean(settings.tag_role),
          mutePenaltyRoleConfigured: Boolean(settings.mute_penalty_role),
          jailPenaltyRoleConfigured: Boolean(settings.jail_penalty_role),
          privateVoiceRequiredRoleConfigured: Boolean(settings.private_vc_required_role),
        },
        protectedEntityCounts: {
          hardProtectedRoles: toIdListCount(settings.hard_protected_roles),
          hardProtectedUsers: toIdListCount(settings.hard_protected_users),
          staffHierarchyRoles: toIdListCount(settings.staff_hierarchy_roles),
        },
        infrastructure: {
          databaseConfigured: Boolean(
            config?.db?.url || (config?.db?.host && config?.db?.user && config?.db?.database)
          ),
          databaseSslEnabled: Boolean(config?.db?.ssl),
          cacheMaxKeys: Number(config?.cache?.maxKeys || 0),
          rateLimitWindowMs: Number(config?.rateLimit?.windowMs || 0),
        },
      },
    };
  };
}

module.exports = {
  createDashboardFeaturesProvider,
  createDashboardGuildProvider,
  createDashboardOverviewProvider,
  createDashboardResourcesProvider,
};
