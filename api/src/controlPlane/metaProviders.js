function createRuntimeMetaProvider({
  config,
  getStartupPhase = () => 'unknown_phase',
  getClientReady = () => false,
  processRef = process,
  startedAtMs = Date.now(),
} = {}) {
  const bootTimestamp = Number.isFinite(Number(startedAtMs)) ? Number(startedAtMs) : Date.now();

  return function getRuntimeMeta() {
    const uptimeRaw = typeof processRef?.uptime === 'function' ? processRef.uptime() : 0;
    const uptimeSec = Number.isFinite(Number(uptimeRaw)) ? Number(Number(uptimeRaw).toFixed(3)) : 0;

    return {
      mode: 'read_only',
      controlPlaneEnabled: Boolean(config?.controlPlane?.enabled),
      controlPlaneAuthEnabled: Boolean(config?.controlPlane?.auth?.enabled),
      controlPlaneAuthConfigured: Boolean(config?.controlPlane?.auth?.configured),
      nodeEnv: String(config?.nodeEnv || 'development'),
      startupPhase: String(getStartupPhase() || 'unknown_phase'),
      discordGatewayReady: Boolean(getClientReady()),
      process: {
        pid: Number(processRef?.pid || 0),
        uptimeSec,
        startedAt: new Date(bootTimestamp).toISOString(),
      },
      now: new Date().toISOString(),
    };
  };
}

function createCapabilitiesProvider({
  config,
  additionalEndpoints = [],
  mutableRoutesEnabled = false,
} = {}) {
  const baseEndpoints = [
    'GET /health',
    'GET /api/meta/runtime',
    'GET /api/meta/capabilities',
    'GET /api/meta/config-summary',
  ];
  const uniqueEndpoints = [...new Set([...baseEndpoints, ...additionalEndpoints])];
  const authEnabled = Boolean(config?.controlPlane?.auth?.enabled);
  const authConfigured = Boolean(config?.controlPlane?.auth?.configured);

  return function getCapabilities() {
    return {
      mode: 'read_only',
      controlPlaneEnabled: Boolean(config?.controlPlane?.enabled),
      authRequired: false,
      authEnabled,
      authConfigured,
      authRequiredForProtectedRoutes: authEnabled,
      mutableRoutesEnabled: Boolean(mutableRoutesEnabled),
      endpoints: uniqueEndpoints,
      excludedUntilNextPhase: mutableRoutesEnabled
        ? ['dangerous_bot_mutation_routes', 'premium_entitlements_routes']
        : ['dashboard_mutation_routes', 'moderation_action_routes'],
    };
  };
}

function createConfigSummaryProvider({
  config,
  getConfiguredStaticGuildIds = () => [],
} = {}) {
  return function getConfigSummary() {
    const configuredGuildIds = Array.isArray(getConfiguredStaticGuildIds?.())
      ? getConfiguredStaticGuildIds()
      : [];
    const manualPlanOverrides =
      config?.controlPlane?.premium?.manualPlanOverrides &&
      typeof config.controlPlane.premium.manualPlanOverrides === 'object'
        ? config.controlPlane.premium.manualPlanOverrides
        : {};

    return {
      nodeEnv: String(config?.nodeEnv || 'development'),
      logging: {
        format: String(config?.logging?.format || 'text'),
      },
      network: {
        trustProxy: Boolean(config?.trustProxy),
      },
      controlPlane: {
        enabled: Boolean(config?.controlPlane?.enabled),
        readOnly: true,
        auth: {
          enabled: Boolean(config?.controlPlane?.auth?.enabled),
          configured: Boolean(config?.controlPlane?.auth?.configured),
          cookieSecure: Boolean(config?.controlPlane?.auth?.cookieSecure),
          sessionTtlMs: Number(config?.controlPlane?.auth?.sessionTtlMs || 0),
        },
        premium: {
          defaultPlan: String(config?.controlPlane?.premium?.defaultPlan || 'free'),
          manualOverrideCount: Object.keys(manualPlanOverrides).length,
          billingProviderIntegrated: false,
        },
        sharedState: {
          enabled: Boolean(config?.controlPlane?.sharedState?.enabled),
          provider: String(config?.controlPlane?.sharedState?.provider || 'memory'),
          redisConfigured: Boolean(config?.controlPlane?.sharedState?.redis?.url),
          redisFallbackToMemory:
            config?.controlPlane?.sharedState?.redis?.fallbackToMemory !== false,
        },
        scheduler: {
          enabled: Boolean(config?.controlPlane?.scheduler?.enabled),
          provider: String(config?.controlPlane?.scheduler?.provider || 'memory'),
          fallbackToMemory:
            config?.controlPlane?.scheduler?.fallbackToMemory !== false,
          adoption: {
            authExpiryCleanupEnabled: Boolean(
              config?.controlPlane?.scheduler?.adoption?.authExpiryCleanupEnabled
            ),
          },
          hardened: {
            redisConfigured: Boolean(
              config?.controlPlane?.scheduler?.hardened?.redis?.url
            ),
            redisFallbackToMemory:
              config?.controlPlane?.scheduler?.hardened?.redis?.fallbackToMemory !==
              false,
          },
        },
      },
      discord: {
        tokenConfigured: Boolean(config?.discord?.token),
        targetGuildConfigured: Boolean(config?.discord?.targetGuildId),
        startupVoiceChannelConfigured: Boolean(config?.discord?.startupVoiceChannelId),
      },
      oauth: {
        clientConfigured: Boolean(config?.oauth?.clientId),
        redirectConfigured: Boolean(config?.oauth?.redirectUri),
      },
      database: {
        hasDatabaseUrl: Boolean(config?.db?.url),
        hasDiscreteCredentials: Boolean(config?.db?.host && config?.db?.user && config?.db?.database),
        sslEnabled: Boolean(config?.db?.ssl),
      },
      staticConfig: {
        configuredGuildCount: configuredGuildIds.length,
      },
      rateLimit: {
        windowMs: Number(config?.rateLimit?.windowMs || 0),
        authMax: Number(config?.rateLimit?.authMax || 0),
        apiMax: Number(config?.rateLimit?.apiMax || 0),
      },
      cache: {
        maxKeys: Number(config?.cache?.maxKeys || 0),
        pruneTick: Number(config?.cache?.pruneTick || 0),
      },
    };
  };
}

module.exports = {
  createCapabilitiesProvider,
  createConfigSummaryProvider,
  createRuntimeMetaProvider,
};
