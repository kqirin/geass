const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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

async function request({ port, path: requestPath = '/', method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
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

function createEnabledControlPlaneServerConfig({ distPath = '' } = {}) {
  return {
    nodeEnv: 'test',
    trustProxy: false,
    logging: {
      format: 'text',
    },
    discord: {
      token: '',
      targetGuildId: '999999999999999001',
      startupVoiceChannelId: '',
    },
    oauth: {
      singleGuildId: '999999999999999001',
      clientId: '',
      clientSecret: '',
      redirectUri: '',
    },
    db: {},
    rateLimit: {},
    cache: {},
    controlPlane: {
      enabled: true,
      dashboardStatic: {
        enabled: true,
        distPath,
      },
      auth: {
        enabled: false,
        configured: false,
        dashboardAllowedOrigins: [],
      },
      premium: {
        defaultPlan: 'free',
        manualPlanOverrides: {},
      },
    },
  };
}

async function createDashboardDistFixture() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geass-dashboard-dist-'));
  await fs.mkdir(path.join(fixtureRoot, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(fixtureRoot, 'index.html'),
    [
      '<!doctype html>',
      '<html>',
      '<head><meta charset="utf-8"><title>Geass Dashboard</title></head>',
      '<body><div id="root">dashboard-static-shell</div></body>',
      '</html>',
    ].join(''),
    'utf8'
  );
  await fs.writeFile(path.join(fixtureRoot, 'assets', 'index.js'), 'console.log("fixture");', 'utf8');
  return fixtureRoot;
}

async function withStaticDashboardServer(fn) {
  const distPath = await createDashboardDistFixture();
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createEnabledControlPlaneServerConfig({ distPath }),
      getConfiguredStaticGuildIdsFn: () => ['999999999999999001'],
      getStaticGuildSettingsFn: () => ({}),
      getStaticGuildBindingsFn: () => ({
        roles: {},
        channels: {},
        categories: {},
        emojis: {},
      }),
      getPrivateVoiceConfigFn: () => ({
        enabled: false,
      }),
      getTagRoleConfigFn: () => ({
        enabled: false,
      }),
      getStartupVoiceConfigFn: () => ({
        channelId: null,
      }),
    })
  );

  try {
    await fn({ port: server.port, distPath });
  } finally {
    await server.close();
    await fs.rm(distPath, { recursive: true, force: true });
  }
}

test('/api/auth/status remains API-owned when static dashboard serving is enabled', async () => {
  await withStaticDashboardServer(async ({ port }) => {
    const response = await request({ port, path: '/api/auth/status' });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /application\/json/i);
    const json = parseJsonBody(response);
    assert.equal(json.ok, true);
    assert.equal(json.data.auth.authenticated, false);
    assert.equal(json.data.auth.reasonCode, 'auth_disabled');
    assert.equal(response.body.includes('dashboard-static-shell'), false);
  });
});

test('/dashboard serves dashboard index.html instead of legacy ok fallback', async () => {
  await withStaticDashboardServer(async ({ port }) => {
    const response = await request({ port, path: '/dashboard' });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/i);
    assert.equal(response.body.includes('dashboard-static-shell'), true);
    assert.notEqual(response.body.trim(), 'ok');
  });
});

test('/dashboard/settings serves dashboard index as SPA fallback', async () => {
  await withStaticDashboardServer(async ({ port }) => {
    const response = await request({ port, path: '/dashboard/settings' });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/i);
    assert.equal(response.body.includes('dashboard-static-shell'), true);
  });
});

test('/assets/* serves static asset files from dashboard dist when present', async () => {
  await withStaticDashboardServer(async ({ port }) => {
    const rootAssets = await request({ port, path: '/assets/index.js' });
    const prefixedAssets = await request({ port, path: '/dashboard/assets/index.js' });

    assert.equal(rootAssets.statusCode, 200);
    assert.match(String(rootAssets.headers['content-type'] || ''), /text\/javascript/i);
    assert.equal(rootAssets.body.includes('fixture'), true);

    assert.equal(prefixedAssets.statusCode, 200);
    assert.match(String(prefixedAssets.headers['content-type'] || ''), /text\/javascript/i);
    assert.equal(prefixedAssets.body.includes('fixture'), true);
  });
});

test('frontend fallback does not swallow /api routes', async () => {
  await withStaticDashboardServer(async ({ port }) => {
    const runtime = await request({ port, path: '/api/meta/runtime' });
    const missingApi = await request({ port, path: '/api/not-real-route' });

    assert.equal(runtime.statusCode, 200);
    assert.match(String(runtime.headers['content-type'] || ''), /application\/json/i);
    assert.equal(parseJsonBody(runtime).ok, true);

    assert.equal(missingApi.statusCode, 404);
    assert.match(String(missingApi.headers['content-type'] || ''), /application\/json/i);
    assert.equal(parseJsonBody(missingApi).error, 'not_found');
    assert.equal(missingApi.body.includes('dashboard-static-shell'), false);
  });
});

test('/health remains a plain health endpoint when static dashboard serving is enabled', async () => {
  await withStaticDashboardServer(async ({ port }) => {
    const response = await request({ port, path: '/health' });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/plain/i);
    assert.equal(response.body, 'ok');
  });
});
