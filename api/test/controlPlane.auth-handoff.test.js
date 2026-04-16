const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createControlPlaneRequestHandler } = require('../src/controlPlane/server');

const DASHBOARD_ORIGIN = 'https://geass-dashboard.pages.dev';
const PRIMARY_GUILD_ID = '999999999999999001';

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  return {
    server,
    port: Number(address?.port || 0),
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function request({ port, path = '/', method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: Number(res.statusCode || 0),
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseJsonBody(response) {
  return JSON.parse(String(response?.body || '{}'));
}

function firstSetCookieHeader(responseHeaders = {}) {
  const raw = responseHeaders['set-cookie'];
  if (Array.isArray(raw)) return String(raw[0] || '');
  return String(raw || '');
}

function toCookiePair(setCookieHeader = '') {
  return String(setCookieHeader || '').split(';')[0] || '';
}

function createMockOauthFetch({
  tokenByCode = {
    'operator-user': 'token-operator',
  },
  identityByToken = {
    'token-operator': {
      id: '323456789012345678',
      username: 'operator-user',
      global_name: 'Operator User',
      avatar: 'avatar-operator',
    },
  },
  guildsByToken = {
    'token-operator': [
      {
        id: PRIMARY_GUILD_ID,
        name: 'Primary Guild',
        icon: 'icon-primary',
        owner: false,
        permissions: '8',
      },
    ],
  },
} = {}) {
  return async (url, options = {}) => {
    const normalizedUrl = String(url || '');
    if (normalizedUrl.endsWith('/api/oauth2/token')) {
      const body = new URLSearchParams(String(options?.body || ''));
      const code = String(body.get('code') || '').trim();
      const token = tokenByCode[code] || 'token-unknown';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: token,
          token_type: 'Bearer',
          scope: 'identify guilds',
        }),
      };
    }

    const authorization = String(options?.headers?.Authorization || '');
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (normalizedUrl.endsWith('/api/users/@me')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          identityByToken[accessToken] || {
            id: '423456789012345678',
            username: 'unknown-user',
            global_name: 'Unknown User',
            avatar: 'avatar-unknown',
          },
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me/guilds')) {
      return {
        ok: true,
        status: 200,
        json: async () => guildsByToken[accessToken] || [],
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };
}

function createAuthEnabledConfig({
  postLoginRedirectUri = '/dashboard',
  dashboardAllowedOrigins = [],
} = {}) {
  return {
    nodeEnv: 'test',
    controlPlane: {
      enabled: true,
      auth: {
        enabled: true,
        configured: true,
        sessionSecret: 'abcdef1234567890abcdef1234567890',
        sessionCookieName: 'cp_session',
        sessionTtlMs: 15 * 60 * 1000,
        oauthStateTtlMs: 10 * 60 * 1000,
        cookieSecure: false,
        cookieSameSite: 'Lax',
        postLoginRedirectUri,
        dashboardAllowedOrigins,
      },
      premium: {
        defaultPlan: 'free',
        manualPlanOverrides: {
          [PRIMARY_GUILD_ID]: 'pro',
        },
      },
    },
    oauth: {
      singleGuildId: PRIMARY_GUILD_ID,
      clientId: 'oauth-client-id',
      clientSecret: 'oauth-client-secret',
      redirectUri: 'http://127.0.0.1/api/auth/callback',
    },
    discord: {
      token: '',
      targetGuildId: PRIMARY_GUILD_ID,
      startupVoiceChannelId: '',
    },
    db: {},
    cache: {},
    rateLimit: {},
  };
}

async function oauthLoginAndCallback({
  port,
  oauthCode = 'operator-user',
} = {}) {
  const login = await request({ port, path: '/api/auth/login' });
  assert.equal(login.statusCode, 302);
  const state = new URL(String(login.headers.location || '')).searchParams.get('state');
  assert.ok(state);

  const callback = await request({
    port,
    path: `/api/auth/callback?code=${encodeURIComponent(oauthCode)}&state=${encodeURIComponent(state)}`,
  });
  assert.equal(callback.statusCode, 302);
  const callbackRedirect = new URL(
    String(callback.headers.location || ''),
    'http://127.0.0.1'
  );
  const loginCode = String(callbackRedirect.searchParams.get('loginCode') || '').trim();
  assert.ok(loginCode);
  const sessionCookie = toCookiePair(firstSetCookieHeader(callback.headers));

  return {
    login,
    callback,
    callbackRedirect,
    loginCode,
    sessionCookie,
  };
}

async function exchangeLoginCode({ port, code }) {
  return request({
    port,
    path: '/api/auth/exchange',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
}

function buildAccessTokenHeader(accessToken = '') {
  return {
    Authorization: `Bearer ${String(accessToken || '').trim()}`,
  };
}

test('OAuth callback redirect includes one-time loginCode while preserving cookie session', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({
        postLoginRedirectUri: 'https://geass-dashboard.pages.dev',
      }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
      },
    })
  );

  try {
    const { callbackRedirect, sessionCookie } = await oauthLoginAndCallback({
      port: server.port,
    });

    assert.equal(
      `${callbackRedirect.origin}${callbackRedirect.pathname}`,
      'https://geass-dashboard.pages.dev/'
    );
    assert.ok(String(callbackRedirect.searchParams.get('loginCode') || '').trim());
    assert.match(String(sessionCookie || ''), /^cp_session=/);
  } finally {
    await server.close();
  }
});

