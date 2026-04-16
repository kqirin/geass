require('dotenv').config({ quiet: true });

function toNumber(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toSameSite(value, fallback = 'Lax') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'none') return 'None';
  if (normalized === 'lax') return 'Lax';
  return fallback;
}

function parseControlPlanePlanOverrides(rawValue = '') {
  const source = String(rawValue || '').trim();
  if (!source) return {};

  const output = {};
  const entries = source
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [rawGuildId, rawPlanTier] = entry.split(':');
    const guildId = String(rawGuildId || '').trim();
    const planTier = String(rawPlanTier || '').trim().toLowerCase();
    if (!/^\d{15,25}$/.test(guildId)) continue;
    if (!['free', 'pro', 'business'].includes(planTier)) continue;
    output[guildId] = planTier;
  }

  return output;
}

function trimSurroundingQuotes(value = '') {
  const normalized = String(value || '').trim();
  if (normalized.length < 2) return normalized;
  const firstChar = normalized.charAt(0);
  const lastChar = normalized.charAt(normalized.length - 1);
  if (
    (firstChar === '"' && lastChar === '"') ||
    (firstChar === "'" && lastChar === "'")
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function parseOriginList(rawValue = '') {
  const sources = Array.isArray(rawValue) ? rawValue : [rawValue];
  const origins = [];

  for (const rawSource of sources) {
    const source = trimSurroundingQuotes(rawSource);
    if (!source) continue;

    const entries = source
      .split(',')
      .map((entry) => trimSurroundingQuotes(entry))
      .filter(Boolean);

    for (const entry of entries) {
      try {
        origins.push(new URL(entry).origin);
      } catch {
        // Ignore invalid origins; startup should stay compatibility-safe.
      }
    }
  }

  return [...new Set(origins)];
}

const nodeEnv = process.env.NODE_ENV || 'development';
const oauthClientId = String(process.env.CLIENT_ID || '').trim();
const oauthClientSecret = String(process.env.CLIENT_SECRET || '').trim();
const oauthRedirectUri = String(process.env.REDIRECT_URI || '').trim();
const controlPlaneAuthEnabled = toBoolean(process.env.ENABLE_CONTROL_PLANE_AUTH, false);
const controlPlaneSessionSecret = String(process.env.SESSION_SECRET || '');
const controlPlaneSessionTtlMs = toNumber(process.env.CONTROL_PLANE_SESSION_TTL_MS, 8 * 60 * 60 * 1000, {
  min: 5 * 60 * 1000,
  max: 30 * 24 * 60 * 60 * 1000,
});
const controlPlaneOauthStateTtlMs = toNumber(process.env.CONTROL_PLANE_OAUTH_STATE_TTL_MS, 10 * 60 * 1000, {
  min: 60 * 1000,
  max: 60 * 60 * 1000,
});
const controlPlaneAuthCookieSameSite = toSameSite(
  process.env.CONTROL_PLANE_AUTH_COOKIE_SAMESITE,
  'Lax'
);
const controlPlaneAuthCookieSecureFromEnv = toBoolean(
  process.env.CONTROL_PLANE_AUTH_COOKIE_SECURE,
  nodeEnv === 'production'
);
const controlPlaneAuthCookieSecure =
  controlPlaneAuthCookieSameSite === 'None' ? true : controlPlaneAuthCookieSecureFromEnv;
const dashboardAllowedOriginEnvValues = [
  process.env.CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN,
  process.env.CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGINS,
  process.env.CONTROL_PLANE_ALLOWED_ORIGINS,
  process.env.DASHBOARD_ALLOWED_ORIGINS,
  process.env.CORS_ORIGIN,
];
const hasExplicitDashboardAllowedOriginEnv = dashboardAllowedOriginEnvValues.some(
  (value) => Boolean(trimSurroundingQuotes(value))
);
const controlPlaneDashboardAllowedOriginsFromEnv = parseOriginList(
  hasExplicitDashboardAllowedOriginEnv
    ? dashboardAllowedOriginEnvValues
    : process.env.FRONTEND_URL || ''
);
const controlPlaneDashboardAllowedOrigins =
  controlPlaneDashboardAllowedOriginsFromEnv.length > 0
    ? controlPlaneDashboardAllowedOriginsFromEnv
    : nodeEnv === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const controlPlaneSharedStateEnabled = toBoolean(
  process.env.ENABLE_CONTROL_PLANE_SHARED_STATE,
  false
);
const controlPlaneSharedStateProvider =
  String(process.env.CONTROL_PLANE_SHARED_STATE_PROVIDER || 'memory')
    .trim()
    .toLowerCase() || 'memory';
const controlPlaneSharedStateRedisUrl =
  String(
    process.env.CONTROL_PLANE_SHARED_STATE_REDIS_URL || process.env.REDIS_URL || ''
  )
    .trim() || null;
const controlPlaneSharedStateRedisPrefix =
  String(process.env.CONTROL_PLANE_SHARED_STATE_REDIS_PREFIX || 'cp:ss')
    .trim() || 'cp:ss';
const controlPlaneSharedStateRedisConnectTimeoutMs = toNumber(
  process.env.CONTROL_PLANE_SHARED_STATE_REDIS_CONNECT_TIMEOUT_MS,
  1500,
  { min: 200, max: 30000 }
);
const controlPlaneSharedStateRedisFallbackToMemory = toBoolean(
  process.env.CONTROL_PLANE_SHARED_STATE_REDIS_FALLBACK_TO_MEMORY,
  true
);
const controlPlaneSchedulerEnabled = toBoolean(
  process.env.ENABLE_CONTROL_PLANE_SCHEDULER,
  false
);
const controlPlaneSchedulerProvider =
  String(process.env.CONTROL_PLANE_SCHEDULER_PROVIDER || 'memory')
    .trim()
    .toLowerCase() || 'memory';
const controlPlaneSchedulerFallbackToMemory = toBoolean(
  process.env.CONTROL_PLANE_SCHEDULER_FALLBACK_TO_MEMORY,
  true
);
const controlPlaneSchedulerHardenedRedisUrl =
  String(
    process.env.CONTROL_PLANE_SCHEDULER_REDIS_URL ||
      process.env.CONTROL_PLANE_SHARED_STATE_REDIS_URL ||
      process.env.REDIS_URL ||
      ''
  )
    .trim() || null;
const controlPlaneSchedulerHardenedRedisPrefix =
  String(process.env.CONTROL_PLANE_SCHEDULER_REDIS_PREFIX || 'cp:scheduler')
    .trim() || 'cp:scheduler';
const controlPlaneSchedulerHardenedRedisConnectTimeoutMs = toNumber(
  process.env.CONTROL_PLANE_SCHEDULER_REDIS_CONNECT_TIMEOUT_MS,
  1500,
  { min: 200, max: 30_000 }
);
const controlPlaneSchedulerHardenedRedisFallbackToMemory = toBoolean(
  process.env.CONTROL_PLANE_SCHEDULER_REDIS_FALLBACK_TO_MEMORY,
  true
);
const controlPlaneSchedulerHardenedDefaultRecordTtlMs = toNumber(
  process.env.CONTROL_PLANE_SCHEDULER_HARDENED_DEFAULT_RECORD_TTL_MS,
  24 * 60 * 60 * 1000,
  { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 }
);
const controlPlaneSchedulerAuthExpiryCleanupEnabled = toBoolean(
  process.env.CONTROL_PLANE_AUTH_EXPIRY_CLEANUP_SCHEDULER_ENABLED,
  false
);
const controlPlaneDefaultPlan = String(process.env.CONTROL_PLANE_DEFAULT_PLAN || 'free')
  .trim()
  .toLowerCase() || 'free';
const controlPlaneManualPlanOverrides = parseControlPlanePlanOverrides(
  process.env.CONTROL_PLANE_PLAN_OVERRIDES
);
const controlPlaneAuthConfigured = Boolean(
  controlPlaneAuthEnabled &&
    oauthClientId &&
    oauthClientSecret &&
    oauthRedirectUri &&
    controlPlaneSessionSecret.length >= 16
);

const config = {
  nodeEnv,
  trustProxy: toBoolean(process.env.TRUST_PROXY, false),
  logging: {
    format: process.env.LOG_FORMAT === 'json' ? 'json' : 'text',
  },
  discord: {
    token: process.env.TOKEN || '',
    targetGuildId: process.env.TARGET_GUILD_ID || '',
    startupVoiceChannelId: process.env.STARTUP_VOICE_CHANNEL_ID || null,
  },
  oauth: {
    singleGuildId: process.env.SINGLE_GUILD_ID || process.env.GUILD_ID || null,
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    redirectUri: oauthRedirectUri,
  },
  db: {
    url: process.env.DATABASE_URL || null,
    host: process.env.DB_HOST,
    port: toNumber(process.env.DB_PORT, 5432, { min: 1, max: 65535 }),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    poolSize: toNumber(process.env.DB_POOL_SIZE, 10, { min: 2, max: 50 }),
    ssl: toBoolean(process.env.DB_SSL, false),
  },
  rateLimit: {
    windowMs: toNumber(process.env.RATE_WINDOW_MS, 10_000, { min: 1_000, max: 120_000 }),
    authMax: toNumber(process.env.RATE_AUTH_MAX, 40, { min: 5, max: 1000 }),
    apiMax: toNumber(process.env.RATE_API_MAX, 120, { min: 10, max: 5000 }),
    maxKeys: toNumber(process.env.RATE_MAX_KEYS, 5000, { min: 100, max: 50_000 }),
  },
  cache: {
    pruneTick: toNumber(process.env.CACHE_PRUNE_TICK, 500, { min: 10, max: 10_000 }),
    maxKeys: toNumber(process.env.CACHE_MAX_KEYS, 10_000, { min: 1000, max: 100_000 }),
  },
  moderation: {
    abuseThreshold: toNumber(process.env.ABUSE_THRESHOLD, 50, { min: 3, max: 500 }),
    unauthReplyCooldownMs: toNumber(process.env.UNAUTH_REPLY_COOLDOWN_MS, 8000, { min: 1000, max: 120_000 }),
    unauthWindowMs: toNumber(process.env.UNAUTH_WINDOW_MS, 60_000, { min: 5000, max: 10 * 60_000 }),
    unauthMaxAttempts: toNumber(process.env.UNAUTH_MAX_ATTEMPTS, 8, { min: 1, max: 200 }),
    unauthBlockMs: toNumber(process.env.UNAUTH_BLOCK_MS, 120_000, { min: 1000, max: 60 * 60_000 }),
  },
  controlPlane: {
    enabled: toBoolean(process.env.ENABLE_CONTROL_PLANE_API, false),
    auth: {
      enabled: controlPlaneAuthEnabled,
      configured: controlPlaneAuthConfigured,
      sessionSecret: controlPlaneSessionSecret,
      sessionCookieName: String(process.env.CONTROL_PLANE_SESSION_COOKIE_NAME || 'cp_session').trim() || 'cp_session',
      sessionTtlMs: controlPlaneSessionTtlMs,
      oauthStateTtlMs: controlPlaneOauthStateTtlMs,
      cookieSecure: controlPlaneAuthCookieSecure,
      cookieSameSite: controlPlaneAuthCookieSameSite,
      postLoginRedirectUri:
        String(process.env.CONTROL_PLANE_AUTH_POST_LOGIN_REDIRECT || process.env.FRONTEND_URL || '/').trim() || '/',
      publicBaseUrl: String(process.env.CONTROL_PLANE_PUBLIC_BASE_URL || '').trim() || null,
      dashboardAllowedOrigins: controlPlaneDashboardAllowedOrigins,
    },
    premium: {
      defaultPlan: controlPlaneDefaultPlan,
      manualPlanOverrides: controlPlaneManualPlanOverrides,
    },
    sharedState: {
      enabled: controlPlaneSharedStateEnabled,
      provider: controlPlaneSharedStateProvider,
      redis: {
        url: controlPlaneSharedStateRedisUrl,
        keyPrefix: controlPlaneSharedStateRedisPrefix,
        connectTimeoutMs: controlPlaneSharedStateRedisConnectTimeoutMs,
        fallbackToMemory: controlPlaneSharedStateRedisFallbackToMemory,
      },
    },
    scheduler: {
      enabled: controlPlaneSchedulerEnabled,
      provider: controlPlaneSchedulerProvider,
      fallbackToMemory: controlPlaneSchedulerFallbackToMemory,
      hardened: {
        defaultRecordTtlMs: controlPlaneSchedulerHardenedDefaultRecordTtlMs,
        redis: {
          url: controlPlaneSchedulerHardenedRedisUrl,
          keyPrefix: controlPlaneSchedulerHardenedRedisPrefix,
          connectTimeoutMs: controlPlaneSchedulerHardenedRedisConnectTimeoutMs,
          fallbackToMemory: controlPlaneSchedulerHardenedRedisFallbackToMemory,
        },
      },
      adoption: {
        authExpiryCleanupEnabled: controlPlaneSchedulerAuthExpiryCleanupEnabled,
      },
    },
  },
};

module.exports = { config };
