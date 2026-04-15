const { createAuthContextResolver, normalizeAuthAvailability } = require('./authBoundary');
const { createAuthRouteDefinitions } = require('./authRoutes');
const { createDiscordOauthClient } = require('./oauthClient');
const { createOauthStateStoreFromStateStore } = require('./oauthStateStore');
const { createSessionRepositoryFromStateStore } = require('./sessionRepository');
const { createSessionCookieManager } = require('./sessionCookie');
const { resolveDashboardGuildScope } = require('./guildScope');
const { createSharedStateBackendSelector } = require('../sharedState/stateBackendSelector');
const { createJobScheduler } = require('../scheduler');

function resolveAuthAvailability({
  config = {},
  oauthClientConfigured = false,
  sessionCookieConfigured = false,
} = {}) {
  const enabled = Boolean(config?.controlPlane?.auth?.enabled);
  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      reasonCode: 'auth_disabled',
    };
  }

  if (!oauthClientConfigured) {
    return {
      enabled: true,
      configured: false,
      reasonCode: 'oauth_config_missing',
    };
  }

  if (!sessionCookieConfigured) {
    return {
      enabled: true,
      configured: false,
      reasonCode: 'session_secret_missing',
    };
  }

  return {
    enabled: true,
    configured: true,
    reasonCode: null,
  };
}

function createControlPlaneAuthFoundation({
  config = {},
  fetchImpl = globalThis.fetch,
  oauthClient = null,
  oauthStateStore = null,
  sessionRepository = null,
  sessionCookieManager = null,
  scheduler = null,
  sharedStateBackend = null,
  sharedStateRedisClientFactory = null,
  schedulerSharedStateRedisClientFactory = null,
  nowFn = Date.now,
  randomBytesFn = undefined,
  logError = null,
  getConfiguredStaticGuildIds = () => [],
  featureGateEvaluator = null,
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const resolvedOauthClient =
    oauthClient ||
    createDiscordOauthClient({
      clientId: config?.oauth?.clientId,
      clientSecret: config?.oauth?.clientSecret,
      redirectUri: config?.oauth?.redirectUri,
      scope: 'identify guilds',
      fetchImpl,
    });

  const resolvedSessionCookieManager =
    sessionCookieManager ||
    createSessionCookieManager({
      cookieName: config?.controlPlane?.auth?.sessionCookieName,
      secret: config?.controlPlane?.auth?.sessionSecret,
      secure: Boolean(config?.controlPlane?.auth?.cookieSecure),
      sameSite: config?.controlPlane?.auth?.cookieSameSite || 'Lax',
      path: '/',
      maxAgeSec: Number(config?.controlPlane?.auth?.sessionTtlMs || 0) > 0
        ? Math.floor(Number(config.controlPlane.auth.sessionTtlMs) / 1000)
        : 8 * 60 * 60,
    });

  const resolvedSharedStateBackend =
    sharedStateBackend ||
    createSharedStateBackendSelector({
      config,
      nowFn,
      redisClientFactory: sharedStateRedisClientFactory,
    });
  const sharedStateStore =
    resolvedSharedStateBackend?.store && typeof resolvedSharedStateBackend.store === 'object'
      ? resolvedSharedStateBackend.store
      : null;
  const resolvedScheduler =
    scheduler ||
    createJobScheduler({
      config,
      nowFn,
      ...(typeof randomBytesFn === 'function' ? { randomBytesFn } : {}),
      sharedStateRedisClientFactory:
        schedulerSharedStateRedisClientFactory || sharedStateRedisClientFactory,
      ...(typeof logError === 'function' ? { logError } : {}),
    });
  const schedulerSummary =
    typeof resolvedScheduler?.getSummary === 'function'
      ? resolvedScheduler.getSummary()
      : null;
  const authExpirySchedulerEnabled = Boolean(
    schedulerSummary?.scheduler?.enabled &&
      schedulerSummary?.scheduler?.adoption?.authExpiryCleanupEnabled
  );

  const resolvedSessionRepository =
    sessionRepository ||
    createSessionRepositoryFromStateStore({
      stateStore: sharedStateStore,
      sessionTtlMs: Number(config?.controlPlane?.auth?.sessionTtlMs || 0) || 8 * 60 * 60 * 1000,
      nowFn,
      expiryScheduler: resolvedScheduler,
      enableScheduledExpiryCleanup: authExpirySchedulerEnabled,
      ...(typeof randomBytesFn === 'function' ? { randomBytesFn } : {}),
    });

  const resolvedOauthStateStore =
    oauthStateStore ||
    createOauthStateStoreFromStateStore({
      stateStore: sharedStateStore,
      stateTtlMs: Number(config?.controlPlane?.auth?.oauthStateTtlMs || 0) || 10 * 60 * 1000,
      nowFn,
      expiryScheduler: resolvedScheduler,
      enableScheduledExpiryCleanup: authExpirySchedulerEnabled,
      ...(typeof randomBytesFn === 'function' ? { randomBytesFn } : {}),
    });

  const authAvailability = normalizeAuthAvailability(
    resolveAuthAvailability({
      config,
      oauthClientConfigured: Boolean(resolvedOauthClient?.configured),
      sessionCookieConfigured: Boolean(resolvedSessionCookieManager?.isConfigured?.()),
    })
  );

  const resolveAuthContext = createAuthContextResolver({
    authAvailability,
    sessionRepository: resolvedSessionRepository,
    sessionCookieManager: resolvedSessionCookieManager,
  });

  const authRouteDefinitions = createAuthRouteDefinitions({
    authAvailability,
    oauthClient: resolvedOauthClient,
    oauthStateStore: resolvedOauthStateStore,
    sessionRepository: resolvedSessionRepository,
    sessionCookie: resolvedSessionCookieManager,
    postLoginRedirectUri: config?.controlPlane?.auth?.postLoginRedirectUri || '/',
    config,
    getConfiguredStaticGuildIds,
    featureGateEvaluator,
    getSharedStateSummary: () =>
      typeof resolvedSharedStateBackend?.getSummary === 'function'
        ? resolvedSharedStateBackend.getSummary()
        : null,
    getSchedulerSummary: () =>
      typeof resolvedScheduler?.getSummary === 'function'
        ? resolvedScheduler.getSummary()
        : null,
    resolveGuildScope,
  });

  return {
    authAvailability,
    authRouteDefinitions,
    oauthClient: resolvedOauthClient,
    resolveAuthContext,
    sessionCookieManager: resolvedSessionCookieManager,
    sessionRepository: resolvedSessionRepository,
    sharedStateSummary:
      typeof resolvedSharedStateBackend?.getSummary === 'function'
        ? resolvedSharedStateBackend.getSummary()
        : null,
    schedulerSummary,
  };
}

module.exports = {
  createControlPlaneAuthFoundation,
  resolveAuthAvailability,
};
