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

async function startServer(client) {
  const app = createHttpApp({
    client,
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

test('guild stats route marks active member metric as unavailable and counts voice members from channels', async () => {
  const voiceChannel = {
    id: '2000',
    type: 2,
    members: new Map([
      ['1', { id: '1' }],
      ['2', { id: '2' }],
    ]),
  };
  const textChannel = {
    id: '3000',
    type: 0,
    members: new Map(),
  };
  const owner = {
    user: {
      username: 'owner-user',
    },
  };
  const guild = {
    id: GUILD_ID,
    name: 'Guild One',
    iconURL: () => null,
    ownerId: 'owner-1',
    memberCount: 42,
    premiumSubscriptionCount: 5,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    fetchOwner: async () => owner,
    members: {
      cache: new Map(),
    },
    channels: {
      cache: {
        filter: (predicate) => {
          const items = [voiceChannel, textChannel].filter(predicate);
          return {
            reduce: (reducer, initialValue) => items.reduce(reducer, initialValue),
          };
        },
      },
    },
  };

  const client = {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
    isReady: () => true,
    ws: { status: 0 },
  };

  const server = await startServer(client);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/guilds/${GUILD_ID}/stats`, {
      headers: {
        Cookie: createSessionCookie({
          userId: '9001',
          guilds: [{ id: GUILD_ID, name: 'Guild One' }],
        }),
      },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.activeMembers, null);
    assert.equal(body.voiceMembers, 2);
    assert.equal(body.metricsMeta.activeMembers.available, false);
    assert.equal(body.metricsMeta.voiceMembers.source, 'voice_channel_members');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
