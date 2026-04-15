function normalizeRequestPath(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '/'), 'http://127.0.0.1');
    const pathname = String(parsed.pathname || '/').trim() || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      return pathname.slice(0, -1);
    }
    return pathname;
  } catch {
    return '/';
  }
}

function createRouteRegistry(definitions = []) {
  const routeMap = new Map();
  const methodsByPath = new Map();

  for (const definition of definitions) {
    const method = String(definition?.method || 'GET').trim().toUpperCase();
    const path = normalizeRequestPath(definition?.path || '/');
    const handler = typeof definition?.handler === 'function' ? definition.handler : null;
    if (!handler) continue;

    routeMap.set(`${method} ${path}`, {
      handler,
      definition,
    });
    const methods = methodsByPath.get(path) || new Set();
    methods.add(method);
    methodsByPath.set(path, methods);
  }

  function matchRoute({ method = 'GET', path = '/' } = {}) {
    const normalizedMethod = String(method || 'GET').trim().toUpperCase();
    const normalizedPath = normalizeRequestPath(path);
    const key = `${normalizedMethod} ${normalizedPath}`;
    const routeMatch = routeMap.get(key);

    if (routeMatch) {
      return {
        ok: true,
        statusCode: 200,
        method: normalizedMethod,
        path: normalizedPath,
        definition: routeMatch.definition,
        handler: routeMatch.handler,
      };
    }

    const allowedMethods = methodsByPath.get(normalizedPath);
    if (allowedMethods && allowedMethods.size > 0) {
      return {
        ok: false,
        statusCode: 405,
        errorCode: 'method_not_allowed',
        details: {
          allowedMethods: [...allowedMethods],
        },
      };
    }

    return {
      ok: false,
      statusCode: 404,
      errorCode: 'not_found',
    };
  }

  return {
    match({ method = 'GET', path = '/' } = {}) {
      return matchRoute({ method, path });
    },
    async resolve({
      method = 'GET',
      path = '/',
      query = {},
      req = null,
      requestContext = null,
      authContext = null,
    } = {}) {
      const matchedRoute = matchRoute({ method, path });
      if (!matchedRoute.ok) {
        return matchedRoute;
      }

      return {
        ok: true,
        statusCode: 200,
        payload: await matchedRoute.handler({
          method: matchedRoute.method,
          path: matchedRoute.path,
          query: query && typeof query === 'object' ? query : {},
          req,
          requestContext,
          authContext,
        }),
      };
    },
  };
}

module.exports = {
  createRouteRegistry,
  normalizeRequestPath,
};
