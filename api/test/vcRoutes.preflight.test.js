const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionSigner } = require('../src/application/security/sessionSigner');
const { createHttpApp } = require('../src/interfaces/http/createHttpApp');

const SESSION_SECRET = '1234567890123456';
const GUILD_ID = '1447015808344784956';

function createSessionCookie(payload) {
  const signer = createSessionSigner(SESSION_SECRET);
  return `user_session=${signer.pack(payload, 60_000)}`;
}

function createClient() {
  const guild = {
    id: GUILD_ID,
    members: {
      fetch: async () => ({
        permissions: {
          has: (permission) => permission === 'Administrator',
        },
      }),
    },
  };

  return {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
    isReady: () => true,
    ws: { status: 0 },
  };
}

async function startServer() {
  const app = createHttpApp({
    client: createClient(),
    CLIENT_ID: 'test-client',
    CLIENT_SECRET: 'test-secret',
    REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    SESSION_SECRET,
    corsOrigin: 'http://localhost:5173',
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, path, options = {}) {
  const { port } = server.address();
  const headers = {
    Origin: 'http://localhost:5173',
    Cookie: createSessionCookie({
      userId: '9001',
      guilds: [{ id: GUILD_ID, name: 'Guild One' }],
    }),
    ...options.headers,
  };

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers,
  });
  return res;
}

test('legacy vc routes are no longer registered in the HTTP app', async () => {
  const server = await startServer();

  try {
    const statusRes = await request(server, `/api/vc/status/${GUILD_ID}`);
    const connectRes = await request(server, `/api/vc/connect/${GUILD_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channelId: '20000' }),
    });
    const privateConfigRes = await request(server, `/api/vc/private/${GUILD_ID}/config`);

    assert.equal(statusRes.status, 404);
    assert.equal(connectRes.status, 404);
    assert.equal(privateConfigRes.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
