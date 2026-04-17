const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const configPath = require.resolve('../src/config');
const { createControlPlaneRequestHandler } = require('../src/controlPlane/server');

const DASHBOARD_ORIGIN = 'https://geass-dashboard.pages.dev';

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

async function request({
  port,
  path = '/',
  method = 'GET',
  headers = {},
  body = '',
} = {}) {
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
  return JSON.parse(response.body || '{}');
}

function withEnvOverrides(overrides = {}, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  delete require.cache[configPath];

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      delete require.cache[configPath];
    });
}

function createEnabledControlPlaneServerConfig({
  dashboardAllowedOrigins = [],
} = {}) {
  return {
    nodeEnv: 'test',
    controlPlane: {
      enabled: true,
      auth: {
        enabled: false,
        configured: false,
        dashboardAllowedOrigins,
      },
    },
    oauth: {
      singleGuildId: '',
    },
    discord: {
      token: '',
      targetGuildId: '',
      startupVoiceChannelId: '',
    },
    db: {},
    cache: {},
    rateLimit: {},
  };
}

test('local development defaults keep dashboard origin allow-list compatible', async () => {
  await withEnvOverrides(
    {
      NODE_ENV: 'development',
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN: '',
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGINS: '',
      CONTROL_PLANE_ALLOWED_ORIGINS: '',
      DASHBOARD_ALLOWED_ORIGINS: '',
      CORS_ORIGIN: '',
      FRONTEND_URL: '',
    },
    async () => {
      const { config } = require(configPath);
      assert.equal(
        config.controlPlane.auth.dashboardAllowedOrigins.includes('http://localhost:5173'),
        true
      );
      assert.equal(
        config.controlPlane.auth.dashboardAllowedOrigins.includes('http://127.0.0.1:5173'),
        true
      );
    }
  );
});

test('production mode requires explicit dashboard origin configuration', async () => {
  await withEnvOverrides(
    {
      NODE_ENV: 'production',
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN: '',
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGINS: '',
      CONTROL_PLANE_ALLOWED_ORIGINS: '',
      DASHBOARD_ALLOWED_ORIGINS: '',
      CORS_ORIGIN: '',
      FRONTEND_URL: '',
    },
    async () => {
      const { config } = require(configPath);
      assert.deepEqual(config.controlPlane.auth.dashboardAllowedOrigins, []);
    }
  );
});

test('dashboard allowed origin env parsing supports alias list, commas, and quotes', async () => {
  await withEnvOverrides(
    {
      NODE_ENV: 'production',
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN: ` "${DASHBOARD_ORIGIN}" `,
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGINS:
        "https://preview.example.com/path, 'https://preview.example.com'",
      CONTROL_PLANE_ALLOWED_ORIGINS: " 'https://control-plane.example.com' ",
      DASHBOARD_ALLOWED_ORIGINS: '"https://legacy-dashboard.example.com",invalid-origin',
      CORS_ORIGIN: "'https://cors.example.com'",
      FRONTEND_URL: 'https://frontend-fallback.example.com',
    },
    async () => {
      const { config } = require(configPath);
      assert.deepEqual(config.controlPlane.auth.dashboardAllowedOrigins, [
        DASHBOARD_ORIGIN,
        'https://preview.example.com',
        'https://control-plane.example.com',
        'https://legacy-dashboard.example.com',
        'https://cors.example.com',
      ]);
      assert.equal(
        config.controlPlane.auth.dashboardAllowedOrigins.includes(
          'https://frontend-fallback.example.com'
        ),
        false
      );
    }
  );
});

test('SameSite env parsing normalizes None casing and enforces secure cookie mode', async () => {
  for (const rawSameSiteValue of ['None', 'none', 'NONE']) {
    await withEnvOverrides(
      {
        NODE_ENV: 'development',
        CONTROL_PLANE_AUTH_COOKIE_SAMESITE: rawSameSiteValue,
        CONTROL_PLANE_COOKIE_SAMESITE: undefined,
        CONTROL_PLANE_AUTH_COOKIE_SECURE: '0',
        CONTROL_PLANE_COOKIE_SECURE: undefined,
      },
      async () => {
        const { config } = require(configPath);
        assert.equal(config.controlPlane.auth.cookieSameSite, 'None');
        assert.equal(config.controlPlane.auth.cookieSecure, true);
      }
    );
  }
});

test('legacy SameSite env alias supports lowercase none for cross-site cookies', async () => {
  await withEnvOverrides(
    {
      NODE_ENV: 'development',
      CONTROL_PLANE_AUTH_COOKIE_SAMESITE: undefined,
      CONTROL_PLANE_COOKIE_SAMESITE: 'none',
      CONTROL_PLANE_AUTH_COOKIE_SECURE: '0',
      CONTROL_PLANE_COOKIE_SECURE: undefined,
    },
    async () => {
      const { config } = require(configPath);
      assert.equal(config.controlPlane.auth.cookieSameSite, 'None');
      assert.equal(config.controlPlane.auth.cookieSecure, true);
    }
  );
});

test('allowed origin request returns credentialed CORS headers for auth status route', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/auth/status',
      headers: {
        Origin: DASHBOARD_ORIGIN,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.match(String(response.headers.vary || ''), /Origin/i);
  } finally {
    await server.close();
  }
});

test('disallowed origin request does not receive credentialed CORS headers', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/auth/status',
      headers: {
        Origin: 'https://evil.example.com',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  } finally {
    await server.close();
  }
});

