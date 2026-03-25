const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionSigner } = require('../src/application/security/sessionSigner');

const SESSION_SECRET = '1234567890123456';
const GUILD_ID = '1447015808344784956';
const GUILD_TWO_ID = '1447015808344784957';
const LOCK_ROLE_ID = '1447015808344784999';
const SAFE_USER_ID = '1447015808344784888';
const SAFE_USER_TWO_ID = '1447015808344784777';

function createGuild({
  id,
  adminUserIds = [],
  roles = [],
  members = [],
} = {}) {
  const guildId = String(id || GUILD_ID);
  const roleMap = new Map(
    roles.map((role) => [
      String(role.id),
      {
        id: String(role.id),
        name: String(role.name || role.id),
      },
    ])
  );
  const memberMap = new Map(
    members.map((member) => [
      String(member.id),
      {
        ...member,
        user: {
          id: String(member.id),
          username: member.username || `user-${member.id}`,
        },
        displayName: member.displayName || member.username || `user-${member.id}`,
        displayAvatarURL() {
          return `https://cdn.test/${member.id}.png`;
        },
      },
    ])
  );

  return {
    id: guildId,
    members: {
      fetch: async (userId) => {
        const normalized = String(userId || '').trim();
        const member = memberMap.get(normalized);
        if (member) return member;
        if (adminUserIds.includes(normalized)) {
          return {
            id: normalized,
            user: { id: normalized, username: `admin-${normalized}` },
            displayName: `Admin ${normalized}`,
            displayAvatarURL() {
              return `https://cdn.test/${normalized}.png`;
            },
            permissions: {
              has: (perm) => perm === 'Administrator',
            },
          };
        }
        throw new Error('member_not_found');
      },
      search: async ({ query, limit }) => {
        const normalized = String(query || '').trim().toLowerCase();
        return [...memberMap.values()]
          .filter((member) => {
            const username = String(member.user?.username || '').toLowerCase();
            const displayName = String(member.displayName || '').toLowerCase();
            return (
              String(member.id) === normalized ||
              username.includes(normalized) ||
              displayName.includes(normalized)
            );
          })
          .slice(0, Number(limit || 10));
      },
    },
    roles: {
      cache: {
        get: (roleId) => roleMap.get(String(roleId)) || null,
      },
      fetch: async (roleId) => roleMap.get(String(roleId)) || null,
    },
  };
}

