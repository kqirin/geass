const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { config } = require('../../config');
const { attachHttpMetrics } = require('../../metrics');
const { createSessionSigner } = require('../../application/security/sessionSigner');

const { attachRequestContext } = require('./middlewares/requestContext');
const { createRouteError } = require('./middlewares/routeError');
const { createApiRateLimiter } = require('./middlewares/rateLimit');
const { createOriginGuard } = require('./middlewares/originGuard');
const { createAuthMiddleware } = require('./middlewares/auth');

const { registerSystemRoutes } = require('./routes/systemRoutes');
const { registerAuthRoutes } = require('./routes/authRoutes');
const { registerGuildRoutes } = require('./routes/guildRoutes');
const { registerSettingsRoutes } = require('./routes/settingsRoutes');
const { registerCommandRoutes } = require('./routes/commandRoutes');
const { registerEmbedRoutes } = require('./routes/embedRoutes');
const { registerReactionRuleRoutes } = require('./routes/reactionRuleRoutes');
const { registerBotPresenceRoutes } = require('./routes/botPresenceRoutes');

function createHttpApp({
  client,
  moderationBot: _moderationBot = null,
  reactionActionService = null,
  tagRoleFeature = null,
  privateRoomService = null,
  botPresenceManager = null,
  logSystem = () => {},
  logError = () => {},
  corsOrigin = config.oauth.corsOrigin,
  CLIENT_ID = config.oauth.clientId,
  CLIENT_SECRET = config.oauth.clientSecret,
  REDIRECT_URI = config.oauth.redirectUri,
  SESSION_SECRET = config.oauth.sessionSecret,
  METRICS_TOKEN = config.metrics.token,
} = {}) {
  if (!client) throw new Error('createHttpApp: client gerekli');
  if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
    throw new Error('createHttpApp: SESSION_SECRET gerekli (en az 16 karakter)');
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error('createHttpApp: CLIENT_ID, CLIENT_SECRET ve REDIRECT_URI gerekli');
  }

  const allowedOrigins = String(corsOrigin)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const allowedOriginSet = new Set(allowedOrigins);
  const frontendOrigin = allowedOrigins[0] || 'http://localhost:5173';

  const app = express();
  const isProd = config.nodeEnv === 'production';

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachHttpMetrics());
  app.use(
    cors({
      credentials: true,
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowedOriginSet.has(origin)) return cb(null, true);
        return cb(null, false);
      },
    })
  );

  app.set('trust proxy', config.trustProxy);

  const sessionSigner = createSessionSigner(SESSION_SECRET);

  function buildCookieOptions({ maxAge, httpOnly = true } = {}) {
    return {
      maxAge,
      httpOnly,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
    };
  }

  function getClientIp(req) {
    if (app.get('trust proxy')) return req.ip || 'unknown';
    return req.socket?.remoteAddress || 'unknown';
  }

  const routeError = createRouteError(logError);
  const { requireAuth, parseUserSession } = createAuthMiddleware({
    client,
    sessionSigner,
    singleGuildId: config.oauth.singleGuildId,
  });

  app.use(attachRequestContext({ isProd }));
  app.use(
    '/api',
    createApiRateLimiter({
      getClientIp,
      windowMs: config.rateLimit.windowMs,
      authMax: config.rateLimit.authMax,
      apiMax: config.rateLimit.apiMax,
      maxKeys: config.rateLimit.maxKeys,
    })
  );
  app.use('/api', createOriginGuard({ allowedOrigins, allowedOriginSet }));

  registerSystemRoutes(app, {
    client,
    METRICS_TOKEN,
    getFeatureHealth: () => ({
      reactionActionServiceReady: Boolean(reactionActionService),
      tagRoleFeatureReady: Boolean(tagRoleFeature),
      privateRoomServiceReady: Boolean(privateRoomService),
      botPresenceManagerReady: Boolean(botPresenceManager),
    }),
  });
  registerAuthRoutes(app, {
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
    frontendOrigin,
    buildCookieOptions,
    logSystem,
    logError,
    sessionSigner,
    parseUserSession,
    client,
  });
  registerGuildRoutes(app, { client, requireAuth, routeError });
  registerSettingsRoutes(app, { requireAuth });
  registerCommandRoutes(app, { requireAuth, routeError, logError });
  registerEmbedRoutes(app, { client, requireAuth, routeError, logSystem });
  registerReactionRuleRoutes(app, { client, requireAuth, routeError, reactionActionService, logError });
  registerBotPresenceRoutes(app, {
    requireAuth,
    routeError,
    botPresenceManager,
  });

  return app;
}

module.exports = { createHttpApp };

