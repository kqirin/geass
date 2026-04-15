const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const configPath = require.resolve('../src/config');
const { createControlPlaneRequestHandler } = require('../src/controlPlane/server');

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
      CORS_ORIGIN: '',
      FRONTEND_URL: '',
    },
    async () => {
      const { config } = require(configPath);
      assert.deepEqual(config.controlPlane.auth.dashboardAllowedOrigins, []);
    }
  );
});

test('dashboard allowed origin env parsing normalizes and filters invalid values', async () => {
  await withEnvOverrides(
    {
      NODE_ENV: 'production',
      CONTROL_PLANE_DASHBOARD_ALLOWED_ORIGIN:
        'https://your-dashboard.pages.dev, invalid-origin, https://preview.example.com/path',
    },
    async () => {
      const { config } = require(configPath);
      assert.deepEqual(config.controlPlane.auth.dashboardAllowedOrigins, [
        'https://your-dashboard.pages.dev',
        'https://preview.example.com',
      ]);
    }
  );
});

test('SameSite=None enforces secure cookie mode for session safety', async () => {
  await withEnvOverrides(
    {
      NODE_ENV: 'development',
      CONTROL_PLANE_AUTH_COOKIE_SAMESITE: 'None',
      CONTROL_PLANE_AUTH_COOKIE_SECURE: '0',
    },
    async () => {
      const { config } = require(configPath);
      assert.equal(config.controlPlane.auth.cookieSameSite, 'None');
      assert.equal(config.controlPlane.auth.cookieSecure, true);
    }
  );
});

test('allowed origin request returns credentialed CORS headers', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: ['https://your-dashboard.pages.dev'],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/meta/runtime',
      headers: {
        Origin: 'https://your-dashboard.pages.dev',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['access-control-allow-origin'],
      'https://your-dashboard.pages.dev'
    );
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
        dashboardAllowedOrigins: ['https://your-dashboard.pages.dev'],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/meta/runtime',
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

test('allowed preflight request is accepted with explicit credentials support', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: ['https://your-dashboard.pages.dev'],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'OPTIONS',
      headers: {
        Origin: 'https://your-dashboard.pages.dev',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(
      response.headers['access-control-allow-origin'],
      'https://your-dashboard.pages.dev'
    );
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.match(
      String(response.headers['access-control-allow-methods'] || ''),
      /PUT/i
    );
    assert.match(
      String(response.headers['access-control-allow-headers'] || ''),
      /content-type/i
    );
  } finally {
    await server.close();
  }
});

test('disallowed preflight request fails closed', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: ['https://your-dashboard.pages.dev'],
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

test('disabled control-plane mode preserves health-style listener behavior', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: false,
      config: createEnabledControlPlaneServerConfig({
        dashboardAllowedOrigins: ['https://your-dashboard.pages.dev'],
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: '/api/meta/runtime',
      method: 'OPTIONS',
      headers: {
        Origin: 'https://your-dashboard.pages.dev',
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
