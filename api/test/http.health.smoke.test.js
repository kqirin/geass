const test = require('node:test');
const assert = require('node:assert/strict');

const systemRepository = require('../src/infrastructure/repositories/systemRepository');

test('http app should expose sanitized /api/health response', async () => {
  const originalCheckHealth = systemRepository.checkHealth;
  systemRepository.checkHealth = async () => {};

  // Ensure route module picks mocked health check function.
  delete require.cache[require.resolve('../src/interfaces/http/routes/systemRoutes')];
  delete require.cache[require.resolve('../src/interfaces/http/createHttpApp')];
  const { createHttpApp } = require('../src/interfaces/http/createHttpApp');

  const client = {
    guilds: {
      cache: new Map(),
      fetch: async () => null,
    },
    isReady: () => true,
    ws: { status: 0 },
  };

  const app = createHttpApp({
    client,
    CLIENT_ID: 'test-client',
    CLIENT_SECRET: 'test-secret',
    REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    SESSION_SECRET: '1234567890123456',
    corsOrigin: 'http://localhost:5173',
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.checks?.db, true);
    assert.equal(body.checks?.discord, true);
    assert.equal(typeof body.features, 'object');
    assert.equal(body.env, undefined);
    assert.equal(body.stack, undefined);
    assert.match(String(res.headers.get('cache-control') || ''), /no-store/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    systemRepository.checkHealth = originalCheckHealth;
  }
});
