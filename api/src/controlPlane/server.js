const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
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
const CORS_DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization';
const HEALTH_PATH = '/health';
const DASHBOARD_PATH_PREFIX = '/dashboard';
const STATIC_ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const STATIC_CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

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

function isDashboardApiPath(path) {
  const normalized = normalizeRequestPath(path);
  return normalized === '/api/dashboard' || normalized.startsWith('/api/dashboard/');
}

function isAuthApiPath(path) {
  const normalized = normalizeRequestPath(path);
  return normalized === '/api/auth' || normalized.startsWith('/api/auth/');
}

function isControlPlaneCorsPath(path) {
  const normalized = normalizeRequestPath(path);
  return isDashboardApiPath(normalized) || isAuthApiPath(normalized);
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

function applyControlPlaneCors({
  req = null,
  res = null,
  method = 'GET',
  path = '/',
  config = {},
} = {}) {
  if (!isControlPlaneCorsPath(path)) {
    return false;
  }

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

  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_DEFAULT_ALLOWED_HEADERS);
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

function writeNotFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('not_found');
}

function toDashboardStaticRuntime(config = {}) {
  const enabled = config?.controlPlane?.dashboardStatic?.enabled === true;
  if (!enabled) {
    return {
      enabled: false,
      distPath: null,
      indexPath: null,
    };
  }

  const rawDistPath = String(config?.controlPlane?.dashboardStatic?.distPath || '').trim();
  if (!rawDistPath) {
    return {
      enabled: false,
      distPath: null,
      indexPath: null,
    };
  }

  const distPath = path.resolve(rawDistPath);
  const indexPath = path.join(distPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return {
      enabled: false,
      distPath,
      indexPath,
    };
  }

  return {
    enabled: true,
    distPath,
    indexPath,
  };
}

function decodeRequestPath(pathname = '/') {
  try {
    return decodeURIComponent(String(pathname || '/'));
  } catch {
    return String(pathname || '/');
  }
}

function resolveDashboardAssetPath({ distPath = null, requestPath = '/' } = {}) {
  if (!distPath) return null;

  const normalizedPath = normalizeRequestPath(requestPath);
  const decodedPath = decodeRequestPath(normalizedPath);
  const relativePath = decodedPath === '/' ? '/index.html' : decodedPath;
  const candidatePath = path.resolve(distPath, `.${relativePath}`);
  const rootPath = path.resolve(distPath);
  const rootPrefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  if (candidatePath !== rootPath && !candidatePath.startsWith(rootPrefix)) {
    return null;
  }
  return candidatePath;
}

function toStaticCandidateRequestPaths(requestPath = '/') {
  const normalizedPath = normalizeRequestPath(requestPath);
  const output = [normalizedPath];
  if (normalizedPath === DASHBOARD_PATH_PREFIX) {
    output.push('/');
  } else if (normalizedPath.startsWith(`${DASHBOARD_PATH_PREFIX}/`)) {
    const withoutPrefix = normalizedPath.slice(DASHBOARD_PATH_PREFIX.length) || '/';
    output.push(withoutPrefix);
  }
  return [...new Set(output)];
}

async function readFileIfRegularFile(filePath = '') {
  try {
    const fileStat = await fsPromises.stat(filePath);
    if (!fileStat.isFile()) return null;
    return await fsPromises.readFile(filePath);
  } catch {
    return null;
  }
}

function getContentTypeByFilePath(filePath = '') {
  const extension = String(path.extname(filePath) || '').toLowerCase();
  return STATIC_CONTENT_TYPES[extension] || 'application/octet-stream';
}

function writeStaticFileResponse({
  res = null,
  method = 'GET',
  filePath = '',
  body = Buffer.alloc(0),
} = {}) {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const resolvedBody = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentTypeByFilePath(filePath));
  res.setHeader('Content-Length', String(resolvedBody.byteLength));
  if (normalizedMethod === 'HEAD') {
    res.end('');
    return;
  }
  res.end(resolvedBody);
}

async function tryServeDashboardStatic({
  res = null,
  method = 'GET',
  requestPath = '/',
  dashboardStaticRuntime = {},
} = {}) {
  if (!dashboardStaticRuntime?.enabled) return false;
  if (!STATIC_ALLOWED_METHODS.has(String(method || 'GET').toUpperCase())) {
    return false;
  }

  const normalizedPath = normalizeRequestPath(requestPath);
  const candidatePaths = toStaticCandidateRequestPaths(normalizedPath);
  for (const candidatePath of candidatePaths) {
    const requestedAssetPath = resolveDashboardAssetPath({
      distPath: dashboardStaticRuntime.distPath,
      requestPath: candidatePath,
    });
    if (!requestedAssetPath) continue;

    const requestedAssetBody = await readFileIfRegularFile(requestedAssetPath);
    if (!requestedAssetBody) continue;

    writeStaticFileResponse({
      res,
      method,
      filePath: requestedAssetPath,
      body: requestedAssetBody,
    });
    return true;
  }

  const hasFileExtension = Boolean(path.extname(normalizedPath));
  if (hasFileExtension) {
    writeNotFound(res);
    return true;
  }

  const spaIndexBody = await readFileIfRegularFile(dashboardStaticRuntime.indexPath);
  if (spaIndexBody) {
    writeStaticFileResponse({
      res,
      method,
      filePath: dashboardStaticRuntime.indexPath,
      body: spaIndexBody,
    });
    return true;
  }

  return false;
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
  const dashboardStaticRuntime = toDashboardStaticRuntime(config);

  async function handleControlPlaneRequest(req, res) {
    if (!enabled) {
      writeHealthOk(res);
      return;
    }

    const method = String(req?.method || 'GET').trim().toUpperCase();
    const request = parseRequestPathAndQuery(req?.url || '/');
    const requestPath = request.path;

    if (!isApiPath(requestPath)) {
      if (requestPath === HEALTH_PATH) {
        writeHealthOk(res);
        return;
      }
      const staticServed = await tryServeDashboardStatic({
        res,
        method,
        requestPath,
        dashboardStaticRuntime,
      });
      if (staticServed) {
        return;
      }
      writeHealthOk(res);
      return;
    }

    if (applyControlPlaneCors({ req, res, method, path: requestPath, config })) {
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
        path: requestPath,
      });
      const authContext = attachAuthContext({
        req,
        requestContext,
        authContext: rawAuthContext,
      });

      const router = isProtectedControlPlanePath(requestPath) ? protectedRouter : publicRouter;
      const resolved = await router.resolve({
        method,
        path: requestPath,
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
