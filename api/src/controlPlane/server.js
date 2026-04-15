const {
  getConfiguredStaticGuildIds,
  getStaticGuildSettings,
  getStaticGuildBindings,
  getPrivateVoiceConfig,
  getTagRoleConfig,
  getStartupVoiceConfig,
} = require('../config/static');
const { createRouteRegistry, normalizeRequestPath } = require('./router');
const { createPublicRouteDefinitions } = require('./publicRoutes');
const {
  createProtectedRouteDefinitions,
  isProtectedControlPlanePath,
} = require('./protectedRoutes');
const {
  createControlPlaneRequestContext,
  parseRequestPathAndQuery,
} = require('./requestContext');
const {
  attachAuthContext,
  createAuthContextResolver,
  isBoundaryErrorResult,
} = require('./authBoundary');
const { createControlPlaneAuthFoundation } = require('./authFoundation');
const { createInMemoryGuildPlanRepository } = require('./guildPlanRepository');
const { createGuildEntitlementResolver } = require('./entitlementResolver');
const { createFeatureGateEvaluator } = require('./featureGates');
const { isDirectHttpResponse } = require('./routeHttpResponse');

const CORS_ALLOWED_METHODS = 'GET,POST,PUT,OPTIONS';
const CORS_DEFAULT_ALLOWED_HEADERS = 'Content-Type';

function writeHealthOk(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('ok');
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = Number(statusCode) || 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
}

function writeDirectResponse(res, directResponse = {}) {
  const statusCode = Number(directResponse?.statusCode || 200);
  const headers = directResponse?.headers && typeof directResponse.headers === 'object' ? directResponse.headers : {};
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerValue === undefined || headerValue === null) continue;
    res.setHeader(headerName, headerValue);
  }

  res.statusCode = Number.isFinite(statusCode) ? statusCode : 200;
  const body = directResponse?.body;
  if (body === undefined || body === null) {
    res.end('');
    return;
  }
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }

  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify(body));
}

