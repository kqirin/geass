require('dotenv').config();

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

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 3000, { min: 1, max: 65535 }),
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
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/api/auth/callback',
    corsOrigin: process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173',
    sessionSecret: process.env.SESSION_SECRET || '',
    singleGuildId: process.env.SINGLE_GUILD_ID || process.env.GUILD_ID || null,
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
  metrics: {
    token: process.env.METRICS_TOKEN || '',
  },
};

module.exports = { config };

discord: {
  token: process.env.TOKEN
}
