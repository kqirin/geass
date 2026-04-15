const { normalizeGuildId } = require('./guildScope');
const { normalizeRequestPath } = require('./router');

let requestCounter = 0;

function createRequestId(nowMs = Date.now()) {
  requestCounter = (requestCounter + 1) % 0x1000000;
  const timestampMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  return `cp_${timestampMs.toString(36)}_${requestCounter.toString(36)}`;
}

function parseRequestPathAndQuery(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '/'), 'http://127.0.0.1');
    const query = {};
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!Object.prototype.hasOwnProperty.call(query, key)) {
        query[key] = value;
      }
    }
    return {
      path: normalizeRequestPath(parsed.pathname),
      query,
    };
  } catch {
    return {
      path: '/',
      query: {},
    };
  }
}

function extractRequestedGuildId(query = {}) {
  if (!query || typeof query !== 'object') return null;
  const rawGuildId = Array.isArray(query.guildId) ? query.guildId[0] : query.guildId;
  return normalizeGuildId(rawGuildId);
}

function attachRequestContextToRequest(req, requestContext) {
  if (!req || typeof req !== 'object') return;
  req.controlPlaneContext = requestContext;
}

function createControlPlaneRequestContext({
  req = null,
  method = 'GET',
  path = '/',
  query = {},
  enabled = false,
  nowMs = Date.now(),
} = {}) {
  const timestampMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const normalizedPath = normalizeRequestPath(path);
  const normalizedQuery = query && typeof query === 'object' ? query : {};

  const requestContext = {
    requestId: createRequestId(timestampMs),
    receivedAt: new Date(timestampMs).toISOString(),
    receivedAtMs: timestampMs,
    method: normalizedMethod,
    path: normalizedPath,
    query: normalizedQuery,
    controlPlaneEnabled: Boolean(enabled),
    principal: null,
    auth: {
      mode: 'pending',
      enabled: false,
      configured: false,
      authenticated: false,
      reasonCode: 'unresolved',
    },
    guildScope: {
      requestedGuildId: extractRequestedGuildId(normalizedQuery),
      guildId: null,
      access: 'unresolved',
    },
  };

  attachRequestContextToRequest(req, requestContext);
  return requestContext;
}

module.exports = {
  attachRequestContextToRequest,
  createControlPlaneRequestContext,
  extractRequestedGuildId,
  parseRequestPathAndQuery,
};
