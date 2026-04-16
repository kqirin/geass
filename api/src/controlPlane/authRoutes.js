const { createPrincipalFromDiscordIdentity, normalizePrincipal } = require('./principal');
const { createDirectJsonResponse, createDirectRedirectResponse } = require('./routeHttpResponse');
const { parseJsonRequestBody } = require('./requestValidation');
const { toSessionSummary } = require('./sessionRepository');
const { evaluateGuildAccessPolicy } = require('./guildAccessPolicy');
const { readBearerTokenFromRequest } = require('./authBoundary');
const {
  summarizePrincipalGuildAccess,
  toPublicGuildSummaries,
} = require('./authGuildProviders');
const { resolveDashboardGuildScope } = require('./guildScope');

function toPublicPrincipal(principal) {
  const normalizedPrincipal = normalizePrincipal(principal);
  if (!normalizedPrincipal) return null;
  const guildSummary = summarizePrincipalGuildAccess(normalizedPrincipal);
  return {
    type: normalizedPrincipal.type,
    id: normalizedPrincipal.id,
    provider: normalizedPrincipal.provider,
    username: normalizedPrincipal.username,
    displayName: normalizedPrincipal.displayName,
    avatarUrl: normalizedPrincipal.avatarUrl,
    guildIds: Array.isArray(normalizedPrincipal.guildIds) ? normalizedPrincipal.guildIds : [],
    guildCount: guildSummary.guildCount,
    operatorGuildCount: guildSummary.operatorGuildCount,
  };
}

function normalizeAuthAvailability(authAvailability = {}) {
  return {
    enabled: Boolean(authAvailability.enabled),
    configured: Boolean(authAvailability.configured),
    reasonCode: String(authAvailability.reasonCode || 'auth_disabled'),
  };
}

function createAuthUnavailableResponse(authAvailability = {}) {
  const normalized = normalizeAuthAvailability(authAvailability);
  return createDirectJsonResponse({
    statusCode: 503,
    headers: {
      'Cache-Control': 'no-store',
    },
    payload: {
      ok: false,
      error: normalized.reasonCode === 'auth_disabled' ? 'auth_disabled' : 'auth_not_configured',
      details: {
        enabled: normalized.enabled,
        configured: normalized.configured,
        reasonCode: normalized.reasonCode,
      },
    },
  });
}

function readRequestedGuildIdFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return null;
  const rawGuildId = Array.isArray(query.guildId) ? query.guildId[0] : query.guildId;
  return String(rawGuildId || '').trim() || null;
}

function appendLoginCodeToRedirectUri(redirectUri = '/', loginCode = '') {
  const normalizedRedirectUri = String(redirectUri || '/').trim() || '/';
  const normalizedLoginCode = String(loginCode || '').trim();
  if (!normalizedLoginCode) return normalizedRedirectUri;

  const isAbsoluteUri = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalizedRedirectUri);
  try {
    const parsed = new URL(normalizedRedirectUri, 'http://127.0.0.1');
    parsed.searchParams.set('loginCode', normalizedLoginCode);
    if (isAbsoluteUri) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const fallbackPath = normalizedRedirectUri.startsWith('/')
      ? normalizedRedirectUri
      : `/${normalizedRedirectUri}`;
    const joiner = fallbackPath.includes('?') ? '&' : '?';
    return `${fallbackPath}${joiner}loginCode=${encodeURIComponent(
      normalizedLoginCode
    )}`;
  }
}

