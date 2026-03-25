const { config } = require('../config');

function isLocalHostname(hostname = '') {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1';
}

function validateConfig(logSystem = () => {}, logError = () => {}) {
  const errors = [];
  const warnings = [];
  const hasDatabaseUrl = Boolean(config.db.url);

  if (!config.discord.token) errors.push('TOKEN eksik');
  if (!hasDatabaseUrl) {
    if (!config.db.host) errors.push('DB_HOST eksik');
    if (!config.db.user) errors.push('DB_USER eksik');
    if (!config.db.database) errors.push('DB_NAME eksik');
  }
  if (!config.oauth.clientId) errors.push('CLIENT_ID eksik');
  if (!config.oauth.clientSecret) errors.push('CLIENT_SECRET eksik');
  if (!config.oauth.redirectUri) errors.push('REDIRECT_URI eksik');
  if (!config.oauth.sessionSecret || config.oauth.sessionSecret.length < 16) {
    errors.push('SESSION_SECRET en az 16 karakter olmali');
  }
  if (hasDatabaseUrl) {
    try {
      const parsed = new URL(String(config.db.url));
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
        errors.push('DATABASE_URL postgres/postgresql protocol kullanmali');
      }
    } catch {
      errors.push('DATABASE_URL gecersiz URL formatinda');
    }
  }

  const isProd = config.nodeEnv === 'production';
  if (isProd) {
    if (!String(config.oauth.redirectUri || '').startsWith('https://')) {
      warnings.push('REDIRECT_URI production icin https olmali');
    }

    const origins = String(config.oauth.corsOrigin || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

    if (!origins.length) {
      warnings.push('CORS_ORIGIN bos, production icin acikca tanimlanmali');
    }

    try {
      const redirect = new URL(String(config.oauth.redirectUri || ''));
      if (isLocalHostname(redirect.hostname)) {
        warnings.push('REDIRECT_URI localhost/127.0.0.1 olmamali (Discord app ayariyla uyusmaz)');
      }
    } catch {
      // no-op: existing required + https validations already cover this path
    }

    if (hasDatabaseUrl) {
      try {
        const dbUrl = new URL(String(config.db.url));
        const sslMode = String(dbUrl.searchParams.get('sslmode') || '').toLowerCase();
        if (!config.db.ssl && sslMode !== 'require') {
          warnings.push('DATABASE_URL icinde sslmode=require yok ve DB_SSL aktif degil');
        }
      } catch {
        // malformed URL already captured as error
      }
    } else if (!config.db.ssl) {
      warnings.push('DB_SSL kapali, managed PostgreSQL providerlari icin DB_SSL=1 onerilir');
    }
  }

  for (const warning of warnings) {
    logSystem(`config_warning: ${warning}`, 'WARN');
  }

  if (errors.length) {
    const err = new Error(`Config validation failed: ${errors.join(' | ')}`);
    logError('config_validation_failed', err, { errors, warnings });
    throw err;
  }

  logSystem('Config validation passed', 'INFO');
}

module.exports = { validateConfig };