function isApiPath(path) {
  const normalized = normalizeRequestPath(path);
  return normalized === '/api' || normalized.startsWith('/api/');
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function normalizeOrigin(value) {
  const rawValue = normalizeHeaderValue(value);
  if (!rawValue) return null;
  try {
    return new URL(rawValue).origin;
  } catch {
    return null;
  }
}

function toDashboardAllowedOrigins(config = {}) {
  const rawOrigins = Array.isArray(config?.controlPlane?.auth?.dashboardAllowedOrigins)
    ? config.controlPlane.auth.dashboardAllowedOrigins
    : [];
  const normalizedOrigins = [];
  for (const rawOrigin of rawOrigins) {
    const origin = normalizeOrigin(rawOrigin);
    if (origin) normalizedOrigins.push(origin);
  }
  return [...new Set(normalizedOrigins)];
}

function appendVaryHeader(res, headerName = '') {
  const normalizedHeaderName = String(headerName || '').trim();
  if (!normalizedHeaderName) return;

  const rawExistingVary = res.getHeader('Vary');
  const varyEntries = String(rawExistingVary || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  const hasEntry = varyEntries.some(
    (entry) => entry.toLowerCase() === normalizedHeaderName.toLowerCase()
  );
  if (!hasEntry) {
    varyEntries.push(normalizedHeaderName);
  }
  res.setHeader('Vary', varyEntries.join(', '));
}

function applyControlPlaneCors({ req = null, res = null, method = 'GET', config = {} } = {}) {
  const requestOrigin = normalizeOrigin(req?.headers?.origin);
  if (!requestOrigin) {
    return false;
  }

  const allowedOrigins = toDashboardAllowedOrigins(config);
  const isAllowed = allowedOrigins.includes(requestOrigin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    appendVaryHeader(res, 'Origin');
  }

  if (String(method || 'GET').toUpperCase() !== 'OPTIONS') {
    return false;
  }

  if (!isAllowed) {
    writeJson(res, 403, {
      ok: false,
      error: 'cors_origin_denied',
      details: {
        reasonCode: 'origin_not_allowed',
      },
    });
    return true;
  }

  const requestedHeaders =
    normalizeHeaderValue(req?.headers?.['access-control-request-headers']) ||
    CORS_DEFAULT_ALLOWED_HEADERS;

  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
  res.setHeader('Access-Control-Max-Age', '600');
  res.end('');
  return true;
}

function toEndpointList(routeDefinitions = []) {
  return routeDefinitions.map(
    (route) => `${String(route?.method || 'GET').toUpperCase()} ${String(route?.path || '')}`
  );
}

function writeRouteResolution(res, resolved) {
  if (resolved.ok) {
    if (isDirectHttpResponse(resolved.payload)) {
      writeDirectResponse(res, resolved.payload);
      return;
    }

    if (isBoundaryErrorResult(resolved.payload)) {
      writeJson(res, resolved.payload.statusCode, {
        ok: false,
        error: resolved.payload.errorCode,
        details: resolved.payload.details || null,
      });
      return;
    }

    writeJson(res, resolved.statusCode, {
      ok: true,
      data: resolved.payload,
    });
    return;
  }

  writeJson(res, resolved.statusCode, {
    ok: false,
    error: resolved.errorCode,
    details: resolved.details || null,
  });
}

function createControlPlaneRequestHandler({
  enabled = false,
  config = {},
  getStartupPhase = () => 'unknown_phase',
  getClientReady = () => false,
  processRef = process,
  startedAtMs = Date.now(),
  getConfiguredStaticGuildIdsFn = getConfiguredStaticGuildIds,
  getStaticGuildSettingsFn = getStaticGuildSettings,
  getStaticGuildBindingsFn = getStaticGuildBindings,
  getPrivateVoiceConfigFn = getPrivateVoiceConfig,
  getTagRoleConfigFn = getTagRoleConfig,
  getStartupVoiceConfigFn = getStartupVoiceConfig,
  createPublicRouteDefinitionsFn = createPublicRouteDefinitions,
  createProtectedRouteDefinitionsFn = createProtectedRouteDefinitions,
  createRequestContextFn = createControlPlaneRequestContext,
  createAuthContextResolverFn = createAuthContextResolver,
  createAuthFoundationFn = createControlPlaneAuthFoundation,
  guildPlanRepository = null,
  featureGateEvaluator = null,
  createGuildEntitlementResolverFn = createGuildEntitlementResolver,
  createFeatureGateEvaluatorFn = createFeatureGateEvaluator,
  preferencesRepository = null,
  botSettingsRepository = null,
  mutationAuditRecorder = null,
  mutationMaxBodyBytes = undefined,
  authFoundationOptions = {},
} = {}) {
  const resolvedGuildPlanRepository =
    guildPlanRepository || createInMemoryGuildPlanRepository();
  const resolveEntitlement =
    typeof createGuildEntitlementResolverFn === 'function'
      ? createGuildEntitlementResolverFn
      : createGuildEntitlementResolver;
  const resolvedEntitlementResolver = resolveEntitlement({
    config,
    guildPlanRepository: resolvedGuildPlanRepository,
  });
  const createFeatureGates =
    typeof createFeatureGateEvaluatorFn === 'function'
      ? createFeatureGateEvaluatorFn
      : createFeatureGateEvaluator;
  const resolvedFeatureGateEvaluator =
    featureGateEvaluator ||
    createFeatureGates({
      entitlementResolver: resolvedEntitlementResolver,
    });

  const createAuthFoundation =
    typeof createAuthFoundationFn === 'function'
      ? createAuthFoundationFn
      : createControlPlaneAuthFoundation;
  const authFoundation = createAuthFoundation({
    config,
    getConfiguredStaticGuildIds: getConfiguredStaticGuildIdsFn,
    featureGateEvaluator: resolvedFeatureGateEvaluator,
    ...(authFoundationOptions && typeof authFoundationOptions === 'object' ? authFoundationOptions : {}),
  });
  const authRouteDefinitions = Array.isArray(authFoundation?.authRouteDefinitions)
    ? authFoundation.authRouteDefinitions
    : [];

  const resolvedProtectedDefinitions =
    typeof createProtectedRouteDefinitionsFn === 'function'
      ? createProtectedRouteDefinitionsFn({
          config,
          getConfiguredStaticGuildIds: getConfiguredStaticGuildIdsFn,
        })
      : [];
  const protectedRouteDefinitions = Array.isArray(resolvedProtectedDefinitions)
    ? resolvedProtectedDefinitions
    : [];
  const protectedEndpointList = toEndpointList(protectedRouteDefinitions);

  const createPublicRoutes =
    typeof createPublicRouteDefinitionsFn === 'function'
      ? createPublicRouteDefinitionsFn
      : createPublicRouteDefinitions;
  const publicRoutes = createPublicRoutes({
    config,
    getStartupPhase,
    getClientReady,
    processRef,
    startedAtMs,
    getConfiguredStaticGuildIds: getConfiguredStaticGuildIdsFn,
    getStaticGuildSettings: getStaticGuildSettingsFn,
    getStaticGuildBindings: getStaticGuildBindingsFn,
    getPrivateVoiceConfig: getPrivateVoiceConfigFn,
    getTagRoleConfig: getTagRoleConfigFn,
    getStartupVoiceConfig: getStartupVoiceConfigFn,
    featureGateEvaluator: resolvedFeatureGateEvaluator,
    preferencesRepository,
    botSettingsRepository,
    mutationAuditRecorder,
    mutationMaxBodyBytes,
    authRouteDefinitions,
    additionalCapabilityEndpoints: protectedEndpointList,
  });
  const publicRouteDefinitions = Array.isArray(publicRoutes?.routeDefinitions)
    ? publicRoutes.routeDefinitions
    : [];

  const publicRouter = createRouteRegistry(publicRouteDefinitions);
  const protectedRouter = createRouteRegistry(protectedRouteDefinitions);
  const resolveAuthContextFromFoundation =
    typeof authFoundation?.resolveAuthContext === 'function' ? authFoundation.resolveAuthContext : null;
  const resolveAuthContext = resolveAuthContextFromFoundation
    ? resolveAuthContextFromFoundation
    : (() => {
        const createAuthResolver =
          typeof createAuthContextResolverFn === 'function'
            ? createAuthContextResolverFn
            : createAuthContextResolver;
        const resolveAuthContextFactory = createAuthResolver({ config });
        return typeof resolveAuthContextFactory === 'function' ? resolveAuthContextFactory : () => ({});
      })();
  const createRequestContext =
    typeof createRequestContextFn === 'function'
      ? createRequestContextFn
      : createControlPlaneRequestContext;

  async function handleControlPlaneRequest(req, res) {
    if (!enabled) {
      writeHealthOk(res);
      return;
    }

    const method = String(req?.method || 'GET').trim().toUpperCase();
    const request = parseRequestPathAndQuery(req?.url || '/');
    const path = request.path;

    if (!isApiPath(path)) {
      writeHealthOk(res);
      return;
    }

    if (applyControlPlaneCors({ req, res, method, config })) {
      return;
    }

    try {
      const requestContext = createRequestContext({
        req,
        method,
        path: request.path,
        query: request.query,
        enabled,
      });
      const rawAuthContext = await resolveAuthContext({
        req,
        requestContext,
        method,
        path,
      });
      const authContext = attachAuthContext({
        req,
        requestContext,
        authContext: rawAuthContext,
      });

      const router = isProtectedControlPlanePath(path) ? protectedRouter : publicRouter;
      const resolved = await router.resolve({
        method,
        path,
        query: request.query,
        req,
        requestContext,
        authContext,
      });
      writeRouteResolution(res, resolved);
    } catch {
      writeJson(res, 500, {
        ok: false,
        error: 'internal_error',
      });
    }
  }

  return (req, res) => {
    void handleControlPlaneRequest(req, res);
  };
}

module.exports = {
  createControlPlaneRequestHandler,
  isApiPath,
  parseRequestPathAndQuery,
  writeHealthOk,
};