test('loginCode exchange succeeds once and rejects reuse and invalid code', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({ postLoginRedirectUri: '/dashboard' }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
      },
    })
  );

  try {
    const { loginCode } = await oauthLoginAndCallback({ port: server.port });

    const firstExchange = await exchangeLoginCode({
      port: server.port,
      code: loginCode,
    });
    assert.equal(firstExchange.statusCode, 200);
    const firstExchangeJson = parseJsonBody(firstExchange);
    assert.equal(firstExchangeJson.ok, true);
    assert.ok(String(firstExchangeJson.data.accessToken || '').trim());
    assert.equal(firstExchangeJson.data.principal.id, '323456789012345678');

    const reusedExchange = await exchangeLoginCode({
      port: server.port,
      code: loginCode,
    });
    assert.equal(reusedExchange.statusCode, 400);
    const reusedExchangeJson = parseJsonBody(reusedExchange);
    assert.equal(reusedExchangeJson.ok, false);
    assert.equal(reusedExchangeJson.error, 'invalid_login_code');

    const invalidExchange = await exchangeLoginCode({
      port: server.port,
      code: 'missing-code',
    });
    assert.equal(invalidExchange.statusCode, 400);
    const invalidExchangeJson = parseJsonBody(invalidExchange);
    assert.equal(invalidExchangeJson.ok, false);
    assert.equal(invalidExchangeJson.error, 'invalid_login_code');
  } finally {
    await server.close();
  }
});

test('loginCode exchange rejects expired code', async () => {
  let nowMs = Date.parse('2026-04-16T00:00:00.000Z');
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({ postLoginRedirectUri: '/dashboard' }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
        nowFn: () => nowMs,
        dashboardLoginCodeTtlMs: 1000,
      },
    })
  );

  try {
    const { loginCode } = await oauthLoginAndCallback({ port: server.port });
    nowMs += 2000;

    const expiredExchange = await exchangeLoginCode({
      port: server.port,
      code: loginCode,
    });
    assert.equal(expiredExchange.statusCode, 400);
    const expiredExchangeJson = parseJsonBody(expiredExchange);
    assert.equal(expiredExchangeJson.ok, false);
    assert.equal(expiredExchangeJson.error, 'invalid_login_code');
    assert.equal(
      ['code_expired', 'code_not_found'].includes(
        String(expiredExchangeJson?.details?.reasonCode || '')
      ),
      true
    );
  } finally {
    await server.close();
  }
});