function createAuthRouteDefinitions({
  authAvailability = {},
  oauthClient = null,
  oauthStateStore = null,
  sessionRepository = null,
  sessionCookie = null,
  dashboardLoginCodeStore = null,
  accessTokenRepository = null,
  accessTokenTtlMs = 15 * 60 * 1000,
  postLoginRedirectUri = '/',
  config = {},
  getConfiguredStaticGuildIds = () => [],
  featureGateEvaluator = null,
  getSharedStateSummary = () => null,
  getSchedulerSummary = () => null,
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const availability = normalizeAuthAvailability(authAvailability);
  const guildScopeResolver =
    typeof resolveGuildScope === 'function' ? resolveGuildScope : resolveDashboardGuildScope;

  function toPublicSharedStateSummary() {
    const summary =
      typeof getSharedStateSummary === 'function' ? getSharedStateSummary() : null;
    if (!summary || typeof summary !== 'object') return null;

    return {
      enabled: Boolean(summary.enabled),
      requestedProvider: String(summary.requestedProvider || 'memory'),
      activeProvider: String(summary.activeProvider || 'memory'),
      fallbackUsed: Boolean(summary.fallbackUsed),
      reasonCode:
        summary.reasonCode === null || summary.reasonCode === undefined
          ? null
          : String(summary.reasonCode || '') || null,
    };
  }

  function authStatusPayload(authContext = {}) {
    const authenticated = Boolean(authContext?.authenticated);
    return {
      contractVersion: 1,
      auth: {
        enabled: availability.enabled,
        configured: availability.configured,
        reasonCode: availability.reasonCode,
        mode: String(authContext?.mode || (availability.configured ? 'configured' : 'not_configured')),
        authenticated,
      },
      principal: authenticated ? toPublicPrincipal(authContext?.principal) : null,
      session: authenticated ? toSessionSummary(authContext?.session) : null,
      sharedState: toPublicSharedStateSummary(),
      scheduler: toPublicSchedulerSummary(),
    };
  }

  function toPublicSchedulerSummary() {
    const summary =
      typeof getSchedulerSummary === 'function' ? getSchedulerSummary() : null;
    const schedulerSummary =
      summary && typeof summary.scheduler === 'object' ? summary.scheduler : null;
    if (!schedulerSummary) return null;

    return {
      enabled: Boolean(schedulerSummary.enabled),
      requestedProvider: String(schedulerSummary.requestedProvider || 'memory'),
      activeProvider: String(schedulerSummary.activeProvider || 'memory'),
      fallbackUsed: Boolean(schedulerSummary.fallbackUsed),
      reasonCode:
        schedulerSummary.reasonCode === undefined ||
        schedulerSummary.reasonCode === null
          ? null
          : String(schedulerSummary.reasonCode || '') || null,
      adoption: {
        authExpiryCleanupEnabled: Boolean(
          schedulerSummary.adoption?.authExpiryCleanupEnabled
        ),
      },
      hardened:
        schedulerSummary.hardened && typeof schedulerSummary.hardened === 'object'
          ? {
              configured: Boolean(schedulerSummary.hardened.configured),
              connected: Boolean(schedulerSummary.hardened.connected),
              activeStoreProvider: String(
                schedulerSummary.hardened.activeStoreProvider || 'memory'
              ),
              fallbackUsed: Boolean(schedulerSummary.hardened.fallbackUsed),
              reasonCode:
                schedulerSummary.hardened.reasonCode === undefined ||
                schedulerSummary.hardened.reasonCode === null
                  ? null
                  : String(schedulerSummary.hardened.reasonCode || '') || null,
            }
          : null,
      activeLocalJobCount: Number(summary.activeLocalJobCount || 0),
    };
  }

  function createUnauthenticatedResponse(authContext = {}) {
    return createDirectJsonResponse({
      statusCode: 401,
      headers: {
        'Cache-Control': 'no-store',
      },
      payload: {
        ok: false,
        error: 'unauthenticated',
        details: {
          reasonCode: String(authContext?.reasonCode || 'no_session'),
        },
      },
    });
  }

  function requireAuthenticatedAuthContext(authContext = {}) {
    if (!availability.enabled || !availability.configured) {
      return {
        ok: false,
        response: createAuthUnavailableResponse(availability),
      };
    }

    if (!authContext?.authenticated || !authContext?.principal) {
      return {
        ok: false,
        response: createUnauthenticatedResponse(authContext),
      };
    }

    return {
      ok: true,
      principal: normalizePrincipal(authContext.principal),
      session: toSessionSummary(authContext.session),
    };
  }

  function evaluateAuthGuildAccess({ authContext = {}, query = {} } = {}) {
    const requestedGuildId = readRequestedGuildIdFromQuery(query);
    return evaluateGuildAccessPolicy({
      authContext,
      principal: authContext?.principal,
      requestedGuildId,
      config,
      getConfiguredStaticGuildIds,
      resolveGuildScope: guildScopeResolver,
    });
  }

  async function resolveFeatureContextForGuild({ guildId = null } = {}) {
    if (
      !featureGateEvaluator ||
      typeof featureGateEvaluator.resolveGuildFeatureContext !== 'function'
    ) {
      return {
        modelVersion: 1,
        guildId: String(guildId || '') || null,
        entitlement: {
          modelVersion: 1,
          status: 'unresolved',
          guildId: String(guildId || '') || null,
          planTier: null,
          source: 'unresolved',
          reasonCode: 'feature_gate_evaluator_unavailable',
        },
        capabilities: {},
        summary: {
          totalCapabilities: 0,
          allowedCapabilities: 0,
          deniedCapabilities: 0,
          activeCapabilities: 0,
        },
        generatedAt: new Date().toISOString(),
      };
    }

    try {
      return await featureGateEvaluator.resolveGuildFeatureContext({ guildId });
    } catch {
      return {
        modelVersion: 1,
        guildId: String(guildId || '') || null,
        entitlement: {
          modelVersion: 1,
          status: 'unresolved',
          guildId: String(guildId || '') || null,
          planTier: null,
          source: 'unresolved',
          reasonCode: 'entitlement_resolution_failed',
        },
        capabilities: {},
        summary: {
          totalCapabilities: 0,
          allowedCapabilities: 0,
          deniedCapabilities: 0,
          activeCapabilities: 0,
        },
        generatedAt: new Date().toISOString(),
      };
    }
  }

  async function handleLogin() {
    if (!availability.enabled || !availability.configured) {
      return createAuthUnavailableResponse(availability);
    }

    let stateRecord = null;
    try {
      stateRecord = await oauthStateStore.createState();
    } catch {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_oauth_start_failed',
          details: {
            reasonCode: 'oauth_state_store_unavailable',
          },
        },
      });
    }
    if (!stateRecord?.state) {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_oauth_start_failed',
          details: {
            reasonCode: 'oauth_state_store_invalid',
          },
        },
      });
    }

    let authorizationUrl = '/';
    try {
      authorizationUrl = oauthClient.buildAuthorizeUrl({
        state: stateRecord.state,
      });
    } catch (err) {
      return createDirectJsonResponse({
        statusCode: Number(err?.statusCode || 503),
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_oauth_start_failed',
          details: {
            reasonCode: String(err?.code || 'oauth_start_failed'),
          },
        },
      });
    }

    return createDirectRedirectResponse({
      statusCode: 302,
      location: authorizationUrl,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  async function handleCallback({ query = {} } = {}) {
    if (!availability.enabled || !availability.configured) {
      return createAuthUnavailableResponse(availability);
    }

    const code = String(query?.code || '').trim();
    const state = String(query?.state || '').trim();

    if (!code || !state) {
      return createDirectJsonResponse({
        statusCode: 400,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'invalid_oauth_callback',
          details: {
            reasonCode: !code ? 'missing_code' : 'missing_state',
          },
        },
      });
    }

    const consumedState = await oauthStateStore.consumeState(state);
    if (consumedState.reasonCode === 'state_store_unavailable') {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_state_store_unavailable',
          details: {
            reasonCode: consumedState.reasonCode,
          },
        },
      });
    }
    if (!consumedState.ok) {
      return createDirectJsonResponse({
        statusCode: 400,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'invalid_oauth_state',
          details: {
            reasonCode: consumedState.reasonCode,
          },
        },
      });
    }

    let tokenResponse;
    let userIdentity;
    let userGuildMemberships = [];
    try {
      tokenResponse = await oauthClient.exchangeCodeForToken({ code });
      userIdentity = await oauthClient.fetchUserIdentity({
        accessToken: tokenResponse.accessToken,
      });

      if (typeof oauthClient.fetchUserGuilds === 'function') {
        userGuildMemberships = await oauthClient.fetchUserGuilds({
          accessToken: tokenResponse.accessToken,
        });
      }
    } catch (err) {
      return createDirectJsonResponse({
        statusCode: Number(err?.statusCode || 502),
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'oauth_callback_failed',
          details: {
            reasonCode: String(err?.code || 'oauth_callback_failed'),
          },
        },
      });
    }

    const principal = createPrincipalFromDiscordIdentity({
      user: userIdentity,
      guildIds: Array.isArray(userGuildMemberships)
        ? userGuildMemberships.map((entry) => entry?.id).filter(Boolean)
        : [],
      guildMemberships: Array.isArray(userGuildMemberships) ? userGuildMemberships : [],
    });
    if (!principal) {
      return createDirectJsonResponse({
        statusCode: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'oauth_callback_failed',
          details: {
            reasonCode: 'principal_resolution_failed',
          },
        },
      });
    }

    const sessionRecord = await sessionRepository.createSession({
      principal,
      provider: 'discord_oauth',
    });
    if (
      !dashboardLoginCodeStore ||
      typeof dashboardLoginCodeStore.createCode !== 'function'
    ) {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_handoff_unavailable',
          details: {
            reasonCode: 'dashboard_login_code_store_missing',
          },
        },
      });
    }

    let dashboardLoginCodeRecord = null;
    try {
      dashboardLoginCodeRecord = await dashboardLoginCodeStore.createCode({
        principal,
        session: sessionRecord.summary || toSessionSummary(sessionRecord),
      });
    } catch (error) {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_handoff_unavailable',
          details: {
            reasonCode:
              String(error?.reasonCode || '').trim() ||
              'dashboard_login_code_store_unavailable',
          },
        },
      });
    }

    const callbackRedirectUri = appendLoginCodeToRedirectUri(
      postLoginRedirectUri,
      dashboardLoginCodeRecord?.code
    );
    const setCookieHeader = sessionCookie.createSetCookieHeader(sessionRecord.id, {
      expiresAtMs: sessionRecord.expiresAtMs,
    });

    return createDirectRedirectResponse({
      statusCode: 302,
      location: callbackRedirectUri,
      headers: {
        'Cache-Control': 'no-store',
        ...(setCookieHeader ? { 'Set-Cookie': setCookieHeader } : {}),
      },
    });
  }

  async function handleExchange({ req = null } = {}) {
    if (!availability.enabled || !availability.configured) {
      return createAuthUnavailableResponse(availability);
    }

    if (
      !dashboardLoginCodeStore ||
      typeof dashboardLoginCodeStore.consumeCode !== 'function' ||
      !accessTokenRepository ||
      typeof accessTokenRepository.createAccessToken !== 'function'
    ) {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_exchange_unavailable',
          details: {
            reasonCode: 'auth_exchange_store_missing',
          },
        },
      });
    }

    let requestBody = null;
    try {
      requestBody = await parseJsonRequestBody({
        req,
        maxBytes: 8 * 1024,
      });
    } catch (error) {
      return createDirectJsonResponse({
        statusCode: Number(error?.statusCode || 400),
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: String(error?.errorCode || 'invalid_request_body'),
          details:
            error?.details && typeof error.details === 'object'
              ? error.details
              : {
                  reasonCode: 'invalid_request_body',
                },
        },
      });
    }

    const code = String(requestBody?.code || '').trim();
    if (!code) {
      return createDirectJsonResponse({
        statusCode: 400,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'invalid_request_body',
          details: {
            reasonCode: 'missing_code',
            field: 'code',
          },
        },
      });
    }

    const consumedCode = await dashboardLoginCodeStore.consumeCode(code);
    if (!consumedCode.ok) {
      const reasonCode = String(consumedCode.reasonCode || 'code_not_found');
      const isUnavailableReason =
        reasonCode === 'dashboard_login_code_store_missing' ||
        reasonCode === 'dashboard_login_code_store_unavailable';
      return createDirectJsonResponse({
        statusCode: isUnavailableReason ? 503 : 400,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: isUnavailableReason ? 'auth_exchange_unavailable' : 'invalid_login_code',
          details: {
            reasonCode,
          },
        },
      });
    }

    const principal = normalizePrincipal(consumedCode.principal);
    if (!principal) {
      return createDirectJsonResponse({
        statusCode: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_exchange_failed',
          details: {
            reasonCode: 'principal_resolution_failed',
          },
        },
      });
    }

    let accessTokenRecord = null;
    try {
      accessTokenRecord = await accessTokenRepository.createAccessToken({
        principal,
        session: consumedCode.session,
        provider: 'dashboard_oauth_handoff',
      });
    } catch (error) {
      return createDirectJsonResponse({
        statusCode: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'auth_exchange_unavailable',
          details: {
            reasonCode:
              String(error?.reasonCode || '').trim() ||
              'access_token_store_unavailable',
          },
        },
      });
    }

    return createDirectJsonResponse({
      statusCode: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
      payload: {
        ok: true,
        data: {
          accessToken: String(accessTokenRecord?.accessToken || ''),
          expiresAt: new Date(
            Number(accessTokenRecord?.expiresAtMs || Date.now() + Number(accessTokenTtlMs || 0))
          ).toISOString(),
          principal: toPublicPrincipal(principal),
        },
      },
    });
  }

  async function handleLogout({ req = null } = {}) {
    if (!availability.enabled || !availability.configured) {
      return createAuthUnavailableResponse(availability);
    }

    const bearerAccessToken = readBearerTokenFromRequest(req);
    if (
      bearerAccessToken &&
      accessTokenRepository &&
      typeof accessTokenRepository.deleteAccessToken === 'function'
    ) {
      try {
        await accessTokenRepository.deleteAccessToken(bearerAccessToken);
      } catch {}
    }

    const sessionId = sessionCookie.readSessionIdFromRequest(req);
    if (sessionId) {
      try {
        await sessionRepository.deleteSessionById(sessionId);
      } catch {}
    }

    return createDirectJsonResponse({
      statusCode: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookie.createClearCookieHeader(),
      },
      payload: {
        ok: true,
        data: {
          loggedOut: true,
        },
      },
    });
  }

  function handleAuthStatus({ authContext = {} } = {}) {
    return authStatusPayload(authContext);
  }

  function handleAuthMe({ authContext = {} } = {}) {
    const authCheck = requireAuthenticatedAuthContext(authContext);
    if (!authCheck.ok) return authCheck.response;

    return {
      contractVersion: 1,
      principal: toPublicPrincipal(authCheck.principal),
      session: authCheck.session,
    };
  }

  function handleAuthGuilds({ authContext = {} } = {}) {
    const authCheck = requireAuthenticatedAuthContext(authContext);
    if (!authCheck.ok) return authCheck.response;

    const guilds = toPublicGuildSummaries(authCheck.principal);
    const guildSummary = summarizePrincipalGuildAccess(authCheck.principal);
    return {
      contractVersion: 1,
      guilds,
      summary: {
        guildCount: guildSummary.guildCount,
        operatorGuildCount: guildSummary.operatorGuildCount,
      },
    };
  }

  function handleAuthAccess({ authContext = {}, query = {} } = {}) {
    const authCheck = requireAuthenticatedAuthContext(authContext);
    if (!authCheck.ok) return authCheck.response;

    const access = evaluateAuthGuildAccess({ authContext, query });
    if (!access.allowed) {
      return createDirectJsonResponse({
        statusCode: 403,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'guild_access_denied',
          details: {
            reasonCode: access.reasonCode,
            accessLevel: access.accessLevel,
            guildId: access.targetGuildId,
          },
        },
      });
    }

    return {
      contractVersion: 1,
      accessModelVersion: access.modelVersion,
      access: {
        allowed: true,
        accessLevel: access.accessLevel,
        targetGuildId: access.targetGuildId,
      },
      guildScope: access.scope,
      guild: access.guild,
    };
  }

  async function handleAuthPlan({ authContext = {}, query = {} } = {}) {
    const authCheck = requireAuthenticatedAuthContext(authContext);
    if (!authCheck.ok) return authCheck.response;

    const access = evaluateAuthGuildAccess({ authContext, query });
    if (!access.allowed) {
      return createDirectJsonResponse({
        statusCode: 403,
        headers: {
          'Cache-Control': 'no-store',
        },
        payload: {
          ok: false,
          error: 'guild_access_denied',
          details: {
            reasonCode: access.reasonCode,
            accessLevel: access.accessLevel,
            guildId: access.targetGuildId,
          },
        },
      });
    }

    const featureContext = await resolveFeatureContextForGuild({
      guildId: access.targetGuildId,
    });

    return {
      contractVersion: 1,
      accessModelVersion: access.modelVersion,
      access: {
        allowed: true,
        accessLevel: access.accessLevel,
        targetGuildId: access.targetGuildId,
      },
      guildScope: access.scope,
      guild: access.guild,
      plan: {
        status: String(featureContext?.entitlement?.status || 'unresolved'),
        tier: String(featureContext?.entitlement?.planTier || '') || null,
        source: String(featureContext?.entitlement?.source || 'unresolved'),
        reasonCode:
          featureContext?.entitlement?.reasonCode === undefined ||
          featureContext?.entitlement?.reasonCode === null
            ? null
            : String(featureContext.entitlement.reasonCode || '') || null,
      },
      capabilities: featureContext?.capabilities || {},
      capabilitySummary: featureContext?.summary || {
        totalCapabilities: 0,
        allowedCapabilities: 0,
        deniedCapabilities: 0,
        activeCapabilities: 0,
      },
      generatedAt: String(featureContext?.generatedAt || new Date().toISOString()),
    };
  }

  return [
    {
      method: 'GET',
      path: '/api/auth/login',
      group: 'auth',
      authMode: 'public_oauth_entry',
      handler: handleLogin,
    },
    {
      method: 'GET',
      path: '/api/auth/callback',
      group: 'auth',
      authMode: 'public_oauth_callback',
      handler: handleCallback,
    },
    {
      method: 'POST',
      path: '/api/auth/exchange',
      group: 'auth',
      authMode: 'public_oauth_handoff_exchange',
      handler: handleExchange,
    },
    {
      method: 'GET',
      path: '/api/auth/status',
      group: 'auth',
      authMode: 'public_auth_status',
      handler: handleAuthStatus,
    },
    {
      method: 'GET',
      path: '/api/auth/me',
      group: 'auth',
      authMode: 'require_auth_status_route',
      handler: handleAuthMe,
    },
    {
      method: 'GET',
      path: '/api/auth/guilds',
      group: 'auth',
      authMode: 'require_auth_guild_summary_route',
      handler: handleAuthGuilds,
    },
    {
      method: 'GET',
      path: '/api/auth/access',
      group: 'auth',
      authMode: 'require_auth_guild_access_route',
      handler: handleAuthAccess,
    },
    {
      method: 'GET',
      path: '/api/auth/plan',
      group: 'auth',
      authMode: 'require_auth_guild_plan_route',
      handler: handleAuthPlan,
    },
    {
      method: 'POST',
      path: '/api/auth/logout',
      group: 'auth',
      authMode: 'require_auth_logout_route',
      handler: handleLogout,
    },
  ];
}

module.exports = {
  createAuthRouteDefinitions,
  createAuthUnavailableResponse,
  normalizeAuthAvailability,
  toPublicPrincipal,
};
