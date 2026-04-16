const { createAnonymousPrincipal, normalizePrincipal } = require('./principal');
const { ACCESS_LEVELS, evaluateGuildAccessPolicy } = require('./guildAccessPolicy');
const { normalizeGuildId, resolveDashboardGuildScope } = require('./guildScope');
const { toSessionSummary } = require('./sessionRepository');

const BOUNDARY_ERROR_MARKER = '__controlPlaneBoundaryError';

function normalizeAuthAvailability(rawAvailability = {}) {
  return {
    enabled: Boolean(rawAvailability?.enabled),
    configured: Boolean(rawAvailability?.configured),
    reasonCode: String(rawAvailability?.reasonCode || (rawAvailability?.enabled ? 'auth_not_configured' : 'auth_disabled')),
  };
}

function readBearerTokenFromRequest(req = null) {
  const authorizationHeader = Array.isArray(req?.headers?.authorization)
    ? String(req.headers.authorization[0] || '').trim()
    : String(req?.headers?.authorization || '').trim();
  if (!authorizationHeader) return null;

  const bearerPrefix = /^Bearer\s+/i;
  if (!bearerPrefix.test(authorizationHeader)) return null;
  const token = authorizationHeader.replace(bearerPrefix, '').trim();
  return token || null;
}

function createAuthContextResolver({
  authAvailability = {
    enabled: false,
    configured: false,
    reasonCode: 'auth_disabled',
  },
  sessionRepository = null,
  sessionCookieManager = null,
  accessTokenRepository = null,
} = {}) {
  const availability = normalizeAuthAvailability(authAvailability);

  return async function resolveAuthContext({ req = null } = {}) {
    if (!availability.enabled) {
      return {
        mode: 'disabled',
        enabled: false,
        configured: false,
        authenticated: false,
        reasonCode: availability.reasonCode || 'auth_disabled',
        principal: createAnonymousPrincipal(),
        session: null,
      };
    }

    if (!availability.configured || !sessionRepository || !sessionCookieManager) {
      return {
        mode: 'not_configured',
        enabled: true,
        configured: false,
        authenticated: false,
        reasonCode: availability.reasonCode || 'auth_not_configured',
        principal: createAnonymousPrincipal(),
        session: null,
      };
    }

    const bearerAccessToken = readBearerTokenFromRequest(req);
    if (bearerAccessToken) {
      if (
        !accessTokenRepository ||
        typeof accessTokenRepository.getAccessToken !== 'function'
      ) {
        return {
          mode: 'configured',
          enabled: true,
          configured: true,
          authenticated: false,
          reasonCode: 'access_token_repository_missing',
          principal: createAnonymousPrincipal(),
          session: null,
        };
      }

      let accessTokenRecord = null;
      try {
        accessTokenRecord = await accessTokenRepository.getAccessToken(
          bearerAccessToken
        );
      } catch {
        return {
          mode: 'configured',
          enabled: true,
          configured: true,
          authenticated: false,
          reasonCode: 'access_token_lookup_failed',
          principal: createAnonymousPrincipal(),
          session: null,
        };
      }

      if (!accessTokenRecord) {
        return {
          mode: 'configured',
          enabled: true,
          configured: true,
          authenticated: false,
          reasonCode: 'access_token_not_found',
          principal: createAnonymousPrincipal(),
          session: null,
        };
      }

      const principal = normalizePrincipal(accessTokenRecord.principal);
      if (!principal) {
        return {
          mode: 'configured',
          enabled: true,
          configured: true,
          authenticated: false,
          reasonCode: 'access_token_principal_invalid',
          principal: createAnonymousPrincipal(),
          session: null,
        };
      }

      return {
        mode: 'configured',
        enabled: true,
        configured: true,
        authenticated: true,
        reasonCode: null,
        principal,
        session: toSessionSummary(accessTokenRecord.session),
      };
    }

    const sessionId = sessionCookieManager.readSessionIdFromRequest(req);
    if (!sessionId) {
      return {
        mode: 'configured',
        enabled: true,
        configured: true,
        authenticated: false,
        reasonCode: 'no_session',
        principal: createAnonymousPrincipal(),
        session: null,
      };
    }

    let sessionRecord = null;
    try {
      sessionRecord = await sessionRepository.getSessionById(sessionId);
    } catch {
      return {
        mode: 'configured',
        enabled: true,
        configured: true,
        authenticated: false,
        reasonCode: 'session_lookup_failed',
        principal: createAnonymousPrincipal(),
        session: null,
      };
    }
    if (!sessionRecord) {
      return {
        mode: 'configured',
        enabled: true,
        configured: true,
        authenticated: false,
        reasonCode: 'session_not_found',
        principal: createAnonymousPrincipal(),
        session: null,
      };
    }

    const principal = normalizePrincipal(sessionRecord.principal);
    if (!principal) {
      return {
        mode: 'configured',
        enabled: true,
        configured: true,
        authenticated: false,
        reasonCode: 'session_principal_invalid',
        principal: createAnonymousPrincipal(),
        session: null,
      };
    }

    return {
      mode: 'configured',
      enabled: true,
      configured: true,
      authenticated: true,
      reasonCode: null,
      principal,
      session: sessionRecord.summary || toSessionSummary(sessionRecord),
    };
  };
}

