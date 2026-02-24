const test = require('node:test');
const assert = require('node:assert/strict');

const { createHttpApp } = require('../src/interfaces/http/createHttpApp');

test('http app should expose /api/metrics endpoint', async () => {
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
    const res = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /http_requests_total/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
