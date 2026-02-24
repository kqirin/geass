const { config } = require('../config');

function validateConfig(logSystem = () => {}, logError = () => {}) {
  const errors = [];
  const warnings = [];

  if (!config.discord.token) errors.push('TOKEN eksik');
  if (!config.db.host) errors.push('DB_HOST eksik');
  if (!config.db.user) errors.push('DB_USER eksik');
  if (!config.db.database) errors.push('DB_NAME eksik');
  if (!config.oauth.clientId) errors.push('CLIENT_ID eksik');
  if (!config.oauth.clientSecret) errors.push('CLIENT_SECRET eksik');
  if (!config.oauth.redirectUri) errors.push('REDIRECT_URI eksik');
  if (!config.oauth.sessionSecret || config.oauth.sessionSecret.length < 16) {
    errors.push('SESSION_SECRET en az 16 karakter olmali');
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