function normalizeAuthContext(rawAuthContext = {}) {
  const principal = normalizePrincipal(rawAuthContext?.principal);
  const session = toSessionSummary(rawAuthContext?.session);
  const enabled = Boolean(rawAuthContext?.enabled);
  const configured = Boolean(rawAuthContext?.configured);
  const authenticated = Boolean(rawAuthContext?.authenticated && principal);
  const mode = String(rawAuthContext?.mode || (configured ? 'configured' : 'not_configured'));
  const fallbackReasonCode = enabled ? (configured ? 'no_session' : 'auth_not_configured') : 'auth_disabled';

  return {
    mode,
    enabled,
    configured,
    authenticated,
    reasonCode: String(rawAuthContext?.reasonCode || fallbackReasonCode),
    principal,
    session,
  };
}

function attachAuthContext({ req = null, requestContext = null, authContext = null } = {}) {
  const normalizedAuthContext = normalizeAuthContext(authContext);

  if (requestContext && typeof requestContext === 'object') {
    requestContext.auth = {
      mode: normalizedAuthContext.mode,
      enabled: normalizedAuthContext.enabled,
      configured: normalizedAuthContext.configured,
      authenticated: normalizedAuthContext.authenticated,
      reasonCode: normalizedAuthContext.reasonCode,
    };
    requestContext.principal = normalizedAuthContext.principal;
  }

  if (req && typeof req === 'object') {
    req.controlPlaneAuthContext = {
      mode: normalizedAuthContext.mode,
      enabled: normalizedAuthContext.enabled,
      configured: normalizedAuthContext.configured,
      authenticated: normalizedAuthContext.authenticated,
      reasonCode: normalizedAuthContext.reasonCode,
    };
  }

  return normalizedAuthContext;
}

function createBoundaryErrorResult({
  statusCode = 403,
  errorCode = 'forbidden',
  details = null,
} = {}) {
  return {
    [BOUNDARY_ERROR_MARKER]: true,
    statusCode: Number(statusCode) || 403,
    errorCode: String(errorCode || 'forbidden'),
    details: details || null,
  };
}

function isBoundaryErrorResult(value) {
  return Boolean(value && typeof value === 'object' && value[BOUNDARY_ERROR_MARKER] === true);
}