function createClient({ guilds = [] } = {}) {
  const guildMap = new Map(guilds.map((guild) => [String(guild.id), guild]));
  return {
    guilds: {
      cache: guildMap,
      fetch: async (id) => guildMap.get(String(id)) || null,
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

function loadCreateHttpApp(staticConfigJson) {
  const createHttpAppPath = require.resolve('../src/interfaces/http/createHttpApp');
  const settingsRoutesPath = require.resolve('../src/interfaces/http/routes/settingsRoutes');
  const staticConfigPath = require.resolve('../src/config/static');

  const originalStaticConfigJson = process.env.STATIC_SERVER_CONFIG_JSON;

  process.env.STATIC_SERVER_CONFIG_JSON = JSON.stringify(staticConfigJson);
  delete require.cache[createHttpAppPath];
  delete require.cache[settingsRoutesPath];
  delete require.cache[staticConfigPath];

  const { createHttpApp } = require(createHttpAppPath);
  return {
    createHttpApp,
    restore() {
      delete require.cache[createHttpAppPath];
      delete require.cache[settingsRoutesPath];
      delete require.cache[staticConfigPath];
      if (originalStaticConfigJson === undefined) delete process.env.STATIC_SERVER_CONFIG_JSON;
      else process.env.STATIC_SERVER_CONFIG_JSON = originalStaticConfigJson;
    },
  };
}

async function startServer(client, staticConfigJson) {
  const loaded = loadCreateHttpApp(staticConfigJson);
  const app = loaded.createHttpApp({
    client,
    CLIENT_ID: 'test-client',
    CLIENT_SECRET: 'test-secret',
    REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    SESSION_SECRET,
    corsOrigin: 'http://localhost:5173',
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  return {
    server,
    restore: loaded.restore,
  };
}

async function requestSettings(server, {
  guildId = GUILD_ID,
  method = 'GET',
  body = null,
  userId = '9004',
  sessionGuilds = [{ id: GUILD_ID, name: 'Guild One' }],
} = {}) {
  const { port } = server.address();
  const headers = {
    Cookie: createSessionCookie({ userId, guilds: sessionGuilds }),
  };

  if (method !== 'GET') {
    headers.Origin = 'http://localhost:5173';
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`http://127.0.0.1:${port}/api/settings/${guildId}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { res, json };
}

function createStaticConfig(settings = {}) {
  return {
    guilds: {
      [GUILD_ID]: {
        settings: {
          prefix: '.',
          lock_enabled: false,
          lock_role: null,
          lock_limit: 25,
          lock_safe_list: '',
          ...settings,
        },
      },
    },
  };
}

test('settings route returns authoritative static config snapshot', async () => {
  const guild = createGuild({ id: GUILD_ID, adminUserIds: ['9006'] });
  const { server, restore } = await startServer(
    createClient({ guilds: [guild] }),
    createStaticConfig({
      prefix: '!',
      lock_enabled: true,
      lock_role: LOCK_ROLE_ID,
      lock_limit: 9,
      lock_safe_list: `${SAFE_USER_ID},${SAFE_USER_TWO_ID}`,
    })
  );

  try {
    const { res, json } = await requestSettings(server, {
      userId: '9006',
    });

    assert.equal(res.status, 200);
    assert.equal(json.meta.readOnly, true);
    assert.equal(json.meta.source, 'config');
    assert.equal(json.settings.prefix, '!');
    assert.equal(json.settings.lock_enabled, true);
    assert.equal(json.settings.lock_role, LOCK_ROLE_ID);
    assert.equal(json.settings.lock_limit, 9);
    assert.equal(json.settings.lock_safe_list, `${SAFE_USER_ID},${SAFE_USER_TWO_ID}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});

test('settings route rejects dashboard writes for static config', async () => {
  const guild = createGuild({
    id: GUILD_ID,
    adminUserIds: ['9007'],
    roles: [{ id: LOCK_ROLE_ID, name: 'Lock Staff' }],
  });
  const { server, restore } = await startServer(
    createClient({ guilds: [guild] }),
    createStaticConfig({
      prefix: '.',
      lock_enabled: false,
      lock_role: null,
      lock_limit: 25,
      lock_safe_list: '',
    })
  );

  try {
    const { res, json } = await requestSettings(server, {
      userId: '9007',
      method: 'POST',
      body: {
        prefix: '???',
        lock_enabled: true,
        lock_role: LOCK_ROLE_ID,
        lock_limit: 3,
        lock_safe_list: SAFE_USER_ID,
        legacy_runtime_flag: 'runtime-only',
      },
    });

    assert.equal(res.status, 405);
    assert.equal(json.readOnly, true);
    assert.equal(json.source, 'config');
    assert.match(String(json.error || ''), /dashboard uzerinden degistirilemez/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});

test('settings route keeps guild authorization isolated', async () => {
  const guildOne = createGuild({ id: GUILD_ID, adminUserIds: ['9011'] });
  const guildTwo = createGuild({ id: GUILD_TWO_ID, adminUserIds: ['9011'] });
  const { server, restore } = await startServer(
    createClient({ guilds: [guildOne, guildTwo] }),
    createStaticConfig()
  );

  try {
    const { res, json } = await requestSettings(server, {
      guildId: GUILD_TWO_ID,
      userId: '9011',
      method: 'POST',
      sessionGuilds: [{ id: GUILD_ID, name: 'Guild One' }],
      body: { lock_enabled: true },
    });

    assert.equal(res.status, 403);
    assert.equal(String(json.error || ''), 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});