test('allowed origin CORS headers apply across required auth and dashboard routes', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  const routeChecks = [
    { method: 'GET', path: '/api/auth/status' },
    { method: 'GET', path: '/api/auth/me' },
    { method: 'GET', path: '/api/auth/guilds' },
    { method: 'POST', path: '/api/auth/logout' },
    {
      method: 'POST',
      path: '/api/auth/exchange',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: 'demo-login-code',
      }),
    },
    { method: 'GET', path: '/api/auth/login' },
    { method: 'GET', path: '/api/auth/callback?code=test&state=test' },
    { method: 'GET', path: '/api/dashboard/overview' },
    { method: 'GET', path: '/api/dashboard/guild' },
    { method: 'GET', path: '/api/dashboard/features' },
    { method: 'GET', path: '/api/dashboard/resources' },
    { method: 'GET', path: '/api/dashboard/context' },
    { method: 'GET', path: '/api/dashboard/context/features' },
    { method: 'GET', path: '/api/dashboard/protected/overview' },
    { method: 'GET', path: '/api/dashboard/protected/setup-readiness' },
    { method: 'GET', path: '/api/dashboard/protected/logs/moderation' },
    { method: 'GET', path: '/api/dashboard/protected/logs/commands' },
    { method: 'GET', path: '/api/dashboard/protected/logs/system' },
    { method: 'GET', path: '/api/dashboard/protected/preferences' },
    {
      method: 'PUT',
      path: '/api/dashboard/protected/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    },
    { method: 'GET', path: '/api/dashboard/protected/bot-settings/status-command' },
    {
      method: 'PUT',
      path: '/api/dashboard/protected/bot-settings/status-command',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    },
    { method: 'GET', path: '/api/dashboard/protected/message-automation' },
    {
      method: 'PUT',
      path: '/api/dashboard/protected/message-automation',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          welcome: {
            enabled: true,
          },
        },
      }),
    },
  ];

  try {
    for (const routeCheck of routeChecks) {
      const response = await request({
        port: server.port,
        path: routeCheck.path,
        method: routeCheck.method,
        headers: {
          Origin: DASHBOARD_ORIGIN,
          ...(routeCheck.headers || {}),
        },
        body: routeCheck.body || '',
      });

      assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
      assert.match(String(response.headers.vary || ''), /Origin/i);
    }
  } finally {
    await server.close();
  }
});

test('OPTIONS /api/auth/guilds returns CORS headers for allowed dashboard origin', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/auth/guilds',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });

    assert.notEqual(response.statusCode, 405);
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.equal(
      response.headers['access-control-allow-methods'],
      'GET,POST,PUT,OPTIONS'
    );
    assert.equal(
      response.headers['access-control-allow-headers'],
      'Content-Type, Authorization'
    );
    assert.match(String(response.headers.vary || ''), /Origin/i);
  } finally {
    await server.close();
  }
});

test('OPTIONS /api/auth/plan?guildId=test returns CORS headers for allowed dashboard origin', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/auth/plan?guildId=test',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.equal(
      response.headers['access-control-allow-methods'],
      'GET,POST,PUT,OPTIONS'
    );
    assert.equal(
      response.headers['access-control-allow-headers'],
      'Content-Type, Authorization'
    );
    assert.match(String(response.headers.vary || ''), /Origin/i);
  } finally {
    await server.close();
  }
});

test('OPTIONS /api/dashboard/protected/overview returns CORS headers for allowed dashboard origin', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.equal(
      response.headers['access-control-allow-methods'],
      'GET,POST,PUT,OPTIONS'
    );
    assert.equal(
      response.headers['access-control-allow-headers'],
      'Content-Type, Authorization'
    );
    assert.match(String(response.headers.vary || ''), /Origin/i);
  } finally {
    await server.close();
  }
});

test('OPTIONS /api/dashboard/protected/setup-readiness returns CORS headers for allowed dashboard origin', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/dashboard/protected/setup-readiness',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.equal(
      response.headers['access-control-allow-methods'],
      'GET,POST,PUT,OPTIONS'
    );
    assert.equal(
      response.headers['access-control-allow-headers'],
      'Content-Type, Authorization'
    );
    assert.match(String(response.headers.vary || ''), /Origin/i);
  } finally {
    await server.close();
  }
});

test('allowed preflight request is accepted with explicit credentials support', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/auth/logout',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], DASHBOARD_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.equal(
      response.headers['access-control-allow-methods'],
      'GET,POST,PUT,OPTIONS'
    );
    assert.equal(
      response.headers['access-control-allow-headers'],
      'Content-Type, Authorization'
    );
    assert.match(String(response.headers.vary || ''), /Origin/i);
  } finally {
    await server.close();
  }
});

test('disallowed preflight request fails closed', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    assert.equal(response.statusCode, 403);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, false);
    assert.equal(responseJson.error, 'cors_origin_denied');
    assert.equal(responseJson.details.reasonCode, 'origin_not_allowed');
  } finally {
    await server.close();
  }
});

test('non-auth and non-dashboard api routes do not receive credentialed CORS headers', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/meta/runtime',
      headers: {
        Origin: DASHBOARD_ORIGIN,
      },
    });
    const preflightResponse = await request({
      port: server.port,
      path: '/api/meta/runtime',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    assert.equal(preflightResponse.headers['access-control-allow-origin'], undefined);
    assert.equal(preflightResponse.headers['access-control-allow-credentials'], undefined);
  } finally {
    await server.close();
  }
});

test('disabled control-plane mode preserves health-style listener behavior', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: false,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: [DASHBOARD_ORIGIN],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/auth/status',
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'ok');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  } finally {
    await server.close();
  }
});
