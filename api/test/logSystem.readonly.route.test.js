const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createControlPlaneRequestHandler } = require('../src/controlPlane/server');

const TARGET_GUILD_ID = '999999999999999001';

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
  return JSON.parse(String(response?.body || '{}'));
}

function createPrincipal({ userId = 'user-1', guildMemberships = [] } = {}) {
  return {
    id: userId,
    username: userId,
    displayName: userId,
    provider: 'test',
    guildMemberships: guildMemberships.map((membership) => ({
      id: String(membership?.id || ''),
      name: String(membership?.name || `Guild ${membership?.id || ''}`),
      permissions: String(membership?.permissions || '8'),
      owner: Boolean(membership?.owner),
      isOperator: membership?.isOperator === true,
    })),
  };
}

function createHeaderTokenAuthFoundation({
  principalByToken = {},
} = {}) {
  return () => ({
    authRouteDefinitions: [],
    resolveAuthContext: async ({ req = null } = {}) => {
      const rawAuthorization = Array.isArray(req?.headers?.authorization)
        ? String(req.headers.authorization[0] || '').trim()
        : String(req?.headers?.authorization || '').trim();
      const bearerMatch = rawAuthorization.match(/^Bearer\s+(.+)$/i);
      const token = bearerMatch ? String(bearerMatch[1] || '').trim() : '';
      const principal = principalByToken[token] || null;
      if (!principal) {
        return {
          mode: 'configured',
          enabled: true,
          configured: true,
          authenticated: false,
          reasonCode: 'no_session',
          principal: null,
          session: null,
        };
      }

      return {
        mode: 'configured',
        enabled: true,
        configured: true,
        authenticated: true,
        reasonCode: null,
        principal,
        session: {
          id: `session_${token}`,
        },
      };
    },
  });
}

function createBaseConfig() {
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
        postLoginRedirectUri: '/dashboard',
        dashboardAllowedOrigins: [],
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

function buildAuthHeader(token = '') {
  return {
    Authorization: `Bearer ${String(token || '').trim()}`,
  };
}

test('log-system moderation endpoint requires auth', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      getConfiguredStaticGuildIdsFn: () => [TARGET_GUILD_ID],
      createAuthFoundationFn: createHeaderTokenAuthFoundation({
        principalByToken: {},
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: `/api/dashboard/protected/logs/moderation?guildId=${TARGET_GUILD_ID}`,
    });

    assert.equal(response.statusCode, 401);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, false);
    assert.equal(responseJson.error, 'unauthenticated');
  } finally {
    await server.close();
  }
});

test('log-system moderation endpoint fails closed when guild access is denied', async () => {
  const noAccessPrincipal = createPrincipal({
    userId: 'user-no-access',
    guildMemberships: [
      {
        id: '999999999999999777',
        permissions: '8',
      },
    ],
  });
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      getConfiguredStaticGuildIdsFn: () => [TARGET_GUILD_ID],
      createAuthFoundationFn: createHeaderTokenAuthFoundation({
        principalByToken: {
          'no-access-token': noAccessPrincipal,
        },
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: `/api/dashboard/protected/logs/moderation?guildId=${TARGET_GUILD_ID}`,
      headers: buildAuthHeader('no-access-token'),
    });

    assert.equal(response.statusCode, 403);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, false);
    assert.equal(responseJson.error, 'guild_access_denied');
    assert.equal(responseJson.details.reasonCode, 'guild_membership_missing');
  } finally {
    await server.close();
  }
});