function requireAuth(routeContext = {}) {
  const authContext = normalizeAuthContext(routeContext.authContext);
  if (!authContext.enabled) {
    return {
      ok: false,
      statusCode: 503,
      errorCode: 'auth_disabled',
      details: {
        reasonCode: authContext.reasonCode,
        mode: authContext.mode,
      },
    };
  }

  if (!authContext.configured) {
    return {
      ok: false,
      statusCode: 503,
      errorCode: 'auth_not_configured',
      details: {
        reasonCode: authContext.reasonCode,
        mode: authContext.mode,
      },
    };
  }

  if (!authContext.principal) {
    return {
      ok: false,
      statusCode: 401,
      errorCode: 'unauthenticated',
      details: {
        reasonCode: authContext.reasonCode,
        mode: authContext.mode,
      },
    };
  }

  return {
    ok: true,
    principal: authContext.principal,
  };
}

function resolveGuildIdFromRouteContext(routeContext = {}) {
  const requestedFromScope = routeContext?.requestContext?.guildScope?.requestedGuildId;
  const requestedFromQuery = normalizeGuildId(routeContext?.query?.guildId);
  return requestedFromQuery || requestedFromScope || null;
}

function attachGuildAccessToRequestContext(requestContext = null, accessResult = null) {
  if (!requestContext || typeof requestContext !== 'object') return;
  requestContext.guildScope = {
    ...requestContext.guildScope,
    ...(accessResult?.scope && typeof accessResult.scope === 'object' ? accessResult.scope : {}),
    guildId: accessResult?.targetGuildId || accessResult?.guildId || null,
    access: accessResult?.allowed ? 'allowed' : 'denied',
    accessLevel: String(accessResult?.accessLevel || ACCESS_LEVELS.AUTHENTICATED_NO_GUILD_ACCESS),
    reasonCode: accessResult?.reasonCode ? String(accessResult.reasonCode) : null,
  };
}

function createRequireGuildAccess({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
  requireOperator = false,
} = {}) {
  return function requireGuildAccess(routeContext = {}) {
    const authCheck = requireAuth(routeContext);
    if (!authCheck.ok) {
      return authCheck;
    }

    const requestedGuildId = resolveGuildIdFromRouteContext(routeContext);
    const access = evaluateGuildAccessPolicy({
      authContext: routeContext.authContext,
      principal: authCheck.principal,
      requestedGuildId,
      config,
      getConfiguredStaticGuildIds,
      resolveGuildScope,
    });

    attachGuildAccessToRequestContext(routeContext?.requestContext, access);

    if (!access.allowed) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'guild_access_denied',
        details: {
          reasonCode: access.reasonCode,
          guildId: access.targetGuildId,
          accessLevel: access.accessLevel,
        },
      };
    }

    if (requireOperator && access.accessLevel !== ACCESS_LEVELS.AUTHENTICATED_GUILD_OPERATOR) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'guild_access_denied',
        details: {
          reasonCode: 'operator_required',
          guildId: access.targetGuildId,
          accessLevel: access.accessLevel,
        },
      };
    }

    return {
      ok: true,
      principal: authCheck.principal,
      guildId: access.targetGuildId,
      accessLevel: access.accessLevel,
      access,
    };
  };
}

const requireGuildAccess = createRequireGuildAccess();

function withBoundaryChecks(handler = () => ({}), checks = []) {
  const normalizedChecks = Array.isArray(checks) ? checks.filter((check) => typeof check === 'function') : [];

  return function boundaryWrappedHandler(routeContext = {}) {
    for (const check of normalizedChecks) {
      const outcome = check(routeContext);
      if (!outcome || outcome.ok !== true) {
        return createBoundaryErrorResult(outcome || {});
      }
    }
    return handler(routeContext);
  };
}

module.exports = {
  attachAuthContext,
  createAuthContextResolver,
  createBoundaryErrorResult,
  isBoundaryErrorResult,
  readBearerTokenFromRequest,
  normalizeAuthAvailability,
  normalizeAuthContext,
  createRequireGuildAccess,
  requireAuth,
  requireGuildAccess,
  withBoundaryChecks,
};
