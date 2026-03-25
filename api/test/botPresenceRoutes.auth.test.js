const test = require('node:test');
const assert = require('node:assert/strict');

const { createHttpApp } = require('../src/interfaces/http/createHttpApp');
const { createSessionSigner } = require('../src/application/security/sessionSigner');

const SESSION_SECRET = '1234567890123456';
const GUILD_ID = '1447015808344784956';

function createGuild({ allowAdmin = true, memberFetch = null } = {}) {
  return {
    id: GUILD_ID,
    members: {
      fetch: memberFetch || (async () => ({
        permissions: {
          has: (perm) => perm === 'Administrator' && allowAdmin,
        },
      })),
    },
  };
}

function createClient({ allowAdmin = true, memberFetch = null } = {}) {
  const guild = createGuild({ allowAdmin, memberFetch });
  return {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
    isReady: () => true,
    ws: { status: 0 },
  };
}

function createSessionCookie(payload) {
  const signer = createSessionSigner(SESSION_SECRET);
  const packed = signer.pack(payload, 60_000);
  return `user_session=${packed}`;
}

async function startServer(client, botPresenceManager) {
  const app = createHttpApp({
    client,
    botPresenceManager,
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

test('bot presence route requires guildId when session has multiple guilds', async () => {
  const server = await startServer(createClient(), {
    loadCurrentSettings: async () => ({ enabled: true, type: 'CUSTOM', text: 'x' }),
    getMeta: () => ({ allowedTypes: ['CUSTOM'] }),
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/bot-presence`, {
      headers: {
        Cookie: createSessionCookie({
          userId: '9001',
          guilds: [
            { id: GUILD_ID, name: 'Guild One' },
            { id: '1447015808344784999', name: 'Guild Two' },
          ],
        }),
      },
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(String(body.error || ''), /guildId/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bot presence route allows authorized guild admin with scoped guildId', async () => {
  const server = await startServer(createClient({ allowAdmin: true }), {
    loadCurrentSettings: async () => ({ enabled: true, type: 'CUSTOM', text: 'x' }),
    getMeta: () => ({ allowedTypes: ['CUSTOM'] }),
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/bot-presence?guildId=${GUILD_ID}`, {
      headers: {
        Cookie: createSessionCookie({
          userId: '9002',
          guilds: [{ id: GUILD_ID, name: 'Guild One' }],
        }),
      },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.scope, 'global');
    assert.equal(body.authorizedGuildId, GUILD_ID);
    assert.equal(body.meta.scope, 'global');
    assert.equal(body.settings.enabled, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bot presence route blocks non-admin even if guild exists in session', async () => {
  const server = await startServer(createClient({ allowAdmin: false }), {
    loadCurrentSettings: async () => ({ enabled: true, type: 'CUSTOM', text: 'x' }),
    getMeta: () => ({ allowedTypes: ['CUSTOM'] }),
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/bot-presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: createSessionCookie({
          userId: '9003',
          guilds: [{ id: GUILD_ID, name: 'Guild One' }],
        }),
      },
      body: JSON.stringify({
        guildId: GUILD_ID,
        enabled: true,
        type: 'CUSTOM',
        text: 'Yeni durum',
      }),
    });

    assert.equal(res.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bot presence write route is closed even for authorized admins', async () => {
  const server = await startServer(createClient({ allowAdmin: true }), {
    loadCurrentSettings: async () => ({ enabled: true, type: 'CUSTOM', text: 'x' }),
    getMeta: () => ({ allowedTypes: ['CUSTOM'], readOnly: true, source: 'config' }),
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/bot-presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: createSessionCookie({
          userId: '9003',
          guilds: [{ id: GUILD_ID, name: 'Guild One' }],
        }),
      },
      body: JSON.stringify({
        guildId: GUILD_ID,
        enabled: true,
        type: 'CUSTOM',
        text: 'Yeni durum',
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 405);
    assert.equal(body.readOnly, true);
    assert.equal(body.source, 'config');
    assert.equal(body.scope, 'global');
    assert.match(String(body.error || ''), /dashboard uzerinden degistirilemez/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('auth middleware deduplicates parallel live admin checks for the same guild', async () => {
  let fetchCalls = 0;
  let releaseFetch = null;
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  const server = await startServer(createClient({
    memberFetch: async () => {
      fetchCalls += 1;
      await fetchGate;
      return {
        permissions: {
          has: (perm) => perm === 'Administrator',
        },
      };
    },
  }), {
    loadCurrentSettings: async () => ({ enabled: true, type: 'CUSTOM', text: 'x' }),
    getMeta: () => ({ allowedTypes: ['CUSTOM'] }),
  });

  try {
    const { port } = server.address();
    const headers = {
      Cookie: createSessionCookie({
        userId: '900400000000000001',
        guilds: [{ id: GUILD_ID, name: 'Guild One' }],
      }),
    };
    const first = fetch(`http://127.0.0.1:${port}/api/bot-presence?guildId=${GUILD_ID}`, { headers });
    const second = fetch(`http://127.0.0.1:${port}/api/bot-presence?guildId=${GUILD_ID}`, { headers });
    releaseFetch();

    const [firstRes, secondRes] = await Promise.all([first, second]);
    assert.equal(firstRes.status, 200);
    assert.equal(secondRes.status, 200);
    assert.equal(fetchCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('auth middleware reuses recent successful admin check when Discord fetch transiently fails', async () => {
  let failFetch = false;
  let fetchCalls = 0;
  const server = await startServer(createClient({
    memberFetch: async () => {
      fetchCalls += 1;
      if (failFetch) throw new Error('transient_fetch_failed');
      return {
        permissions: {
          has: (perm) => perm === 'Administrator',
        },
      };
    },
  }), {
    loadCurrentSettings: async () => ({ enabled: true, type: 'CUSTOM', text: 'x' }),
    getMeta: () => ({ allowedTypes: ['CUSTOM'] }),
  });

  try {
    const { port } = server.address();
    const headers = {
      Cookie: createSessionCookie({
        userId: '900500000000000001',
        guilds: [{ id: GUILD_ID, name: 'Guild One' }],
      }),
    };

    const first = await fetch(`http://127.0.0.1:${port}/api/bot-presence?guildId=${GUILD_ID}`, { headers });
    assert.equal(first.status, 200);

    failFetch = true;
    const second = await fetch(`http://127.0.0.1:${port}/api/bot-presence?guildId=${GUILD_ID}`, { headers });
    assert.equal(second.status, 200);
    assert.equal(fetchCalls >= 1, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
