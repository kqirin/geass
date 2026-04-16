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

test('setup-readiness protected endpoint requires authenticated principal', async () => {
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
      path: `/api/dashboard/protected/setup-readiness?guildId=${TARGET_GUILD_ID}`,
    });
    assert.equal(response.statusCode, 401);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, false);
    assert.equal(responseJson.error, 'unauthenticated');
  } finally {
    await server.close();
  }
});

test('setup-readiness protected endpoint fails closed when guild access is denied', async () => {
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
      path: `/api/dashboard/protected/setup-readiness?guildId=${TARGET_GUILD_ID}`,
      headers: {
        Authorization: 'Bearer no-access-token',
      },
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

test('setup-readiness endpoint returns stable read-only payload and safe warnings', async () => {
  const operatorPrincipal = createPrincipal({
    userId: 'operator-user',
    guildMemberships: [
      {
        id: TARGET_GUILD_ID,
        permissions: '8',
      },
    ],
  });

  const staticSettings = {
    log_enabled: true,
    warn_enabled: true,
    mute_enabled: true,
    kick_enabled: true,
    jail_enabled: true,
    ban_enabled: true,
    lock_enabled: true,
    mute_penalty_role: null,
    jail_penalty_role: null,
    lock_role: null,
    tag_enabled: true,
    tag_role: null,
    tag_text: null,
    startup_voice_channel_id: 'not-a-snowflake',
    private_vc_enabled: true,
    private_vc_hub_channel: null,
    private_vc_required_role: null,
    private_vc_category: null,
  };
  const settingsSnapshotBefore = JSON.stringify(staticSettings);

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: createBaseConfig(),
      getConfiguredStaticGuildIdsFn: () => [],
      getStaticGuildSettingsFn: () => staticSettings,
      getStaticGuildBindingsFn: () => ({
        roles: {},
        channels: {},
        categories: {},
        emojis: {},
      }),
      getPrivateVoiceConfigFn: () => ({
        enabled: true,
        hubChannelId: null,
        requiredRoleId: null,
        categoryId: null,
      }),
      getTagRoleConfigFn: () => ({
        enabled: true,
        roleId: null,
        tagText: null,
      }),
      getStartupVoiceConfigFn: () => ({
        channelId: 'not-a-snowflake',
      }),
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
      path: `/api/dashboard/protected/setup-readiness?guildId=${TARGET_GUILD_ID}`,
      headers: {
        Authorization: 'Bearer operator-token',
      },
    });
    assert.equal(response.statusCode, 200);
    const responseJson = parseJsonBody(response);
    assert.equal(responseJson.ok, true);

    const payload = responseJson.data || {};
    assert.equal(payload.contractVersion, 1);
    assert.equal(payload.guildId, TARGET_GUILD_ID);
    assert.equal(typeof payload.summary, 'object');
    assert.equal(Array.isArray(payload.sections), true);
    assert.equal(Array.isArray(payload.issues), true);

    assert.equal(payload.summary.totalChecks > 0, true);
    assert.equal(payload.summary.warningChecks > 0, true);
    assert.equal(payload.summary.failedChecks > 0, true);
    assert.equal(payload.summary.status, 'incomplete');

    const sectionIds = payload.sections.map((section) => section.id);
    assert.deepEqual(sectionIds, [
      'static-config',
      'private-room',
      'startup-voice',
      'moderation-roles',
      'tag-role',
      'command-policy',
    ]);

    const issueReasonCodes = payload.issues.map((issue) => issue.reasonCode);
    assert.equal(issueReasonCodes.includes('static_config_defaults_in_use'), true);
    assert.equal(issueReasonCodes.includes('private_vc_hub_channel_missing'), true);
    assert.equal(issueReasonCodes.includes('tag_role_missing'), true);

    const severitySet = new Set(payload.issues.map((issue) => issue.severity));
    assert.equal(severitySet.has('error'), true);
    assert.equal(severitySet.has('warning') || severitySet.has('info'), true);

    assert.equal(JSON.stringify(staticSettings), settingsSnapshotBefore);
  } finally {
    await server.close();
  }
});