test('Bearer token authenticates /api/auth/status', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({ postLoginRedirectUri: '/dashboard' }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
      },
    })
  );

  try {
    const { loginCode } = await oauthLoginAndCallback({ port: server.port });
    const exchange = await exchangeLoginCode({
      port: server.port,
      code: loginCode,
    });
    assert.equal(exchange.statusCode, 200);
    const accessToken = String(parseJsonBody(exchange)?.data?.accessToken || '').trim();
    assert.ok(accessToken);

    const authStatus = await request({
      port: server.port,
      path: '/api/auth/status',
      headers: buildAccessTokenHeader(accessToken),
    });
    assert.equal(authStatus.statusCode, 200);
    const authStatusJson = parseJsonBody(authStatus);
    assert.equal(authStatusJson.ok, true);
    assert.equal(authStatusJson.data.auth.authenticated, true);
    assert.equal(authStatusJson.data.principal.id, '323456789012345678');
  } finally {
    await server.close();
  }
});

test('Bearer token authenticates protected dashboard overview', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({ postLoginRedirectUri: '/dashboard' }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
      },
    })
  );

  try {
    const { loginCode } = await oauthLoginAndCallback({ port: server.port });
    const exchange = await exchangeLoginCode({
      port: server.port,
      code: loginCode,
    });
    assert.equal(exchange.statusCode, 200);
    const accessToken = String(parseJsonBody(exchange)?.data?.accessToken || '').trim();
    assert.ok(accessToken);

    const protectedOverview = await request({
      port: server.port,
      path: `/api/dashboard/protected/overview?guildId=${PRIMARY_GUILD_ID}`,
      headers: buildAccessTokenHeader(accessToken),
    });
    assert.equal(protectedOverview.statusCode, 200);
    const protectedOverviewJson = parseJsonBody(protectedOverview);
    assert.equal(protectedOverviewJson.ok, true);
    assert.equal(
      protectedOverviewJson.data.mode,
      'protected_read_only_overview'
    );
  } finally {
    await server.close();
  }
});

test('Bearer token authenticates protected setup-readiness endpoint', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({ postLoginRedirectUri: '/dashboard' }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
      },
    })
  );

  try {
    const { loginCode } = await oauthLoginAndCallback({ port: server.port });
    const exchange = await exchangeLoginCode({
      port: server.port,
      code: loginCode,
    });
    assert.equal(exchange.statusCode, 200);
    const accessToken = String(parseJsonBody(exchange)?.data?.accessToken || '').trim();
    assert.ok(accessToken);

    const setupReadiness = await request({
      port: server.port,
      path: `/api/dashboard/protected/setup-readiness?guildId=${PRIMARY_GUILD_ID}`,
      headers: buildAccessTokenHeader(accessToken),
    });
    assert.equal(setupReadiness.statusCode, 200);
    const setupReadinessJson = parseJsonBody(setupReadiness);
    assert.equal(setupReadinessJson.ok, true);
    assert.equal(setupReadinessJson.data.contractVersion, 1);
    assert.equal(setupReadinessJson.data.guildId, PRIMARY_GUILD_ID);
    assert.equal(typeof setupReadinessJson.data.summary, 'object');
    assert.equal(Array.isArray(setupReadinessJson.data.sections), true);
    assert.equal(Array.isArray(setupReadinessJson.data.issues), true);
  } finally {
    await server.close();
  }
});

test('CORS preflight allows Authorization header for auth exchange route', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createAuthEnabledConfig({
        postLoginRedirectUri: '/dashboard',
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
      getConfiguredStaticGuildIdsFn: () => [PRIMARY_GUILD_ID],
      authFoundationOptions: {
        fetchImpl: createMockOauthFetch(),
      },
    })
  );

  try {
    const preflight = await request({
      port: server.port,
      path: '/api/auth/exchange',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });

    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(
      preflight.headers['access-control-allow-headers'],
      'Content-Type, Authorization'
    );
  } finally {
    await server.close();
  }
});