test('log-system moderation endpoint returns stable payload and validates limit', async () => {
  const operatorPrincipal = createPrincipal({
    userId: 'operator-user',
    guildMemberships: [
      {
        id: TARGET_GUILD_ID,
        permissions: '8',
      },
    ],
  });
  const sourceCalls = [];
  const moderationLogSource = {
    async listByGuildCursor({ guildId = null, limit = 25, cursor = null } = {}) {
      sourceCalls.push({ guildId, limit, cursor });
      return {
        items: [
          {
            id: '100',
            action: 'ban',
            targetUserId: '500',
            moderatorUserId: '900',
            reason: 'Kural ihlali',
            createdAt: '2026-04-16T10:00:00.000Z',
            expiresAt: null,
            status: 'applied',
            unsafeField: 'must_not_leak',
          },
        ],
        nextCursor: '99',
      };
    },
  };

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      moderationLogSource,
      getConfiguredStaticGuildIdsFn: () => [TARGET_GUILD_ID],
      createAuthFoundationFn: createHeaderTokenAuthFoundation({
        principalByToken: {
          'operator-token': operatorPrincipal,
        },
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: `/api/dashboard/protected/logs/moderation?guildId=${TARGET_GUILD_ID}&limit=999`,
      headers: buildAuthHeader('operator-token'),
    });

    assert.equal(response.statusCode, 200);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, true);
    const payload = responseJson.data;

    assert.equal(payload.contractVersion, 1);
    assert.equal(payload.guildId, TARGET_GUILD_ID);
    assert.equal(payload.available, true);
    assert.equal(payload.reasonCode, null);
    assert.equal(payload.pagination.limit, 50);
    assert.equal(payload.pagination.nextCursor, '99');
    assert.equal(Array.isArray(payload.items), true);
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.items[0], {
      id: '100',
      action: 'ban',
      targetUserId: '500',
      moderatorUserId: '900',
      reason: 'Kural ihlali',
      createdAt: '2026-04-16T10:00:00.000Z',
      expiresAt: null,
      status: 'applied',
    });
    assert.equal(sourceCalls.length, 1);
    assert.equal(sourceCalls[0].guildId, TARGET_GUILD_ID);
    assert.equal(sourceCalls[0].limit, 50);
    assert.equal(sourceCalls[0].cursor, null);
  } finally {
    await server.close();
  }
});

test('log-system commands endpoint returns unavailable payload when source is missing', async () => {
  const operatorPrincipal = createPrincipal({
    userId: 'operator-user',
    guildMemberships: [
      {
        id: TARGET_GUILD_ID,
        permissions: '8',
      },
    ],
  });

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      getConfiguredStaticGuildIdsFn: () => [TARGET_GUILD_ID],
      createAuthFoundationFn: createHeaderTokenAuthFoundation({
        principalByToken: {
          'operator-token': operatorPrincipal,
        },
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: `/api/dashboard/protected/logs/commands?guildId=${TARGET_GUILD_ID}`,
      headers: buildAuthHeader('operator-token'),
    });

    assert.equal(response.statusCode, 200);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, true);
    assert.equal(responseJson.data.available, false);
    assert.equal(responseJson.data.reasonCode, 'command_logs_not_available');
    assert.deepEqual(responseJson.data.items, []);
    assert.equal(
      String(responseJson.data.explanation || '').length > 0,
      true
    );
  } finally {
    await server.close();
  }
});

test('log-system system endpoint returns unavailable payload when source is missing', async () => {
  const operatorPrincipal = createPrincipal({
    userId: 'operator-user',
    guildMemberships: [
      {
        id: TARGET_GUILD_ID,
        permissions: '8',
      },
    ],
  });

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      getConfiguredStaticGuildIdsFn: () => [TARGET_GUILD_ID],
      createAuthFoundationFn: createHeaderTokenAuthFoundation({
        principalByToken: {
          'operator-token': operatorPrincipal,
        },
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      path: `/api/dashboard/protected/logs/system?guildId=${TARGET_GUILD_ID}`,
      headers: buildAuthHeader('operator-token'),
    });

    assert.equal(response.statusCode, 200);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, true);
    assert.equal(responseJson.data.available, false);
    assert.equal(responseJson.data.reasonCode, 'system_logs_not_available');
    assert.deepEqual(responseJson.data.items, []);
    assert.equal(
      String(responseJson.data.explanation || '').length > 0,
      true
    );
  } finally {
    await server.close();
  }
});

test('log-system routes are read-only (no mutation route)', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      getConfiguredStaticGuildIdsFn: () => [TARGET_GUILD_ID],
      createAuthFoundationFn: createHeaderTokenAuthFoundation({
        principalByToken: {},
      }),
    })
  );

  try {
    const response = await request({
      port: server.port,
      method: 'PUT',
      path: `/api/dashboard/protected/logs/moderation?guildId=${TARGET_GUILD_ID}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ patch: true }),
    });

    assert.equal(response.statusCode, 405);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, false);
    assert.equal(responseJson.error, 'method_not_allowed');
  } finally {
    await server.close();
  }
});
