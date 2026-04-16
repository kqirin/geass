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

async function request({ port, path = '/', method = 'GET', headers = {}, body = '' }) {
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
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function parseJsonBody(response) {
  return JSON.parse(response.body || '{}');
}

function firstSetCookieHeader(responseHeaders = {}) {
  const raw = responseHeaders['set-cookie'];
  if (Array.isArray(raw)) return String(raw[0] || '');
  return String(raw || '');
}

function toCookiePair(setCookieHeader = '') {
  return String(setCookieHeader || '').split(';')[0] || '';
}

function withControlPlaneEnv(value, fn) {
  return withEnvOverrides(
    {
      ENABLE_CONTROL_PLANE_API: value,
    },
    fn
  );
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

test('control-plane flag defaults to disabled', async () => {
  await withControlPlaneEnv(undefined, async () => {
    const { config } = require(configPath);
    assert.equal(config.controlPlane.enabled, false);
  });
});

test('control-plane flag enables with truthy env value', async () => {
  await withControlPlaneEnv('1', async () => {
    const { config } = require(configPath);
    assert.equal(config.controlPlane.enabled, true);
  });
});

test('control-plane auth flag defaults to disabled', async () => {
  await withEnvOverrides(
    {
      ENABLE_CONTROL_PLANE_AUTH: undefined,
      CLIENT_ID: undefined,
      CLIENT_SECRET: undefined,
      REDIRECT_URI: undefined,
      SESSION_SECRET: undefined,
    },
    async () => {
      const { config } = require(configPath);
      assert.equal(config.controlPlane.auth.enabled, false);
      assert.equal(config.controlPlane.auth.configured, false);
    }
  );
});

test('control-plane auth config enables and marks configured when required env is present', async () => {
  await withEnvOverrides(
    {
      ENABLE_CONTROL_PLANE_AUTH: '1',
      CLIENT_ID: 'client-id-1',
      CLIENT_SECRET: 'client-secret-1',
      REDIRECT_URI: 'https://example.com/api/auth/callback',
      SESSION_SECRET: '1234567890abcdef',
    },
    async () => {
      const { config } = require(configPath);
      assert.equal(config.controlPlane.auth.enabled, true);
      assert.equal(config.controlPlane.auth.configured, true);
      assert.equal(config.oauth.clientId, 'client-id-1');
      assert.equal(config.oauth.redirectUri, 'https://example.com/api/auth/callback');
    }
  );
});

test('control-plane scheduler config parses optional hardened scheduler flags safely', async () => {
  await withEnvOverrides(
    {
      ENABLE_CONTROL_PLANE_SCHEDULER: '1',
      CONTROL_PLANE_SCHEDULER_PROVIDER: 'hardened',
      CONTROL_PLANE_SCHEDULER_FALLBACK_TO_MEMORY: '1',
      CONTROL_PLANE_SCHEDULER_REDIS_URL: 'redis://scheduler.local:6379',
      CONTROL_PLANE_SCHEDULER_REDIS_PREFIX: 'cp:scheduler:test',
      CONTROL_PLANE_SCHEDULER_REDIS_CONNECT_TIMEOUT_MS: '1800',
      CONTROL_PLANE_SCHEDULER_REDIS_FALLBACK_TO_MEMORY: '1',
      CONTROL_PLANE_SCHEDULER_HARDENED_DEFAULT_RECORD_TTL_MS: '120000',
      CONTROL_PLANE_AUTH_EXPIRY_CLEANUP_SCHEDULER_ENABLED: '1',
    },
    async () => {
      const { config } = require(configPath);
      assert.equal(config.controlPlane.scheduler.enabled, true);
      assert.equal(config.controlPlane.scheduler.provider, 'hardened');
      assert.equal(config.controlPlane.scheduler.fallbackToMemory, true);
      assert.equal(
        config.controlPlane.scheduler.hardened.redis.url,
        'redis://scheduler.local:6379'
      );
      assert.equal(
        config.controlPlane.scheduler.hardened.redis.keyPrefix,
        'cp:scheduler:test'
      );
      assert.equal(
        config.controlPlane.scheduler.hardened.redis.connectTimeoutMs,
        1800
      );
      assert.equal(
        config.controlPlane.scheduler.hardened.defaultRecordTtlMs,
        120000
      );
      assert.equal(
        config.controlPlane.scheduler.adoption.authExpiryCleanupEnabled,
        true
      );
    }
  );
});

test('disabled mode preserves legacy health listener behavior', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: false,
      config: {},
    })
  );

  try {
    const root = await request({ port: server.port, path: '/' });
    const health = await request({ port: server.port, path: '/health' });
    const meta = await request({ port: server.port, path: '/api/meta/runtime' });
    const dashboard = await request({ port: server.port, path: '/api/dashboard/overview' });
    const protectedOverview = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
    });
    const protectedPreferencesGet = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
    });
    const protectedPreferencesPut = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    const protectedBotStatusSettingsGet = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
    });
    const protectedBotStatusSettingsPut = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    const authPlan = await request({
      port: server.port,
      path: '/api/auth/plan',
    });
    const dashboardContextFeatures = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
    });

    assert.equal(root.statusCode, 200);
    assert.equal(health.statusCode, 200);
    assert.equal(meta.statusCode, 200);
    assert.equal(dashboard.statusCode, 200);
    assert.equal(protectedOverview.statusCode, 200);
    assert.equal(protectedPreferencesGet.statusCode, 200);
    assert.equal(protectedPreferencesPut.statusCode, 200);
    assert.equal(protectedBotStatusSettingsGet.statusCode, 200);
    assert.equal(protectedBotStatusSettingsPut.statusCode, 200);
    assert.equal(authPlan.statusCode, 200);
    assert.equal(dashboardContextFeatures.statusCode, 200);
    assert.equal(root.body, 'ok');
    assert.equal(health.body, 'ok');
    assert.equal(meta.body, 'ok');
    assert.equal(dashboard.body, 'ok');
    assert.equal(protectedOverview.body, 'ok');
    assert.equal(protectedPreferencesGet.body, 'ok');
    assert.equal(protectedPreferencesPut.body, 'ok');
    assert.equal(protectedBotStatusSettingsGet.body, 'ok');
    assert.equal(protectedBotStatusSettingsPut.body, 'ok');
    assert.equal(authPlan.body, 'ok');
    assert.equal(dashboardContextFeatures.body, 'ok');
    assert.match(String(root.headers['content-type'] || ''), /text\/plain/);
  } finally {
    await server.close();
  }
});

test('enabled mode serves meta and dashboard read-only endpoints with stable safe shapes', async () => {
  const secretToken = 'super-secret-token';
  const secretDbPassword = 'super-secret-db-password';
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'test',
        trustProxy: false,
        logging: { format: 'text' },
        discord: {
          token: secretToken,
          targetGuildId: '999999999999999001',
          startupVoiceChannelId: '999999999999999002',
        },
        oauth: {
          singleGuildId: '999999999999999001',
        },
        db: {
          url: `postgres://user:${secretDbPassword}@localhost:5432/geass`,
          host: 'localhost',
          user: 'user',
          database: 'geass',
          ssl: true,
        },
        rateLimit: {
          windowMs: 10_000,
          authMax: 40,
          apiMax: 120,
        },
        cache: {
          maxKeys: 10_000,
          pruneTick: 500,
        },
        controlPlane: {
          enabled: true,
        },
      },
      getStartupPhase: () => 'startup_completed',
      getClientReady: () => true,
      processRef: {
        pid: 4242,
        uptime: () => 12.3456,
      },
      startedAtMs: Date.parse('2026-04-10T00:00:00.000Z'),
      getConfiguredStaticGuildIdsFn: () => ['999999999999999001', '999999999999999010'],
      getStaticGuildSettingsFn: () => ({
        prefix: '.',
        startup_voice_channel_id: '999999999999999002',
        log_enabled: true,
        warn_enabled: true,
        mute_enabled: true,
        kick_enabled: true,
        jail_enabled: true,
        ban_enabled: true,
        lock_enabled: false,
        tag_role: '999999999999999101',
        tag_text: 'auri',
        private_vc_required_role: '999999999999999102',
        mute_penalty_role: '999999999999999103',
        jail_penalty_role: '999999999999999104',
        hard_protected_roles: '1,2,3',
        hard_protected_users: '4,5',
        staff_hierarchy_roles: '6',
      }),
      getStaticGuildBindingsFn: () => ({
        roles: { a: '1', b: '2' },
        channels: { c: '3' },
        categories: { d: '4', e: '5' },
        emojis: {
          privateRoomPanel: { x: '11', y: '12' },
          misc: { z: '13' },
        },
      }),
      getPrivateVoiceConfigFn: () => ({
        enabled: true,
        hubChannelId: '999999999999999201',
        requiredRoleId: '999999999999999202',
        categoryId: '999999999999999203',
      }),
      getTagRoleConfigFn: () => ({
        enabled: true,
        roleId: '999999999999999101',
        tagText: 'auri',
      }),
      getStartupVoiceConfigFn: () => ({
        channelId: '999999999999999002',
      }),
    })
  );

  try {
    const health = await request({ port: server.port, path: '/health' });
    const runtime = await request({ port: server.port, path: '/api/meta/runtime' });
    const capabilities = await request({ port: server.port, path: '/api/meta/capabilities' });
    const configSummary = await request({ port: server.port, path: '/api/meta/config-summary' });
    const overview = await request({ port: server.port, path: '/api/dashboard/overview' });
    const guild = await request({ port: server.port, path: '/api/dashboard/guild' });
    const features = await request({ port: server.port, path: '/api/dashboard/features' });
    const resources = await request({ port: server.port, path: '/api/dashboard/resources' });
    const dashboardContext = await request({ port: server.port, path: '/api/dashboard/context' });
    const dashboardContextFeatures = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
    });
    const protectedOverview = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
    });
    const protectedPreferencesGet = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
    });
    const protectedPreferencesPut = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    const protectedBotStatusSettingsGet = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
    });
    const protectedBotStatusSettingsPut = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    const authPlan = await request({ port: server.port, path: '/api/auth/plan' });
    const invalidGuild = await request({ port: server.port, path: '/api/dashboard/guild?guildId=not-a-guild-id' });
    const mismatchedGuild = await request({
      port: server.port,
      path: '/api/dashboard/guild?guildId=999999999999999777',
    });
    const protectedStatus = await request({ port: server.port, path: '/api/control/private/status' });
    const protectedGuildAccess = await request({
      port: server.port,
      path: '/api/control/private/guild-access?guildId=999999999999999001',
    });
    const protectedMethodDenied = await request({
      port: server.port,
      path: '/api/control/private/status',
      method: 'POST',
    });
    const protectedMissing = await request({ port: server.port, path: '/api/control/private/not-found' });
    const methodDenied = await request({ port: server.port, path: '/api/meta/runtime', method: 'POST' });
    const dashboardMethodDenied = await request({ port: server.port, path: '/api/dashboard/overview', method: 'POST' });
    const missingRoute = await request({ port: server.port, path: '/api/meta/unknown' });

    assert.equal(health.statusCode, 200);
    assert.equal(health.body, 'ok');
    assert.match(String(health.headers['content-type'] || ''), /text\/plain/);

    assert.equal(runtime.statusCode, 200);
    const runtimeJson = parseJsonBody(runtime);
    assert.equal(runtimeJson.ok, true);
    assert.equal(runtimeJson.data.mode, 'read_only');
    assert.equal(runtimeJson.data.nodeEnv, 'test');
    assert.equal(runtimeJson.data.startupPhase, 'startup_completed');
    assert.equal(runtimeJson.data.discordGatewayReady, true);
    assert.equal(runtimeJson.data.process.pid, 4242);

    assert.equal(capabilities.statusCode, 200);
    const capabilitiesJson = parseJsonBody(capabilities);
    assert.equal(capabilitiesJson.ok, true);
    assert.equal(capabilitiesJson.data.mutableRoutesEnabled, false);
    assert.equal(capabilitiesJson.data.endpoints.includes('GET /api/meta/runtime'), true);

    assert.equal(configSummary.statusCode, 200);
    const configJson = parseJsonBody(configSummary);
    assert.equal(configJson.ok, true);
    assert.equal(configJson.data.discord.tokenConfigured, true);
    assert.equal(configJson.data.discord.targetGuildConfigured, true);
    assert.equal(configJson.data.database.hasDatabaseUrl, true);
    assert.equal(configJson.data.database.sslEnabled, true);
    assert.equal(configJson.data.staticConfig.configuredGuildCount, 2);
    assert.equal(configJson.data.controlPlane.scheduler.enabled, false);
    assert.equal(configJson.data.controlPlane.scheduler.provider, 'memory');
    assert.equal(
      configJson.data.controlPlane.scheduler.adoption.authExpiryCleanupEnabled,
      false
    );

    assert.equal(overview.statusCode, 200);
    const overviewJson = parseJsonBody(overview);
    assert.equal(overviewJson.ok, true);
    assert.equal(overviewJson.data.contractVersion, 1);
    assert.equal(overviewJson.data.mode, 'read_only');
    assert.equal(overviewJson.data.runtime.discordGatewayReady, true);
    assert.equal(overviewJson.data.guildScope.mode, 'single_guild');
    assert.equal(overviewJson.data.guildScope.guildId, '999999999999999001');

    assert.equal(guild.statusCode, 200);
    const guildJson = parseJsonBody(guild);
    assert.equal(guildJson.ok, true);
    assert.equal(guildJson.data.contractVersion, 1);
    assert.equal(guildJson.data.guild.id, '999999999999999001');
    assert.equal(guildJson.data.guild.prefix, '.');
    assert.equal(guildJson.data.guild.bindingCounts.roles, 2);
    assert.equal(guildJson.data.guild.bindingCounts.emojis, 3);

    assert.equal(features.statusCode, 200);
    const featuresJson = parseJsonBody(features);
    assert.equal(featuresJson.ok, true);
    assert.equal(featuresJson.data.contractVersion, 1);
    assert.equal(featuresJson.data.features.moderation.logEnabled, true);
    assert.equal(featuresJson.data.features.privateVoice.enabled, true);
    assert.equal(featuresJson.data.features.tagRole.enabled, true);
    assert.equal(featuresJson.data.features.startupVoiceAutoJoin.channelConfigured, true);

    assert.equal(resources.statusCode, 200);
    const resourcesJson = parseJsonBody(resources);
    assert.equal(resourcesJson.ok, true);
    assert.equal(resourcesJson.data.contractVersion, 1);
    assert.equal(resourcesJson.data.resources.bindings.roleCount, 2);
    assert.equal(resourcesJson.data.resources.bindings.channelCount, 1);
    assert.equal(resourcesJson.data.resources.bindings.categoryCount, 2);
    assert.equal(resourcesJson.data.resources.bindings.emojiGroupCount, 2);
    assert.equal(resourcesJson.data.resources.bindings.emojiCount, 3);
    assert.equal(resourcesJson.data.resources.protectedEntityCounts.hardProtectedRoles, 3);
    assert.equal(resourcesJson.data.resources.infrastructure.databaseConfigured, true);

    assert.equal(dashboardContext.statusCode, 503);
    const dashboardContextJson = parseJsonBody(dashboardContext);
    assert.equal(dashboardContextJson.ok, false);
    assert.equal(dashboardContextJson.error, 'auth_disabled');

    assert.equal(dashboardContextFeatures.statusCode, 503);
    const dashboardContextFeaturesJson = parseJsonBody(dashboardContextFeatures);
    assert.equal(dashboardContextFeaturesJson.ok, false);
    assert.equal(dashboardContextFeaturesJson.error, 'auth_disabled');

    assert.equal(protectedOverview.statusCode, 503);
    const protectedOverviewJson = parseJsonBody(protectedOverview);
    assert.equal(protectedOverviewJson.ok, false);
    assert.equal(protectedOverviewJson.error, 'auth_disabled');

    assert.equal(protectedPreferencesGet.statusCode, 503);
    const protectedPreferencesGetJson = parseJsonBody(protectedPreferencesGet);
    assert.equal(protectedPreferencesGetJson.ok, false);
    assert.equal(protectedPreferencesGetJson.error, 'auth_disabled');

    assert.equal(protectedPreferencesPut.statusCode, 503);
    const protectedPreferencesPutJson = parseJsonBody(protectedPreferencesPut);
    assert.equal(protectedPreferencesPutJson.ok, false);
    assert.equal(protectedPreferencesPutJson.error, 'auth_disabled');

    assert.equal(protectedBotStatusSettingsGet.statusCode, 503);
    const protectedBotStatusSettingsGetJson = parseJsonBody(protectedBotStatusSettingsGet);
    assert.equal(protectedBotStatusSettingsGetJson.ok, false);
    assert.equal(protectedBotStatusSettingsGetJson.error, 'auth_disabled');

    assert.equal(protectedBotStatusSettingsPut.statusCode, 503);
    const protectedBotStatusSettingsPutJson = parseJsonBody(protectedBotStatusSettingsPut);
    assert.equal(protectedBotStatusSettingsPutJson.ok, false);
    assert.equal(protectedBotStatusSettingsPutJson.error, 'auth_disabled');

    assert.equal(authPlan.statusCode, 503);
    const authPlanJson = parseJsonBody(authPlan);
    assert.equal(authPlanJson.ok, false);
    assert.equal(authPlanJson.error, 'auth_disabled');

    assert.equal(invalidGuild.statusCode, 200);
    const invalidGuildJson = parseJsonBody(invalidGuild);
    assert.equal(invalidGuildJson.ok, true);
    assert.equal(invalidGuildJson.data.guildScope.valid, false);
    assert.equal(invalidGuildJson.data.guildScope.reasonCode, 'invalid_guild_id');

    assert.equal(mismatchedGuild.statusCode, 200);
    const mismatchedGuildJson = parseJsonBody(mismatchedGuild);
    assert.equal(mismatchedGuildJson.ok, true);
    assert.equal(mismatchedGuildJson.data.guildScope.valid, false);
    assert.equal(mismatchedGuildJson.data.guildScope.reasonCode, 'guild_scope_mismatch');

    assert.equal(protectedStatus.statusCode, 503);
    const protectedStatusJson = parseJsonBody(protectedStatus);
    assert.equal(protectedStatusJson.ok, false);
    assert.equal(protectedStatusJson.error, 'auth_disabled');
    assert.equal(protectedStatusJson.details.reasonCode, 'auth_disabled');
    assert.equal(protectedStatusJson.details.mode, 'disabled');

    assert.equal(protectedGuildAccess.statusCode, 503);
    const protectedGuildAccessJson = parseJsonBody(protectedGuildAccess);
    assert.equal(protectedGuildAccessJson.ok, false);
    assert.equal(protectedGuildAccessJson.error, 'auth_disabled');

    assert.equal(protectedMethodDenied.statusCode, 405);
    const protectedMethodDeniedJson = parseJsonBody(protectedMethodDenied);
    assert.equal(protectedMethodDeniedJson.ok, false);
    assert.equal(protectedMethodDeniedJson.error, 'method_not_allowed');

    assert.equal(protectedMissing.statusCode, 404);
    const protectedMissingJson = parseJsonBody(protectedMissing);
    assert.equal(protectedMissingJson.ok, false);
    assert.equal(protectedMissingJson.error, 'not_found');

    assert.equal(methodDenied.statusCode, 405);
    const methodDeniedJson = parseJsonBody(methodDenied);
    assert.equal(methodDeniedJson.ok, false);
    assert.equal(methodDeniedJson.error, 'method_not_allowed');

    assert.equal(dashboardMethodDenied.statusCode, 405);
    const dashboardMethodDeniedJson = parseJsonBody(dashboardMethodDenied);
    assert.equal(dashboardMethodDeniedJson.ok, false);
    assert.equal(dashboardMethodDeniedJson.error, 'method_not_allowed');

    assert.equal(missingRoute.statusCode, 404);
    const missingRouteJson = parseJsonBody(missingRoute);
    assert.equal(missingRouteJson.ok, false);
    assert.equal(missingRouteJson.error, 'not_found');

    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/dashboard/overview'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/dashboard/context'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/dashboard/context/features'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/dashboard/protected/overview'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes(
        'GET /api/dashboard/protected/setup-readiness'
      ),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/dashboard/protected/preferences'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('PUT /api/dashboard/protected/preferences'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes(
        'GET /api/dashboard/protected/bot-settings/status-command'
      ),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes(
        'PUT /api/dashboard/protected/bot-settings/status-command'
      ),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes(
        'GET /api/dashboard/protected/bot-settings/commands'
      ),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes(
        'PUT /api/dashboard/protected/bot-settings/commands'
      ),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/control/private/status'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/auth/access'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/auth/plan'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/auth/guilds'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('GET /api/auth/login'),
      true
    );
    assert.equal(
      capabilitiesJson.data.endpoints.includes('POST /api/auth/logout'),
      true
    );

    const allBodies = [
      runtime.body,
      capabilities.body,
      configSummary.body,
      overview.body,
      guild.body,
      features.body,
      resources.body,
      dashboardContext.body,
      dashboardContextFeatures.body,
      protectedOverview.body,
      protectedPreferencesGet.body,
      protectedPreferencesPut.body,
      protectedBotStatusSettingsGet.body,
      protectedBotStatusSettingsPut.body,
      authPlan.body,
      protectedStatus.body,
      protectedGuildAccess.body,
    ].join('\n');
    assert.equal(allBodies.includes(secretToken), false);
    assert.equal(allBodies.includes(secretDbPassword), false);
    assert.equal(allBodies.includes('postgres://'), false);
  } finally {
    await server.close();
  }
});

test('control-plane request context is attached for API routes with safe auth placeholders', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        controlPlane: {
          enabled: true,
        },
      },
      createProtectedRouteDefinitionsFn: () => [],
      createPublicRouteDefinitionsFn: () => ({
        routeDefinitions: [
          {
            method: 'GET',
            path: '/api/meta/request-context-probe',
            handler: ({ req, requestContext, authContext }) => ({
              requestId: requestContext?.requestId || null,
              requestContextAttached: req?.controlPlaneContext === requestContext,
              method: requestContext?.method || null,
              path: requestContext?.path || null,
              requestedGuildId: requestContext?.guildScope?.requestedGuildId || null,
              principal: requestContext?.principal || null,
              auth: {
                mode: requestContext?.auth?.mode || null,
                enabled: Boolean(requestContext?.auth?.enabled),
                configured: Boolean(requestContext?.auth?.configured),
                authenticated: Boolean(requestContext?.auth?.authenticated),
                reasonCode: requestContext?.auth?.reasonCode || null,
              },
              authContext: {
                mode: authContext?.mode || null,
                enabled: Boolean(authContext?.enabled),
                configured: Boolean(authContext?.configured),
                authenticated: Boolean(authContext?.authenticated),
                reasonCode: authContext?.reasonCode || null,
                principal: authContext?.principal || null,
                hasSession: Boolean(authContext?.session),
              },
            }),
          },
        ],
      }),
    })
  );

  try {
    const probe = await request({
      port: server.port,
      path: '/api/meta/request-context-probe?guildId=999999999999999001',
    });

    assert.equal(probe.statusCode, 200);
    const probeJson = parseJsonBody(probe);
    assert.equal(probeJson.ok, true);
    assert.equal(probeJson.data.requestContextAttached, true);
    assert.match(String(probeJson.data.requestId || ''), /^cp_/);
    assert.equal(probeJson.data.method, 'GET');
    assert.equal(probeJson.data.path, '/api/meta/request-context-probe');
    assert.equal(probeJson.data.requestedGuildId, '999999999999999001');
    assert.equal(probeJson.data.principal, null);
    assert.equal(probeJson.data.auth.mode, 'disabled');
    assert.equal(probeJson.data.auth.enabled, false);
    assert.equal(probeJson.data.auth.configured, false);
    assert.equal(probeJson.data.auth.authenticated, false);
    assert.equal(probeJson.data.auth.reasonCode, 'auth_disabled');
    assert.equal(probeJson.data.authContext.mode, 'disabled');
    assert.equal(probeJson.data.authContext.enabled, false);
    assert.equal(probeJson.data.authContext.configured, false);
    assert.equal(probeJson.data.authContext.authenticated, false);
    assert.equal(probeJson.data.authContext.reasonCode, 'auth_disabled');
    assert.equal(probeJson.data.authContext.principal, null);
    assert.equal(probeJson.data.authContext.hasSession, false);
  } finally {
    await server.close();
  }
});

test('auth routes fail safely when auth is enabled but unconfigured', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'test',
        controlPlane: {
          enabled: true,
          auth: {
            enabled: true,
            configured: false,
            sessionSecret: 'short-secret',
            cookieSecure: false,
            cookieSameSite: 'Lax',
          },
        },
        oauth: {
          singleGuildId: '',
          clientId: '',
          clientSecret: '',
          redirectUri: '',
        },
        discord: { token: '', targetGuildId: '', startupVoiceChannelId: '' },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => [],
    })
  );

  try {
    const runtime = await request({ port: server.port, path: '/api/meta/runtime' });
    const status = await request({ port: server.port, path: '/api/auth/status' });
    const login = await request({ port: server.port, path: '/api/auth/login' });
    const callback = await request({ port: server.port, path: '/api/auth/callback?code=abc&state=def' });
    const me = await request({ port: server.port, path: '/api/auth/me' });
    const guilds = await request({ port: server.port, path: '/api/auth/guilds' });
    const access = await request({ port: server.port, path: '/api/auth/access' });
    const authPlan = await request({ port: server.port, path: '/api/auth/plan' });
    const logout = await request({ port: server.port, path: '/api/auth/logout', method: 'POST' });
    const dashboardContext = await request({ port: server.port, path: '/api/dashboard/context' });
    const dashboardContextFeatures = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
    });
    const protectedOverview = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
    });
    const protectedPreferencesGet = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
    });
    const protectedPreferencesPut = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    const protectedBotStatusSettingsGet = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
    });
    const protectedBotStatusSettingsPut = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    const protectedStatus = await request({ port: server.port, path: '/api/control/private/status' });

    assert.equal(runtime.statusCode, 200);

    assert.equal(status.statusCode, 200);
    const statusJson = parseJsonBody(status);
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.data.auth.enabled, true);
    assert.equal(statusJson.data.auth.configured, false);
    assert.equal(statusJson.data.auth.authenticated, false);
    assert.equal(statusJson.data.auth.reasonCode, 'oauth_config_missing');
    assert.equal(statusJson.data.scheduler.enabled, false);
    assert.equal(statusJson.data.scheduler.requestedProvider, 'memory');
    assert.equal(
      statusJson.data.scheduler.adoption.authExpiryCleanupEnabled,
      false
    );

    assert.equal(login.statusCode, 503);
    const loginJson = parseJsonBody(login);
    assert.equal(loginJson.ok, false);
    assert.equal(loginJson.error, 'auth_not_configured');

    assert.equal(callback.statusCode, 503);
    const callbackJson = parseJsonBody(callback);
    assert.equal(callbackJson.ok, false);
    assert.equal(callbackJson.error, 'auth_not_configured');

    assert.equal(me.statusCode, 503);
    const meJson = parseJsonBody(me);
    assert.equal(meJson.ok, false);
    assert.equal(meJson.error, 'auth_not_configured');

    assert.equal(guilds.statusCode, 503);
    const guildsJson = parseJsonBody(guilds);
    assert.equal(guildsJson.ok, false);
    assert.equal(guildsJson.error, 'auth_not_configured');

    assert.equal(access.statusCode, 503);
    const accessJson = parseJsonBody(access);
    assert.equal(accessJson.ok, false);
    assert.equal(accessJson.error, 'auth_not_configured');

    assert.equal(authPlan.statusCode, 503);
    const authPlanJson = parseJsonBody(authPlan);
    assert.equal(authPlanJson.ok, false);
    assert.equal(authPlanJson.error, 'auth_not_configured');

    assert.equal(logout.statusCode, 503);
    const logoutJson = parseJsonBody(logout);
    assert.equal(logoutJson.ok, false);
    assert.equal(logoutJson.error, 'auth_not_configured');

    assert.equal(dashboardContext.statusCode, 503);
    const dashboardContextJson = parseJsonBody(dashboardContext);
    assert.equal(dashboardContextJson.ok, false);
    assert.equal(dashboardContextJson.error, 'auth_not_configured');

    assert.equal(dashboardContextFeatures.statusCode, 503);
    const dashboardContextFeaturesJson = parseJsonBody(dashboardContextFeatures);
    assert.equal(dashboardContextFeaturesJson.ok, false);
    assert.equal(dashboardContextFeaturesJson.error, 'auth_not_configured');

    assert.equal(protectedOverview.statusCode, 503);
    const protectedOverviewJson = parseJsonBody(protectedOverview);
    assert.equal(protectedOverviewJson.ok, false);
    assert.equal(protectedOverviewJson.error, 'auth_not_configured');

    assert.equal(protectedPreferencesGet.statusCode, 503);
    const protectedPreferencesGetJson = parseJsonBody(protectedPreferencesGet);
    assert.equal(protectedPreferencesGetJson.ok, false);
    assert.equal(protectedPreferencesGetJson.error, 'auth_not_configured');

    assert.equal(protectedPreferencesPut.statusCode, 503);
    const protectedPreferencesPutJson = parseJsonBody(protectedPreferencesPut);
    assert.equal(protectedPreferencesPutJson.ok, false);
    assert.equal(protectedPreferencesPutJson.error, 'auth_not_configured');

    assert.equal(protectedBotStatusSettingsGet.statusCode, 503);
    const protectedBotStatusSettingsGetJson = parseJsonBody(protectedBotStatusSettingsGet);
    assert.equal(protectedBotStatusSettingsGetJson.ok, false);
    assert.equal(protectedBotStatusSettingsGetJson.error, 'auth_not_configured');

    assert.equal(protectedBotStatusSettingsPut.statusCode, 503);
    const protectedBotStatusSettingsPutJson = parseJsonBody(protectedBotStatusSettingsPut);
    assert.equal(protectedBotStatusSettingsPutJson.ok, false);
    assert.equal(protectedBotStatusSettingsPutJson.error, 'auth_not_configured');

    assert.equal(protectedStatus.statusCode, 503);
    const protectedJson = parseJsonBody(protectedStatus);
    assert.equal(protectedJson.ok, false);
    assert.equal(protectedJson.error, 'auth_not_configured');
  } finally {
    await server.close();
  }
});

test('configured auth supports login callback session resolution me and logout', async () => {
  const oauthFetchCalls = [];
  const mockFetch = async (url, options = {}) => {
    const normalizedUrl = String(url || '');
    oauthFetchCalls.push({
      url: normalizedUrl,
      method: String(options?.method || 'GET').toUpperCase(),
    });

    if (normalizedUrl.endsWith('/api/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'discord-access-token',
          token_type: 'Bearer',
          scope: 'identify',
        }),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '123456789012345678',
          username: 'auth-user',
          global_name: 'Auth User',
          avatar: 'a1b2c3d4',
        }),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me/guilds')) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'test',
        controlPlane: {
          enabled: true,
          auth: {
            enabled: true,
            configured: true,
            sessionSecret: '1234567890abcdef1234567890abcdef',
            sessionCookieName: 'cp_session',
            sessionTtlMs: 15 * 60 * 1000,
            oauthStateTtlMs: 10 * 60 * 1000,
            cookieSecure: false,
            cookieSameSite: 'Lax',
            postLoginRedirectUri: '/dashboard',
          },
          premium: {
            defaultPlan: 'free',
            manualPlanOverrides: {
              '999999999999999001': 'pro',
            },
          },
        },
        oauth: {
          singleGuildId: '',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          redirectUri: 'http://127.0.0.1/api/auth/callback',
        },
        discord: { token: '', targetGuildId: '', startupVoiceChannelId: '' },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => [],
      authFoundationOptions: {
        fetchImpl: mockFetch,
      },
    })
  );

  try {
    const authStatusBefore = await request({ port: server.port, path: '/api/auth/status' });
    assert.equal(authStatusBefore.statusCode, 200);
    const authStatusBeforeJson = parseJsonBody(authStatusBefore);
    assert.equal(authStatusBeforeJson.ok, true);
    assert.equal(authStatusBeforeJson.data.auth.enabled, true);
    assert.equal(authStatusBeforeJson.data.auth.configured, true);
    assert.equal(authStatusBeforeJson.data.auth.authenticated, false);
    assert.equal(authStatusBeforeJson.data.scheduler.enabled, false);
    assert.equal(authStatusBeforeJson.data.scheduler.activeProvider, 'memory');

    const meBefore = await request({ port: server.port, path: '/api/auth/me' });
    assert.equal(meBefore.statusCode, 401);
    const meBeforeJson = parseJsonBody(meBefore);
    assert.equal(meBeforeJson.ok, false);
    assert.equal(meBeforeJson.error, 'unauthenticated');

    const guildsBefore = await request({ port: server.port, path: '/api/auth/guilds' });
    assert.equal(guildsBefore.statusCode, 401);
    const guildsBeforeJson = parseJsonBody(guildsBefore);
    assert.equal(guildsBeforeJson.ok, false);
    assert.equal(guildsBeforeJson.error, 'unauthenticated');

    const accessBefore = await request({ port: server.port, path: '/api/auth/access' });
    assert.equal(accessBefore.statusCode, 401);
    const accessBeforeJson = parseJsonBody(accessBefore);
    assert.equal(accessBeforeJson.ok, false);
    assert.equal(accessBeforeJson.error, 'unauthenticated');

    const authPlanBefore = await request({ port: server.port, path: '/api/auth/plan' });
    assert.equal(authPlanBefore.statusCode, 401);
    const authPlanBeforeJson = parseJsonBody(authPlanBefore);
    assert.equal(authPlanBeforeJson.ok, false);
    assert.equal(authPlanBeforeJson.error, 'unauthenticated');

    const dashboardContextBefore = await request({ port: server.port, path: '/api/dashboard/context' });
    assert.equal(dashboardContextBefore.statusCode, 401);
    const dashboardContextBeforeJson = parseJsonBody(dashboardContextBefore);
    assert.equal(dashboardContextBeforeJson.ok, false);
    assert.equal(dashboardContextBeforeJson.error, 'unauthenticated');

    const dashboardContextFeaturesBefore = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
    });
    assert.equal(dashboardContextFeaturesBefore.statusCode, 401);
    const dashboardContextFeaturesBeforeJson = parseJsonBody(dashboardContextFeaturesBefore);
    assert.equal(dashboardContextFeaturesBeforeJson.ok, false);
    assert.equal(dashboardContextFeaturesBeforeJson.error, 'unauthenticated');

    const protectedOverviewBefore = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
    });
    assert.equal(protectedOverviewBefore.statusCode, 401);
    const protectedOverviewBeforeJson = parseJsonBody(protectedOverviewBefore);
    assert.equal(protectedOverviewBeforeJson.ok, false);
    assert.equal(protectedOverviewBeforeJson.error, 'unauthenticated');

    const protectedPreferencesGetBefore = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
    });
    assert.equal(protectedPreferencesGetBefore.statusCode, 401);
    const protectedPreferencesGetBeforeJson = parseJsonBody(protectedPreferencesGetBefore);
    assert.equal(protectedPreferencesGetBeforeJson.ok, false);
    assert.equal(protectedPreferencesGetBeforeJson.error, 'unauthenticated');

    const protectedPreferencesPutBefore = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    assert.equal(protectedPreferencesPutBefore.statusCode, 401);
    const protectedPreferencesPutBeforeJson = parseJsonBody(protectedPreferencesPutBefore);
    assert.equal(protectedPreferencesPutBeforeJson.ok, false);
    assert.equal(protectedPreferencesPutBeforeJson.error, 'unauthenticated');

    const protectedBotStatusSettingsGetBefore = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
    });
    assert.equal(protectedBotStatusSettingsGetBefore.statusCode, 401);
    const protectedBotStatusSettingsGetBeforeJson = parseJsonBody(
      protectedBotStatusSettingsGetBefore
    );
    assert.equal(protectedBotStatusSettingsGetBeforeJson.ok, false);
    assert.equal(protectedBotStatusSettingsGetBeforeJson.error, 'unauthenticated');

    const protectedBotStatusSettingsPutBefore = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutBefore.statusCode, 401);
    const protectedBotStatusSettingsPutBeforeJson = parseJsonBody(
      protectedBotStatusSettingsPutBefore
    );
    assert.equal(protectedBotStatusSettingsPutBeforeJson.ok, false);
    assert.equal(protectedBotStatusSettingsPutBeforeJson.error, 'unauthenticated');

    const protectedBefore = await request({ port: server.port, path: '/api/control/private/status' });
    assert.equal(protectedBefore.statusCode, 401);
    const protectedBeforeJson = parseJsonBody(protectedBefore);
    assert.equal(protectedBeforeJson.ok, false);
    assert.equal(protectedBeforeJson.error, 'unauthenticated');

    const login = await request({ port: server.port, path: '/api/auth/login' });
    assert.equal(login.statusCode, 302);
    assert.match(String(login.headers.location || ''), /^https:\/\/discord\.com\/oauth2\/authorize\?/);

    const loginRedirect = new URL(String(login.headers.location || ''));
    const oauthState = loginRedirect.searchParams.get('state');
    assert.ok(oauthState);
    assert.equal(loginRedirect.searchParams.get('client_id'), 'oauth-client-id');
    assert.equal(loginRedirect.searchParams.get('response_type'), 'code');
    assert.equal(loginRedirect.searchParams.get('scope'), 'identify guilds');

    const callbackMissingState = await request({
      port: server.port,
      path: '/api/auth/callback?code=oauth-code-only',
    });
    assert.equal(callbackMissingState.statusCode, 400);
    const callbackMissingStateJson = parseJsonBody(callbackMissingState);
    assert.equal(callbackMissingStateJson.ok, false);
    assert.equal(callbackMissingStateJson.error, 'invalid_oauth_callback');

    const callbackInvalidState = await request({
      port: server.port,
      path: '/api/auth/callback?code=oauth-code&state=invalid-state',
    });
    assert.equal(callbackInvalidState.statusCode, 400);
    const callbackInvalidStateJson = parseJsonBody(callbackInvalidState);
    assert.equal(callbackInvalidStateJson.ok, false);
    assert.equal(callbackInvalidStateJson.error, 'invalid_oauth_state');

    const callback = await request({
      port: server.port,
      path: `/api/auth/callback?code=oauth-code&state=${encodeURIComponent(oauthState)}`,
    });
    assert.equal(callback.statusCode, 302);
    const callbackRedirect = new URL(
      String(callback.headers.location || ''),
      'http://127.0.0.1'
    );
    assert.equal(callbackRedirect.pathname, '/dashboard');
    assert.ok(String(callbackRedirect.searchParams.get('loginCode') || '').trim());

    const sessionSetCookie = firstSetCookieHeader(callback.headers);
    assert.match(sessionSetCookie, /^cp_session=/);
    assert.match(sessionSetCookie, /HttpOnly/);
    assert.match(sessionSetCookie, /SameSite=Lax/);
    const sessionCookiePair = toCookiePair(sessionSetCookie);
    assert.ok(sessionCookiePair);

    const authStatusAfter = await request({
      port: server.port,
      path: '/api/auth/status',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(authStatusAfter.statusCode, 200);
    const authStatusAfterJson = parseJsonBody(authStatusAfter);
    assert.equal(authStatusAfterJson.ok, true);
    assert.equal(authStatusAfterJson.data.auth.authenticated, true);
    assert.equal(authStatusAfterJson.data.principal.id, '123456789012345678');
    assert.equal(authStatusAfterJson.data.principal.username, 'auth-user');
    assert.equal(authStatusAfterJson.data.scheduler.enabled, false);
    assert.equal(authStatusAfterJson.data.scheduler.activeProvider, 'memory');

    const meAfter = await request({
      port: server.port,
      path: '/api/auth/me',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(meAfter.statusCode, 200);
    const meAfterJson = parseJsonBody(meAfter);
    assert.equal(meAfterJson.ok, true);
    assert.equal(meAfterJson.data.principal.id, '123456789012345678');
    assert.equal(meAfterJson.data.principal.displayName, 'Auth User');
    assert.equal(typeof meAfterJson.data.principal.avatarUrl, 'string');
    assert.equal(Boolean(meAfterJson.data.session.id), true);

    const guildsAfter = await request({
      port: server.port,
      path: '/api/auth/guilds',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(guildsAfter.statusCode, 200);
    const guildsAfterJson = parseJsonBody(guildsAfter);
    assert.equal(guildsAfterJson.ok, true);
    assert.deepEqual(guildsAfterJson.data.guilds, []);
    assert.equal(guildsAfterJson.data.summary.guildCount, 0);

    const accessAfter = await request({
      port: server.port,
      path: '/api/auth/access',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(accessAfter.statusCode, 403);
    const accessAfterJson = parseJsonBody(accessAfter);
    assert.equal(accessAfterJson.ok, false);
    assert.equal(accessAfterJson.error, 'guild_access_denied');
    assert.equal(accessAfterJson.details.reasonCode, 'guild_scope_unresolved');

    const authPlanAfter = await request({
      port: server.port,
      path: '/api/auth/plan',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(authPlanAfter.statusCode, 403);
    const authPlanAfterJson = parseJsonBody(authPlanAfter);
    assert.equal(authPlanAfterJson.ok, false);
    assert.equal(authPlanAfterJson.error, 'guild_access_denied');
    assert.equal(authPlanAfterJson.details.reasonCode, 'guild_scope_unresolved');

    const protectedOverviewAfter = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(protectedOverviewAfter.statusCode, 403);
    const protectedOverviewAfterJson = parseJsonBody(protectedOverviewAfter);
    assert.equal(protectedOverviewAfterJson.ok, false);
    assert.equal(protectedOverviewAfterJson.error, 'guild_access_denied');
    assert.equal(protectedOverviewAfterJson.details.reasonCode, 'guild_scope_unresolved');

    const protectedPreferencesGetAfter = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(protectedPreferencesGetAfter.statusCode, 403);
    const protectedPreferencesGetAfterJson = parseJsonBody(protectedPreferencesGetAfter);
    assert.equal(protectedPreferencesGetAfterJson.ok, false);
    assert.equal(protectedPreferencesGetAfterJson.error, 'guild_access_denied');
    assert.equal(protectedPreferencesGetAfterJson.details.reasonCode, 'guild_scope_unresolved');

    const protectedPreferencesPutAfter = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: sessionCookiePair,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    assert.equal(protectedPreferencesPutAfter.statusCode, 403);
    const protectedPreferencesPutAfterJson = parseJsonBody(protectedPreferencesPutAfter);
    assert.equal(protectedPreferencesPutAfterJson.ok, false);
    assert.equal(protectedPreferencesPutAfterJson.error, 'guild_access_denied');
    assert.equal(protectedPreferencesPutAfterJson.details.reasonCode, 'guild_scope_unresolved');

    const protectedBotStatusSettingsGetAfter = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(protectedBotStatusSettingsGetAfter.statusCode, 403);
    const protectedBotStatusSettingsGetAfterJson = parseJsonBody(
      protectedBotStatusSettingsGetAfter
    );
    assert.equal(protectedBotStatusSettingsGetAfterJson.ok, false);
    assert.equal(protectedBotStatusSettingsGetAfterJson.error, 'guild_access_denied');
    assert.equal(
      protectedBotStatusSettingsGetAfterJson.details.reasonCode,
      'guild_scope_unresolved'
    );

    const protectedBotStatusSettingsPutAfter = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: sessionCookiePair,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutAfter.statusCode, 403);
    const protectedBotStatusSettingsPutAfterJson = parseJsonBody(
      protectedBotStatusSettingsPutAfter
    );
    assert.equal(protectedBotStatusSettingsPutAfterJson.ok, false);
    assert.equal(protectedBotStatusSettingsPutAfterJson.error, 'guild_access_denied');
    assert.equal(
      protectedBotStatusSettingsPutAfterJson.details.reasonCode,
      'guild_scope_unresolved'
    );

    const dashboardContextFeaturesAfter = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(dashboardContextFeaturesAfter.statusCode, 403);
    const dashboardContextFeaturesAfterJson = parseJsonBody(dashboardContextFeaturesAfter);
    assert.equal(dashboardContextFeaturesAfterJson.ok, false);
    assert.equal(dashboardContextFeaturesAfterJson.error, 'guild_access_denied');
    assert.equal(dashboardContextFeaturesAfterJson.details.reasonCode, 'guild_scope_unresolved');

    const protectedAfter = await request({
      port: server.port,
      path: '/api/control/private/status',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(protectedAfter.statusCode, 200);
    const protectedAfterJson = parseJsonBody(protectedAfter);
    assert.equal(protectedAfterJson.ok, true);
    assert.equal(protectedAfterJson.data.mode, 'protected_placeholder');

    const logout = await request({
      port: server.port,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(logout.statusCode, 200);
    const logoutJson = parseJsonBody(logout);
    assert.equal(logoutJson.ok, true);
    assert.equal(logoutJson.data.loggedOut, true);
    const clearCookie = firstSetCookieHeader(logout.headers);
    assert.match(clearCookie, /^cp_session=/);
    assert.match(clearCookie, /Max-Age=0/);

    const authStatusAfterLogout = await request({
      port: server.port,
      path: '/api/auth/status',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(authStatusAfterLogout.statusCode, 200);
    const authStatusAfterLogoutJson = parseJsonBody(authStatusAfterLogout);
    assert.equal(authStatusAfterLogoutJson.ok, true);
    assert.equal(authStatusAfterLogoutJson.data.auth.authenticated, false);

    assert.equal(oauthFetchCalls.length, 3);
    assert.equal(oauthFetchCalls[0].method, 'POST');
    assert.match(oauthFetchCalls[0].url, /\/api\/oauth2\/token$/);
    assert.equal(oauthFetchCalls[1].method, 'GET');
    assert.match(oauthFetchCalls[1].url, /\/api\/users\/@me$/);
    assert.equal(oauthFetchCalls[2].method, 'GET');
    assert.match(oauthFetchCalls[2].url, /\/api\/users\/@me\/guilds$/);

    const allBodies = [
      callback.body,
      authStatusAfter.body,
      meAfter.body,
      guildsAfter.body,
      accessAfter.body,
      authPlanAfter.body,
      protectedOverviewAfter.body,
      protectedPreferencesGetAfter.body,
      protectedPreferencesPutAfter.body,
      protectedBotStatusSettingsGetAfter.body,
      protectedBotStatusSettingsPutAfter.body,
      dashboardContextFeaturesAfter.body,
      logout.body,
    ].join('\n');
    assert.equal(allBodies.includes('oauth-client-secret'), false);
    assert.equal(allBodies.includes('discord-access-token'), false);
  } finally {
    await server.close();
  }
});

test('production callback and logout set cross-site compatible session cookie attributes', async () => {
  const oauthFetchCalls = [];
  const mockFetch = async (url, options = {}) => {
    const normalizedUrl = String(url || '');
    oauthFetchCalls.push({
      url: normalizedUrl,
      method: String(options?.method || 'GET').toUpperCase(),
    });

    if (normalizedUrl.endsWith('/api/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'discord-access-token-production',
          token_type: 'Bearer',
          scope: 'identify guilds',
        }),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '223456789012345678',
          username: 'prod-auth-user',
          global_name: 'Prod Auth User',
          avatar: 'prod-avatar',
        }),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me/guilds')) {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'production',
        controlPlane: {
          enabled: true,
          auth: {
            enabled: true,
            configured: true,
            sessionSecret: 'abcdef0123456789abcdef0123456789',
            sessionCookieName: 'cp_session',
            sessionTtlMs: 15 * 60 * 1000,
            oauthStateTtlMs: 10 * 60 * 1000,
            cookieSecure: true,
            cookieSameSite: 'None',
            postLoginRedirectUri: 'https://geass-dashboard.pages.dev',
            dashboardAllowedOrigins: ['https://geass-dashboard.pages.dev'],
          },
        },
        oauth: {
          singleGuildId: '',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          redirectUri: 'https://geass-production.up.railway.app/api/auth/callback',
        },
        discord: { token: '', targetGuildId: '', startupVoiceChannelId: '' },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => [],
      authFoundationOptions: {
        fetchImpl: mockFetch,
      },
    })
  );

  try {
    const login = await request({ port: server.port, path: '/api/auth/login' });
    assert.equal(login.statusCode, 302);
    const state = new URL(String(login.headers.location || '')).searchParams.get('state');
    assert.ok(state);

    const callback = await request({
      port: server.port,
      path: `/api/auth/callback?code=oauth-prod-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callback.statusCode, 302);
    const callbackRedirect = new URL(String(callback.headers.location || ''));
    assert.equal(
      `${callbackRedirect.origin}${callbackRedirect.pathname}`,
      'https://geass-dashboard.pages.dev/'
    );
    assert.ok(String(callbackRedirect.searchParams.get('loginCode') || '').trim());

    const sessionSetCookie = firstSetCookieHeader(callback.headers);
    assert.match(sessionSetCookie, /^cp_session=/);
    assert.match(sessionSetCookie, /HttpOnly/);
    assert.match(sessionSetCookie, /Secure/);
    assert.match(sessionSetCookie, /SameSite=None/);
    assert.match(sessionSetCookie, /Path=\//);
    const sessionCookiePair = toCookiePair(sessionSetCookie);
    assert.ok(sessionCookiePair);

    const authStatusAfter = await request({
      port: server.port,
      path: '/api/auth/status',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(authStatusAfter.statusCode, 200);
    const authStatusAfterJson = parseJsonBody(authStatusAfter);
    assert.equal(authStatusAfterJson.ok, true);
    assert.equal(authStatusAfterJson.data.auth.authenticated, true);

    const logout = await request({
      port: server.port,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        Cookie: sessionCookiePair,
      },
    });
    assert.equal(logout.statusCode, 200);
    const logoutJson = parseJsonBody(logout);
    assert.equal(logoutJson.ok, true);
    assert.equal(logoutJson.data.loggedOut, true);

    const clearCookie = firstSetCookieHeader(logout.headers);
    assert.match(clearCookie, /^cp_session=/);
    assert.match(clearCookie, /HttpOnly/);
    assert.match(clearCookie, /Secure/);
    assert.match(clearCookie, /SameSite=None/);
    assert.match(clearCookie, /Path=\//);
    assert.match(clearCookie, /Max-Age=0/);

    assert.equal(oauthFetchCalls.length, 3);
  } finally {
    await server.close();
  }
});

test('guild access endpoints fail closed for no-access users and allow authenticated guild operators', async () => {
  const oauthFetchCalls = [];
  const mutationAuditEntries = [];
  const mutationAuditRecorder = {
    async record(entry = {}) {
      mutationAuditEntries.push(entry);
      return entry;
    },
  };
  const tokenByCode = new Map([
    ['no-access-user', 'token-no-access'],
    ['operator-user', 'token-operator'],
  ]);
  const identityByToken = {
    'token-no-access': {
      id: '223456789012345678',
      username: 'no-access-user',
      global_name: 'No Access User',
      avatar: 'avatar-no-access',
    },
    'token-operator': {
      id: '323456789012345678',
      username: 'operator-user',
      global_name: 'Operator User',
      avatar: 'avatar-operator',
    },
  };
  const guildsByToken = {
    'token-no-access': [
      {
        id: '999999999999999777',
        name: 'Elsewhere Guild',
        icon: 'icon-elsewhere',
        owner: false,
        permissions: '1024',
      },
    ],
    'token-operator': [
      {
        id: '999999999999999001',
        name: 'Primary Guild',
        icon: 'icon-primary',
        owner: false,
        permissions: '8',
      },
    ],
  };

  const mockFetch = async (url, options = {}) => {
    const normalizedUrl = String(url || '');
    const method = String(options?.method || 'GET').toUpperCase();
    oauthFetchCalls.push({
      url: normalizedUrl,
      method,
    });

    if (normalizedUrl.endsWith('/api/oauth2/token')) {
      const body = new URLSearchParams(String(options?.body || ''));
      const code = String(body.get('code') || '').trim();
      const token = tokenByCode.get(code) || 'token-unknown';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: token,
          token_type: 'Bearer',
          scope: 'identify guilds',
        }),
      };
    }

    const authorization = String(options?.headers?.Authorization || '');
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (normalizedUrl.endsWith('/api/users/@me')) {
      const identity = identityByToken[accessToken] || {
        id: '423456789012345678',
        username: 'unknown-user',
        global_name: 'Unknown User',
        avatar: 'avatar-unknown',
      };
      return {
        ok: true,
        status: 200,
        json: async () => identity,
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me/guilds')) {
      return {
        ok: true,
        status: 200,
        json: async () => guildsByToken[accessToken] || [],
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
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
          },
          premium: {
            defaultPlan: 'free',
            manualPlanOverrides: {
              '999999999999999001': 'pro',
            },
          },
        },
        oauth: {
          singleGuildId: '999999999999999001',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          redirectUri: 'http://127.0.0.1/api/auth/callback',
        },
        discord: {
          token: '',
          targetGuildId: '999999999999999001',
          startupVoiceChannelId: '',
        },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => ['999999999999999001'],
      authFoundationOptions: {
        fetchImpl: mockFetch,
      },
      mutationAuditRecorder,
    })
  );

  async function loginAndCreateSessionCookie(oauthCode) {
    const login = await request({ port: server.port, path: '/api/auth/login' });
    assert.equal(login.statusCode, 302);
    const state = new URL(String(login.headers.location || '')).searchParams.get('state');
    assert.ok(state);

    const callback = await request({
      port: server.port,
      path: `/api/auth/callback?code=${encodeURIComponent(oauthCode)}&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callback.statusCode, 302);
    const sessionCookie = toCookiePair(firstSetCookieHeader(callback.headers));
    assert.ok(sessionCookie);
    return sessionCookie;
  }

  try {
    const accessUnauth = await request({ port: server.port, path: '/api/auth/access' });
    assert.equal(accessUnauth.statusCode, 401);
    const accessUnauthJson = parseJsonBody(accessUnauth);
    assert.equal(accessUnauthJson.ok, false);
    assert.equal(accessUnauthJson.error, 'unauthenticated');

    const dashboardContextUnauth = await request({ port: server.port, path: '/api/dashboard/context' });
    assert.equal(dashboardContextUnauth.statusCode, 401);
    const dashboardContextUnauthJson = parseJsonBody(dashboardContextUnauth);
    assert.equal(dashboardContextUnauthJson.ok, false);
    assert.equal(dashboardContextUnauthJson.error, 'unauthenticated');

    const dashboardContextFeaturesUnauth = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
    });
    assert.equal(dashboardContextFeaturesUnauth.statusCode, 401);
    const dashboardContextFeaturesUnauthJson = parseJsonBody(dashboardContextFeaturesUnauth);
    assert.equal(dashboardContextFeaturesUnauthJson.ok, false);
    assert.equal(dashboardContextFeaturesUnauthJson.error, 'unauthenticated');

    const protectedOverviewUnauth = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
    });
    assert.equal(protectedOverviewUnauth.statusCode, 401);
    const protectedOverviewUnauthJson = parseJsonBody(protectedOverviewUnauth);
    assert.equal(protectedOverviewUnauthJson.ok, false);
    assert.equal(protectedOverviewUnauthJson.error, 'unauthenticated');

    const protectedPreferencesGetUnauth = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
    });
    assert.equal(protectedPreferencesGetUnauth.statusCode, 401);
    const protectedPreferencesGetUnauthJson = parseJsonBody(protectedPreferencesGetUnauth);
    assert.equal(protectedPreferencesGetUnauthJson.ok, false);
    assert.equal(protectedPreferencesGetUnauthJson.error, 'unauthenticated');

    const protectedPreferencesPutUnauth = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    assert.equal(protectedPreferencesPutUnauth.statusCode, 401);
    const protectedPreferencesPutUnauthJson = parseJsonBody(protectedPreferencesPutUnauth);
    assert.equal(protectedPreferencesPutUnauthJson.ok, false);
    assert.equal(protectedPreferencesPutUnauthJson.error, 'unauthenticated');

    const protectedBotStatusSettingsGetUnauth = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
    });
    assert.equal(protectedBotStatusSettingsGetUnauth.statusCode, 401);
    const protectedBotStatusSettingsGetUnauthJson = parseJsonBody(
      protectedBotStatusSettingsGetUnauth
    );
    assert.equal(protectedBotStatusSettingsGetUnauthJson.ok, false);
    assert.equal(protectedBotStatusSettingsGetUnauthJson.error, 'unauthenticated');

    const protectedBotStatusSettingsPutUnauth = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutUnauth.statusCode, 401);
    const protectedBotStatusSettingsPutUnauthJson = parseJsonBody(
      protectedBotStatusSettingsPutUnauth
    );
    assert.equal(protectedBotStatusSettingsPutUnauthJson.ok, false);
    assert.equal(protectedBotStatusSettingsPutUnauthJson.error, 'unauthenticated');

    const authPlanUnauth = await request({ port: server.port, path: '/api/auth/plan' });
    assert.equal(authPlanUnauth.statusCode, 401);
    const authPlanUnauthJson = parseJsonBody(authPlanUnauth);
    assert.equal(authPlanUnauthJson.ok, false);
    assert.equal(authPlanUnauthJson.error, 'unauthenticated');

    const noAccessCookie = await loginAndCreateSessionCookie('no-access-user');

    const guildsNoAccess = await request({
      port: server.port,
      path: '/api/auth/guilds',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(guildsNoAccess.statusCode, 200);
    const guildsNoAccessJson = parseJsonBody(guildsNoAccess);
    assert.equal(guildsNoAccessJson.ok, true);
    assert.equal(guildsNoAccessJson.data.summary.guildCount, 1);
    assert.equal(guildsNoAccessJson.data.guilds[0].id, '999999999999999777');
    assert.equal(guildsNoAccessJson.data.guilds[0].isOperator, false);
    assert.equal(Object.hasOwn(guildsNoAccessJson.data.guilds[0], 'permissions'), false);

    const accessNoAccess = await request({
      port: server.port,
      path: '/api/auth/access',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(accessNoAccess.statusCode, 403);
    const accessNoAccessJson = parseJsonBody(accessNoAccess);
    assert.equal(accessNoAccessJson.ok, false);
    assert.equal(accessNoAccessJson.error, 'guild_access_denied');
    assert.equal(accessNoAccessJson.details.reasonCode, 'guild_membership_missing');
    assert.equal(accessNoAccessJson.details.accessLevel, 'authenticated_no_guild_access');

    const dashboardContextNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/context',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(dashboardContextNoAccess.statusCode, 403);
    const dashboardContextNoAccessJson = parseJsonBody(dashboardContextNoAccess);
    assert.equal(dashboardContextNoAccessJson.ok, false);
    assert.equal(dashboardContextNoAccessJson.error, 'guild_access_denied');
    assert.equal(dashboardContextNoAccessJson.details.reasonCode, 'guild_membership_missing');

    const dashboardContextFeaturesNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(dashboardContextFeaturesNoAccess.statusCode, 403);
    const dashboardContextFeaturesNoAccessJson = parseJsonBody(dashboardContextFeaturesNoAccess);
    assert.equal(dashboardContextFeaturesNoAccessJson.ok, false);
    assert.equal(dashboardContextFeaturesNoAccessJson.error, 'guild_access_denied');
    assert.equal(
      dashboardContextFeaturesNoAccessJson.details.reasonCode,
      'guild_membership_missing'
    );

    const protectedOverviewNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(protectedOverviewNoAccess.statusCode, 403);
    const protectedOverviewNoAccessJson = parseJsonBody(protectedOverviewNoAccess);
    assert.equal(protectedOverviewNoAccessJson.ok, false);
    assert.equal(protectedOverviewNoAccessJson.error, 'guild_access_denied');
    assert.equal(protectedOverviewNoAccessJson.details.reasonCode, 'guild_membership_missing');

    const protectedGuildNoAccess = await request({
      port: server.port,
      path: '/api/control/private/guild-access',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(protectedGuildNoAccess.statusCode, 403);
    const protectedGuildNoAccessJson = parseJsonBody(protectedGuildNoAccess);
    assert.equal(protectedGuildNoAccessJson.ok, false);
    assert.equal(protectedGuildNoAccessJson.error, 'guild_access_denied');
    assert.equal(protectedGuildNoAccessJson.details.reasonCode, 'guild_membership_missing');

    const protectedPreferencesGetNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(protectedPreferencesGetNoAccess.statusCode, 403);
    const protectedPreferencesGetNoAccessJson = parseJsonBody(protectedPreferencesGetNoAccess);
    assert.equal(protectedPreferencesGetNoAccessJson.ok, false);
    assert.equal(protectedPreferencesGetNoAccessJson.error, 'guild_access_denied');
    assert.equal(protectedPreferencesGetNoAccessJson.details.reasonCode, 'guild_membership_missing');

    const protectedPreferencesPutNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: noAccessCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    assert.equal(protectedPreferencesPutNoAccess.statusCode, 403);
    const protectedPreferencesPutNoAccessJson = parseJsonBody(protectedPreferencesPutNoAccess);
    assert.equal(protectedPreferencesPutNoAccessJson.ok, false);
    assert.equal(protectedPreferencesPutNoAccessJson.error, 'guild_access_denied');
    assert.equal(protectedPreferencesPutNoAccessJson.details.reasonCode, 'guild_membership_missing');

    const protectedBotStatusSettingsGetNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(protectedBotStatusSettingsGetNoAccess.statusCode, 403);
    const protectedBotStatusSettingsGetNoAccessJson = parseJsonBody(
      protectedBotStatusSettingsGetNoAccess
    );
    assert.equal(protectedBotStatusSettingsGetNoAccessJson.ok, false);
    assert.equal(protectedBotStatusSettingsGetNoAccessJson.error, 'guild_access_denied');
    assert.equal(
      protectedBotStatusSettingsGetNoAccessJson.details.reasonCode,
      'guild_membership_missing'
    );

    const protectedBotStatusSettingsPutNoAccess = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: noAccessCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutNoAccess.statusCode, 403);
    const protectedBotStatusSettingsPutNoAccessJson = parseJsonBody(
      protectedBotStatusSettingsPutNoAccess
    );
    assert.equal(protectedBotStatusSettingsPutNoAccessJson.ok, false);
    assert.equal(protectedBotStatusSettingsPutNoAccessJson.error, 'guild_access_denied');
    assert.equal(
      protectedBotStatusSettingsPutNoAccessJson.details.reasonCode,
      'guild_membership_missing'
    );

    const authPlanNoAccess = await request({
      port: server.port,
      path: '/api/auth/plan',
      headers: {
        Cookie: noAccessCookie,
      },
    });
    assert.equal(authPlanNoAccess.statusCode, 403);
    const authPlanNoAccessJson = parseJsonBody(authPlanNoAccess);
    assert.equal(authPlanNoAccessJson.ok, false);
    assert.equal(authPlanNoAccessJson.error, 'guild_access_denied');
    assert.equal(authPlanNoAccessJson.details.reasonCode, 'guild_membership_missing');

    const operatorCookie = await loginAndCreateSessionCookie('operator-user');

    const accessOperator = await request({
      port: server.port,
      path: '/api/auth/access',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(accessOperator.statusCode, 200);
    const accessOperatorJson = parseJsonBody(accessOperator);
    assert.equal(accessOperatorJson.ok, true);
    assert.equal(accessOperatorJson.data.access.allowed, true);
    assert.equal(accessOperatorJson.data.access.accessLevel, 'authenticated_guild_operator');
    assert.equal(accessOperatorJson.data.access.targetGuildId, '999999999999999001');
    assert.equal(accessOperatorJson.data.guild.id, '999999999999999001');
    assert.equal(Object.hasOwn(accessOperatorJson.data.guild, 'permissions'), false);

    const accessOperatorInvalidGuild = await request({
      port: server.port,
      path: '/api/auth/access?guildId=invalid-guild-id',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(accessOperatorInvalidGuild.statusCode, 403);
    const accessOperatorInvalidGuildJson = parseJsonBody(accessOperatorInvalidGuild);
    assert.equal(accessOperatorInvalidGuildJson.ok, false);
    assert.equal(accessOperatorInvalidGuildJson.error, 'guild_access_denied');
    assert.equal(accessOperatorInvalidGuildJson.details.reasonCode, 'invalid_guild_id');

    const authPlanOperator = await request({
      port: server.port,
      path: '/api/auth/plan',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(authPlanOperator.statusCode, 200);
    const authPlanOperatorJson = parseJsonBody(authPlanOperator);
    assert.equal(authPlanOperatorJson.ok, true);
    assert.equal(authPlanOperatorJson.data.plan.status, 'resolved');
    assert.equal(authPlanOperatorJson.data.plan.tier, 'pro');
    assert.equal(authPlanOperatorJson.data.plan.source, 'config_manual_override');
    assert.equal(authPlanOperatorJson.data.capabilities.protected_dashboard.allowed, true);
    assert.equal(
      authPlanOperatorJson.data.capabilities.advanced_dashboard_preferences.allowed,
      true
    );
    assert.equal(
      authPlanOperatorJson.data.capabilities.future_reaction_rules_write.allowed,
      false
    );
    assert.equal(
      authPlanOperatorJson.data.capabilities.future_reaction_rules_write.reasonCode,
      'capability_not_active'
    );

    const dashboardContextOperator = await request({
      port: server.port,
      path: '/api/dashboard/context',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(dashboardContextOperator.statusCode, 200);
    const dashboardContextOperatorJson = parseJsonBody(dashboardContextOperator);
    assert.equal(dashboardContextOperatorJson.ok, true);
    assert.equal(dashboardContextOperatorJson.data.mode, 'authenticated_read_only');
    assert.equal(dashboardContextOperatorJson.data.access.allowed, true);
    assert.equal(
      dashboardContextOperatorJson.data.access.accessLevel,
      'authenticated_guild_operator'
    );
    assert.equal(dashboardContextOperatorJson.data.guild.id, '999999999999999001');
    assert.equal(dashboardContextOperatorJson.data.principal.id, '323456789012345678');
    assert.equal(
      dashboardContextOperatorJson.data.principalGuilds.summary.operatorGuildCount,
      1
    );
    assert.equal(dashboardContextOperatorJson.data.featureGate.entitlement.status, 'resolved');
    assert.equal(dashboardContextOperatorJson.data.featureGate.entitlement.tier, 'pro');

    const dashboardContextFeaturesOperator = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(dashboardContextFeaturesOperator.statusCode, 200);
    const dashboardContextFeaturesOperatorJson = parseJsonBody(
      dashboardContextFeaturesOperator
    );
    assert.equal(dashboardContextFeaturesOperatorJson.ok, true);
    assert.equal(
      dashboardContextFeaturesOperatorJson.data.mode,
      'authenticated_feature_gate_context'
    );
    assert.equal(dashboardContextFeaturesOperatorJson.data.plan.status, 'resolved');
    assert.equal(dashboardContextFeaturesOperatorJson.data.plan.tier, 'pro');
    assert.equal(
      dashboardContextFeaturesOperatorJson.data.capabilities.protected_dashboard.allowed,
      true
    );

    const protectedOverviewOperator = await request({
      port: server.port,
      path: '/api/dashboard/protected/overview',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedOverviewOperator.statusCode, 200);
    const protectedOverviewOperatorJson = parseJsonBody(protectedOverviewOperator);
    assert.equal(protectedOverviewOperatorJson.ok, true);
    assert.equal(protectedOverviewOperatorJson.data.contractVersion, 1);
    assert.equal(protectedOverviewOperatorJson.data.mode, 'protected_read_only_overview');
    assert.equal(protectedOverviewOperatorJson.data.access.allowed, true);
    assert.equal(
      protectedOverviewOperatorJson.data.access.accessLevel,
      'authenticated_guild_operator'
    );
    assert.equal(
      protectedOverviewOperatorJson.data.access.guildId,
      '999999999999999001'
    );
    assert.equal(protectedOverviewOperatorJson.data.guild.id, '999999999999999001');
    assert.equal(protectedOverviewOperatorJson.data.principal.id, '323456789012345678');
    assert.equal(
      protectedOverviewOperatorJson.data.features.privateVoice.enabled,
      false
    );
    assert.equal(
      protectedOverviewOperatorJson.data.resources.staticConfig.selectedGuildHasExplicitConfig,
      true
    );
    assert.equal(
      protectedOverviewOperatorJson.data.capabilities.mutableRoutesEnabled,
      true
    );
    assert.equal(protectedOverviewOperatorJson.data.plan.status, 'resolved');
    assert.equal(protectedOverviewOperatorJson.data.plan.tier, 'pro');
    assert.equal(
      protectedOverviewOperatorJson.data.featureGate.capabilitySummary.allowedCapabilities > 0,
      true
    );
    assert.equal(Object.hasOwn(protectedOverviewOperatorJson.data, 'session'), false);

    const protectedPreferencesInitial = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedPreferencesInitial.statusCode, 200);
    const protectedPreferencesInitialJson = parseJsonBody(protectedPreferencesInitial);
    assert.equal(protectedPreferencesInitialJson.ok, true);
    assert.equal(protectedPreferencesInitialJson.data.mode, 'protected_preferences');
    assert.equal(
      protectedPreferencesInitialJson.data.scope.guildId,
      '999999999999999001'
    );
    assert.equal(
      protectedPreferencesInitialJson.data.scope.actorId,
      '323456789012345678'
    );
    assert.equal(
      protectedPreferencesInitialJson.data.preferences.defaultView,
      'overview'
    );
    assert.equal(
      protectedPreferencesInitialJson.data.preferences.compactMode,
      false
    );
    assert.deepEqual(
      protectedPreferencesInitialJson.data.preferences.dismissedNoticeIds,
      []
    );
    assert.equal(protectedPreferencesInitialJson.data.updatedAt, null);

    const protectedPreferencesInvalidPayload = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: 'yes',
        },
      }),
    });
    assert.equal(protectedPreferencesInvalidPayload.statusCode, 400);
    const protectedPreferencesInvalidPayloadJson = parseJsonBody(
      protectedPreferencesInvalidPayload
    );
    assert.equal(protectedPreferencesInvalidPayloadJson.ok, false);
    assert.equal(protectedPreferencesInvalidPayloadJson.error, 'invalid_request_body');
    assert.equal(
      protectedPreferencesInvalidPayloadJson.details.reasonCode,
      'invalid_field_type'
    );

    const protectedPreferencesUnsupportedMedia = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    assert.equal(protectedPreferencesUnsupportedMedia.statusCode, 415);
    const protectedPreferencesUnsupportedMediaJson = parseJsonBody(
      protectedPreferencesUnsupportedMedia
    );
    assert.equal(protectedPreferencesUnsupportedMediaJson.ok, false);
    assert.equal(
      protectedPreferencesUnsupportedMediaJson.error,
      'unsupported_media_type'
    );

    const oversizedPreferenceBody = JSON.stringify({
      preferences: {
        dismissedNoticeIds: [`notice-${'x'.repeat(5000)}`],
      },
    });
    const protectedPreferencesTooLarge = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: oversizedPreferenceBody,
    });
    assert.equal(protectedPreferencesTooLarge.statusCode, 413);
    const protectedPreferencesTooLargeJson = parseJsonBody(protectedPreferencesTooLarge);
    assert.equal(protectedPreferencesTooLargeJson.ok, false);
    assert.equal(protectedPreferencesTooLargeJson.error, 'payload_too_large');

    const validPreferencesPayload = {
      preferences: {
        defaultView: 'resources',
        compactMode: true,
        dismissedNoticeIds: ['welcome-banner', 'legacy-tip'],
      },
    };
    const protectedPreferencesPutValid = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validPreferencesPayload),
    });
    assert.equal(protectedPreferencesPutValid.statusCode, 200);
    const protectedPreferencesPutValidJson = parseJsonBody(protectedPreferencesPutValid);
    assert.equal(protectedPreferencesPutValidJson.ok, true);
    assert.equal(
      protectedPreferencesPutValidJson.data.mutation.type,
      'dashboard_preferences_upsert'
    );
    assert.equal(protectedPreferencesPutValidJson.data.mutation.applied, true);
    assert.equal(protectedPreferencesPutValidJson.data.mutation.duplicate, false);
    assert.equal(
      protectedPreferencesPutValidJson.data.preferences.defaultView,
      'resources'
    );
    assert.equal(
      protectedPreferencesPutValidJson.data.preferences.compactMode,
      true
    );
    assert.deepEqual(
      protectedPreferencesPutValidJson.data.preferences.dismissedNoticeIds,
      ['welcome-banner', 'legacy-tip']
    );
    assert.match(
      String(protectedPreferencesPutValidJson.data.updatedAt || ''),
      /^\d{4}-\d{2}-\d{2}T/
    );

    const protectedPreferencesPutDuplicate = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validPreferencesPayload),
    });
    assert.equal(protectedPreferencesPutDuplicate.statusCode, 200);
    const protectedPreferencesPutDuplicateJson = parseJsonBody(
      protectedPreferencesPutDuplicate
    );
    assert.equal(protectedPreferencesPutDuplicateJson.ok, true);
    assert.equal(protectedPreferencesPutDuplicateJson.data.mutation.applied, false);
    assert.equal(protectedPreferencesPutDuplicateJson.data.mutation.duplicate, true);

    const protectedPreferencesReadBack = await request({
      port: server.port,
      path: '/api/dashboard/protected/preferences',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedPreferencesReadBack.statusCode, 200);
    const protectedPreferencesReadBackJson = parseJsonBody(protectedPreferencesReadBack);
    assert.equal(protectedPreferencesReadBackJson.ok, true);
    assert.equal(
      protectedPreferencesReadBackJson.data.preferences.defaultView,
      'resources'
    );
    assert.equal(
      protectedPreferencesReadBackJson.data.preferences.compactMode,
      true
    );
    assert.deepEqual(
      protectedPreferencesReadBackJson.data.preferences.dismissedNoticeIds,
      ['welcome-banner', 'legacy-tip']
    );
    assert.match(
      String(protectedPreferencesReadBackJson.data.updatedAt || ''),
      /^\d{4}-\d{2}-\d{2}T/
    );

    const protectedBotCommandSettingsInitial = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedBotCommandSettingsInitial.statusCode, 200);
    const protectedBotCommandSettingsInitialJson = parseJsonBody(
      protectedBotCommandSettingsInitial
    );
    assert.equal(protectedBotCommandSettingsInitialJson.ok, true);
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.mode,
      'protected_bot_command_settings'
    );
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.scope.guildId,
      '999999999999999001'
    );
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.scope.actorId,
      '323456789012345678'
    );
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.commands.durum.enabled,
      null
    );
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.commands.durum.detailMode,
      null
    );
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.effective.durum.enabled,
      true
    );
    assert.equal(
      protectedBotCommandSettingsInitialJson.data.effective.durum.detailMode,
      'legacy'
    );

    const protectedBotStatusSettingsInitial = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedBotStatusSettingsInitial.statusCode, 200);
    const protectedBotStatusSettingsInitialJson = parseJsonBody(
      protectedBotStatusSettingsInitial
    );
    assert.equal(protectedBotStatusSettingsInitialJson.ok, true);
    assert.equal(
      protectedBotStatusSettingsInitialJson.data.mode,
      'protected_bot_status_settings'
    );
    assert.equal(
      protectedBotStatusSettingsInitialJson.data.scope.guildId,
      '999999999999999001'
    );
    assert.equal(
      protectedBotStatusSettingsInitialJson.data.scope.actorId,
      '323456789012345678'
    );
    assert.equal(protectedBotStatusSettingsInitialJson.data.settings.detailMode, null);
    assert.equal(
      protectedBotStatusSettingsInitialJson.data.effective.detailMode,
      'legacy'
    );
    assert.equal(protectedBotStatusSettingsInitialJson.data.updatedAt, null);

    const protectedBotStatusSettingsInvalidPayload = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: true,
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsInvalidPayload.statusCode, 400);
    const protectedBotStatusSettingsInvalidPayloadJson = parseJsonBody(
      protectedBotStatusSettingsInvalidPayload
    );
    assert.equal(protectedBotStatusSettingsInvalidPayloadJson.ok, false);
    assert.equal(protectedBotStatusSettingsInvalidPayloadJson.error, 'invalid_request_body');
    assert.equal(
      protectedBotStatusSettingsInvalidPayloadJson.details.reasonCode,
      'invalid_field_type'
    );

    const protectedBotStatusSettingsUnsupportedMedia = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsUnsupportedMedia.statusCode, 415);
    const protectedBotStatusSettingsUnsupportedMediaJson = parseJsonBody(
      protectedBotStatusSettingsUnsupportedMedia
    );
    assert.equal(protectedBotStatusSettingsUnsupportedMediaJson.ok, false);
    assert.equal(
      protectedBotStatusSettingsUnsupportedMediaJson.error,
      'unsupported_media_type'
    );

    const oversizedBotStatusSettingsBody = JSON.stringify({
      settings: {
        detailMode: `compact-${'x'.repeat(4096)}`,
      },
    });
    const protectedBotStatusSettingsTooLarge = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: oversizedBotStatusSettingsBody,
    });
    assert.equal(protectedBotStatusSettingsTooLarge.statusCode, 413);
    const protectedBotStatusSettingsTooLargeJson = parseJsonBody(
      protectedBotStatusSettingsTooLarge
    );
    assert.equal(protectedBotStatusSettingsTooLargeJson.ok, false);
    assert.equal(protectedBotStatusSettingsTooLargeJson.error, 'payload_too_large');

    const protectedBotStatusSettingsPutValid = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutValid.statusCode, 200);
    const protectedBotStatusSettingsPutValidJson = parseJsonBody(
      protectedBotStatusSettingsPutValid
    );
    assert.equal(protectedBotStatusSettingsPutValidJson.ok, true);
    assert.equal(
      protectedBotStatusSettingsPutValidJson.data.mutation.type,
      'bot_status_settings_upsert'
    );
    assert.equal(protectedBotStatusSettingsPutValidJson.data.mutation.applied, true);
    assert.equal(protectedBotStatusSettingsPutValidJson.data.mutation.duplicate, false);
    assert.equal(protectedBotStatusSettingsPutValidJson.data.settings.detailMode, 'compact');
    assert.equal(
      protectedBotStatusSettingsPutValidJson.data.effective.detailMode,
      'compact'
    );
    assert.match(
      String(protectedBotStatusSettingsPutValidJson.data.updatedAt || ''),
      /^\d{4}-\d{2}-\d{2}T/
    );

    const protectedBotStatusSettingsPutDuplicate = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'compact',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutDuplicate.statusCode, 200);
    const protectedBotStatusSettingsPutDuplicateJson = parseJsonBody(
      protectedBotStatusSettingsPutDuplicate
    );
    assert.equal(protectedBotStatusSettingsPutDuplicateJson.ok, true);
    assert.equal(protectedBotStatusSettingsPutDuplicateJson.data.mutation.applied, false);
    assert.equal(protectedBotStatusSettingsPutDuplicateJson.data.mutation.duplicate, true);

    const protectedBotStatusSettingsPutLegacy = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          detailMode: 'legacy',
        },
      }),
    });
    assert.equal(protectedBotStatusSettingsPutLegacy.statusCode, 200);
    const protectedBotStatusSettingsPutLegacyJson = parseJsonBody(
      protectedBotStatusSettingsPutLegacy
    );
    assert.equal(protectedBotStatusSettingsPutLegacyJson.ok, true);
    assert.equal(protectedBotStatusSettingsPutLegacyJson.data.settings.detailMode, null);
    assert.equal(
      protectedBotStatusSettingsPutLegacyJson.data.effective.detailMode,
      'legacy'
    );

    const protectedBotStatusSettingsReadBack = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedBotStatusSettingsReadBack.statusCode, 200);
    const protectedBotStatusSettingsReadBackJson = parseJsonBody(
      protectedBotStatusSettingsReadBack
    );
    assert.equal(protectedBotStatusSettingsReadBackJson.ok, true);
    assert.equal(protectedBotStatusSettingsReadBackJson.data.settings.detailMode, null);
    assert.equal(
      protectedBotStatusSettingsReadBackJson.data.effective.detailMode,
      'legacy'
    );

    const protectedBotCommandSettingsInvalidCommand = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: {
          ping: {
            enabled: true,
          },
        },
      }),
    });
    assert.equal(protectedBotCommandSettingsInvalidCommand.statusCode, 400);
    const protectedBotCommandSettingsInvalidCommandJson = parseJsonBody(
      protectedBotCommandSettingsInvalidCommand
    );
    assert.equal(protectedBotCommandSettingsInvalidCommandJson.ok, false);
    assert.equal(protectedBotCommandSettingsInvalidCommandJson.error, 'invalid_request_body');
    assert.equal(
      protectedBotCommandSettingsInvalidCommandJson.details.reasonCode,
      'unknown_field'
    );
    assert.equal(
      protectedBotCommandSettingsInvalidCommandJson.details.field,
      'commands.ping'
    );

    const protectedBotCommandSettingsInvalidField = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: {
          durum: {
            unknownFlag: true,
          },
        },
      }),
    });
    assert.equal(protectedBotCommandSettingsInvalidField.statusCode, 400);
    const protectedBotCommandSettingsInvalidFieldJson = parseJsonBody(
      protectedBotCommandSettingsInvalidField
    );
    assert.equal(protectedBotCommandSettingsInvalidFieldJson.ok, false);
    assert.equal(protectedBotCommandSettingsInvalidFieldJson.error, 'invalid_request_body');
    assert.equal(
      protectedBotCommandSettingsInvalidFieldJson.details.reasonCode,
      'unknown_field'
    );
    assert.equal(
      protectedBotCommandSettingsInvalidFieldJson.details.field,
      'commands.durum.unknownFlag'
    );

    const protectedBotCommandSettingsInvalidDetailMode = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: {
          durum: {
            detailMode: 'wide',
          },
        },
      }),
    });
    assert.equal(protectedBotCommandSettingsInvalidDetailMode.statusCode, 400);
    const protectedBotCommandSettingsInvalidDetailModeJson = parseJsonBody(
      protectedBotCommandSettingsInvalidDetailMode
    );
    assert.equal(protectedBotCommandSettingsInvalidDetailModeJson.ok, false);
    assert.equal(
      protectedBotCommandSettingsInvalidDetailModeJson.error,
      'invalid_request_body'
    );
    assert.equal(
      protectedBotCommandSettingsInvalidDetailModeJson.details.reasonCode,
      'invalid_enum_value'
    );
    assert.equal(
      protectedBotCommandSettingsInvalidDetailModeJson.details.field,
      'commands.durum.detailMode'
    );

    const protectedBotCommandSettingsInvalidEnabledType = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: {
          durum: {
            enabled: 'false',
          },
        },
      }),
    });
    assert.equal(protectedBotCommandSettingsInvalidEnabledType.statusCode, 400);
    const protectedBotCommandSettingsInvalidEnabledTypeJson = parseJsonBody(
      protectedBotCommandSettingsInvalidEnabledType
    );
    assert.equal(protectedBotCommandSettingsInvalidEnabledTypeJson.ok, false);
    assert.equal(
      protectedBotCommandSettingsInvalidEnabledTypeJson.error,
      'invalid_request_body'
    );
    assert.equal(
      protectedBotCommandSettingsInvalidEnabledTypeJson.details.reasonCode,
      'invalid_field_type'
    );
    assert.equal(
      protectedBotCommandSettingsInvalidEnabledTypeJson.details.field,
      'commands.durum.enabled'
    );

    const protectedBotCommandSettingsPutEnabledFalse = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: {
          durum: {
            enabled: false,
          },
        },
      }),
    });
    assert.equal(protectedBotCommandSettingsPutEnabledFalse.statusCode, 200);
    const protectedBotCommandSettingsPutEnabledFalseJson = parseJsonBody(
      protectedBotCommandSettingsPutEnabledFalse
    );
    assert.equal(protectedBotCommandSettingsPutEnabledFalseJson.ok, true);
    assert.equal(
      protectedBotCommandSettingsPutEnabledFalseJson.data.mutation.type,
      'bot_command_settings_upsert'
    );
    assert.equal(
      protectedBotCommandSettingsPutEnabledFalseJson.data.commands.durum.enabled,
      false
    );
    assert.equal(
      protectedBotCommandSettingsPutEnabledFalseJson.data.effective.durum.enabled,
      false
    );
    assert.equal(
      protectedBotCommandSettingsPutEnabledFalseJson.data.effective.durum.detailMode,
      'legacy'
    );

    const protectedBotCommandSettingsPutCompact = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      method: 'PUT',
      headers: {
        Cookie: operatorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: {
          durum: {
            detailMode: 'compact',
          },
        },
      }),
    });
    assert.equal(protectedBotCommandSettingsPutCompact.statusCode, 200);
    const protectedBotCommandSettingsPutCompactJson = parseJsonBody(
      protectedBotCommandSettingsPutCompact
    );
    assert.equal(protectedBotCommandSettingsPutCompactJson.ok, true);
    assert.equal(
      protectedBotCommandSettingsPutCompactJson.data.mutation.type,
      'bot_command_settings_upsert'
    );
    assert.equal(
      protectedBotCommandSettingsPutCompactJson.data.commands.durum.detailMode,
      'compact'
    );
    assert.equal(
      protectedBotCommandSettingsPutCompactJson.data.effective.durum.detailMode,
      'compact'
    );
    assert.equal(
      protectedBotCommandSettingsPutCompactJson.data.effective.durum.enabled,
      false
    );

    const protectedBotCommandSettingsReadBack = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/commands',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedBotCommandSettingsReadBack.statusCode, 200);
    const protectedBotCommandSettingsReadBackJson = parseJsonBody(
      protectedBotCommandSettingsReadBack
    );
    assert.equal(protectedBotCommandSettingsReadBackJson.ok, true);
    assert.equal(
      protectedBotCommandSettingsReadBackJson.data.commands.durum.enabled,
      false
    );
    assert.equal(
      protectedBotCommandSettingsReadBackJson.data.commands.durum.detailMode,
      'compact'
    );
    assert.equal(
      protectedBotCommandSettingsReadBackJson.data.effective.durum.enabled,
      false
    );
    assert.equal(
      protectedBotCommandSettingsReadBackJson.data.effective.durum.detailMode,
      'compact'
    );

    const protectedBotStatusSettingsAfterCommandMutation = await request({
      port: server.port,
      path: '/api/dashboard/protected/bot-settings/status-command',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedBotStatusSettingsAfterCommandMutation.statusCode, 200);
    const protectedBotStatusSettingsAfterCommandMutationJson = parseJsonBody(
      protectedBotStatusSettingsAfterCommandMutation
    );
    assert.equal(protectedBotStatusSettingsAfterCommandMutationJson.ok, true);
    assert.equal(
      protectedBotStatusSettingsAfterCommandMutationJson.data.settings.detailMode,
      null
    );
    assert.equal(
      protectedBotStatusSettingsAfterCommandMutationJson.data.effective.detailMode,
      'compact'
    );

    const protectedGuildOperator = await request({
      port: server.port,
      path: '/api/control/private/guild-access',
      headers: {
        Cookie: operatorCookie,
      },
    });
    assert.equal(protectedGuildOperator.statusCode, 200);
    const protectedGuildOperatorJson = parseJsonBody(protectedGuildOperator);
    assert.equal(protectedGuildOperatorJson.ok, true);
    assert.equal(protectedGuildOperatorJson.data.mode, 'protected_placeholder');
    assert.equal(protectedGuildOperatorJson.data.guildScope.guildId, '999999999999999001');
    assert.equal(
      protectedGuildOperatorJson.data.guildScope.accessLevel,
      'authenticated_guild_operator'
    );

    const responseBodies = [
      accessUnauth.body,
      dashboardContextUnauth.body,
      dashboardContextFeaturesUnauth.body,
      protectedOverviewUnauth.body,
      protectedPreferencesGetUnauth.body,
      protectedPreferencesPutUnauth.body,
      protectedBotStatusSettingsGetUnauth.body,
      protectedBotStatusSettingsPutUnauth.body,
      authPlanUnauth.body,
      guildsNoAccess.body,
      accessNoAccess.body,
      dashboardContextNoAccess.body,
      dashboardContextFeaturesNoAccess.body,
      protectedOverviewNoAccess.body,
      protectedGuildNoAccess.body,
      protectedPreferencesGetNoAccess.body,
      protectedPreferencesPutNoAccess.body,
      protectedBotStatusSettingsGetNoAccess.body,
      protectedBotStatusSettingsPutNoAccess.body,
      authPlanNoAccess.body,
      accessOperator.body,
      accessOperatorInvalidGuild.body,
      authPlanOperator.body,
      dashboardContextOperator.body,
      dashboardContextFeaturesOperator.body,
      protectedOverviewOperator.body,
      protectedPreferencesInitial.body,
      protectedPreferencesInvalidPayload.body,
      protectedPreferencesUnsupportedMedia.body,
      protectedPreferencesTooLarge.body,
      protectedPreferencesPutValid.body,
      protectedPreferencesPutDuplicate.body,
      protectedPreferencesReadBack.body,
      protectedBotStatusSettingsInitial.body,
      protectedBotStatusSettingsInvalidPayload.body,
      protectedBotStatusSettingsUnsupportedMedia.body,
      protectedBotStatusSettingsTooLarge.body,
      protectedBotStatusSettingsPutValid.body,
      protectedBotStatusSettingsPutDuplicate.body,
      protectedBotStatusSettingsPutLegacy.body,
      protectedBotStatusSettingsReadBack.body,
      protectedGuildOperator.body,
    ].join('\n');
    assert.equal(responseBodies.includes('oauth-client-secret'), false);
    assert.equal(responseBodies.includes('token-no-access'), false);
    assert.equal(responseBodies.includes('token-operator'), false);
    assert.equal(responseBodies.includes('permissions'), false);
    assert.equal(responseBodies.includes('access_token'), false);

    assert.equal(mutationAuditEntries.length >= 7, true);
    const mutationTypes = mutationAuditEntries.map((entry) => entry?.mutationType);
    assert.equal(mutationTypes.includes('dashboard_preferences_upsert'), true);
    assert.equal(mutationTypes.includes('bot_status_settings_upsert'), true);
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'succeeded' &&
          entry?.mutationType === 'dashboard_preferences_upsert' &&
          entry?.actorId === '323456789012345678' &&
          entry?.scope?.guildId === '999999999999999001'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'failed' &&
          entry?.mutationType === 'dashboard_preferences_upsert' &&
          entry?.reasonCode === 'invalid_field_type'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'failed' &&
          entry?.mutationType === 'dashboard_preferences_upsert' &&
          entry?.reasonCode === 'body_too_large'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'rejected' &&
          entry?.mutationType === 'dashboard_preferences_upsert' &&
          entry?.reasonCode === 'guild_access_denied'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'rejected' &&
          entry?.mutationType === 'dashboard_preferences_upsert' &&
          entry?.reasonCode === 'unauthenticated'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'succeeded' &&
          entry?.mutationType === 'bot_status_settings_upsert' &&
          entry?.actorId === '323456789012345678' &&
          entry?.scope?.guildId === '999999999999999001'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'failed' &&
          entry?.mutationType === 'bot_status_settings_upsert' &&
          entry?.reasonCode === 'invalid_field_type'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'failed' &&
          entry?.mutationType === 'bot_status_settings_upsert' &&
          entry?.reasonCode === 'body_too_large'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'rejected' &&
          entry?.mutationType === 'bot_status_settings_upsert' &&
          entry?.reasonCode === 'guild_access_denied'
      ),
      true
    );
    assert.equal(
      mutationAuditEntries.some(
        (entry) =>
          entry?.result === 'rejected' &&
          entry?.mutationType === 'bot_status_settings_upsert' &&
          entry?.reasonCode === 'unauthenticated'
      ),
      true
    );
    const auditSerialized = JSON.stringify(mutationAuditEntries);
    assert.equal(auditSerialized.includes('oauth-client-secret'), false);
    assert.equal(auditSerialized.includes('token-no-access'), false);
    assert.equal(auditSerialized.includes('token-operator'), false);

    assert.equal(oauthFetchCalls.length, 6);
  } finally {
    await server.close();
  }
});

test('plan and capability endpoints fail closed when entitlement default is ambiguous', async () => {
  const mockFetch = async (url, options = {}) => {
    const normalizedUrl = String(url || '');

    if (normalizedUrl.endsWith('/api/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'token-operator',
          token_type: 'Bearer',
          scope: 'identify guilds',
        }),
      };
    }

    const authorization = String(options?.headers?.Authorization || '');
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (accessToken !== 'token-operator') {
      return {
        ok: false,
        status: 401,
        json: async () => ({}),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '523456789012345678',
          username: 'gate-user',
          global_name: 'Gate User',
          avatar: 'avatar-gate',
        }),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me/guilds')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: '999999999999999001',
            name: 'Primary Guild',
            icon: 'icon-primary',
            owner: false,
            permissions: '8',
          },
        ],
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'test',
        controlPlane: {
          enabled: true,
          auth: {
            enabled: true,
            configured: true,
            sessionSecret: '0123456789abcdef0123456789abcdef',
            sessionCookieName: 'cp_session',
            sessionTtlMs: 15 * 60 * 1000,
            oauthStateTtlMs: 10 * 60 * 1000,
            cookieSecure: false,
            cookieSameSite: 'Lax',
            postLoginRedirectUri: '/dashboard',
          },
          premium: {
            defaultPlan: 'unknown-plan',
            manualPlanOverrides: {},
          },
        },
        oauth: {
          singleGuildId: '999999999999999001',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          redirectUri: 'http://127.0.0.1/api/auth/callback',
        },
        discord: {
          token: '',
          targetGuildId: '999999999999999001',
          startupVoiceChannelId: '',
        },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => ['999999999999999001'],
      authFoundationOptions: {
        fetchImpl: mockFetch,
      },
    })
  );

  try {
    const login = await request({ port: server.port, path: '/api/auth/login' });
    assert.equal(login.statusCode, 302);
    const state = new URL(String(login.headers.location || '')).searchParams.get('state');
    assert.ok(state);

    const callback = await request({
      port: server.port,
      path: `/api/auth/callback?code=operator-user&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callback.statusCode, 302);
    const sessionCookie = toCookiePair(firstSetCookieHeader(callback.headers));
    assert.ok(sessionCookie);

    const authPlan = await request({
      port: server.port,
      path: '/api/auth/plan',
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(authPlan.statusCode, 200);
    const authPlanJson = parseJsonBody(authPlan);
    assert.equal(authPlanJson.ok, true);
    assert.equal(authPlanJson.data.plan.status, 'unresolved');
    assert.equal(authPlanJson.data.plan.tier, null);
    assert.equal(authPlanJson.data.plan.reasonCode, 'default_plan_invalid');
    assert.equal(
      Object.values(authPlanJson.data.capabilities).every(
        (entry) => entry.allowed === false
      ),
      true
    );
    assert.equal(
      Object.values(authPlanJson.data.capabilities).every(
        (entry) => entry.reasonCode === 'entitlement_unresolved'
      ),
      true
    );

    const dashboardContextFeatures = await request({
      port: server.port,
      path: '/api/dashboard/context/features',
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(dashboardContextFeatures.statusCode, 200);
    const dashboardContextFeaturesJson = parseJsonBody(dashboardContextFeatures);
    assert.equal(dashboardContextFeaturesJson.ok, true);
    assert.equal(dashboardContextFeaturesJson.data.plan.status, 'unresolved');
    assert.equal(dashboardContextFeaturesJson.data.plan.reasonCode, 'default_plan_invalid');
    assert.equal(
      Object.values(dashboardContextFeaturesJson.data.capabilities).every(
        (entry) => entry.allowed === false
      ),
      true
    );

    const responseBodies = [authPlan.body, dashboardContextFeatures.body].join('\n');
    assert.equal(responseBodies.includes('oauth-client-secret'), false);
    assert.equal(responseBodies.includes('token-operator'), false);
  } finally {
    await server.close();
  }
});

test('advanced dashboard preference field is plan-gated with fail-closed ambiguous entitlement behavior', async () => {
  const freeGuildId = '999999999999999001';
  const premiumGuildId = '999999999999999002';
  const ambiguousGuildId = '999999999999999003';
  const oauthFetchCalls = [];

  const mockFetch = async (url, options = {}) => {
    const normalizedUrl = String(url || '');
    const method = String(options?.method || 'GET').toUpperCase();
    oauthFetchCalls.push({
      url: normalizedUrl,
      method,
    });

    if (normalizedUrl.endsWith('/api/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'token-multi-guild',
          token_type: 'Bearer',
          scope: 'identify guilds',
        }),
      };
    }

    const authorization = String(options?.headers?.Authorization || '');
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (accessToken !== 'token-multi-guild') {
      return {
        ok: false,
        status: 401,
        json: async () => ({}),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '623456789012345678',
          username: 'multi-guild-user',
          global_name: 'Multi Guild User',
          avatar: 'avatar-multi',
        }),
      };
    }

    if (normalizedUrl.endsWith('/api/users/@me/guilds')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: freeGuildId,
            name: 'Free Guild',
            icon: 'icon-free',
            owner: false,
            permissions: '8',
          },
          {
            id: premiumGuildId,
            name: 'Premium Guild',
            icon: 'icon-premium',
            owner: false,
            permissions: '8',
          },
          {
            id: ambiguousGuildId,
            name: 'Ambiguous Guild',
            icon: 'icon-ambiguous',
            owner: false,
            permissions: '8',
          },
        ],
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };

  const guildPlanRepository = {
    async getGuildPlanRecord({ guildId = null } = {}) {
      if (String(guildId || '') !== ambiguousGuildId) return null;
      return {
        guildId: ambiguousGuildId,
        planTier: 'unknown-plan-tier',
        source: 'repository',
        updatedAt: '2026-04-11T00:00:00.000Z',
      };
    },
  };

  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'test',
        controlPlane: {
          enabled: true,
          auth: {
            enabled: true,
            configured: true,
            sessionSecret: 'feedfacefeedfacefeedfacefeedface',
            sessionCookieName: 'cp_session',
            sessionTtlMs: 15 * 60 * 1000,
            oauthStateTtlMs: 10 * 60 * 1000,
            cookieSecure: false,
            cookieSameSite: 'Lax',
            postLoginRedirectUri: '/dashboard',
          },
          premium: {
            defaultPlan: 'free',
            manualPlanOverrides: {
              [premiumGuildId]: 'pro',
            },
          },
        },
        oauth: {
          singleGuildId: '',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          redirectUri: 'http://127.0.0.1/api/auth/callback',
        },
        discord: {
          token: '',
          targetGuildId: '',
          startupVoiceChannelId: '',
        },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => [freeGuildId, premiumGuildId, ambiguousGuildId],
      guildPlanRepository,
      authFoundationOptions: {
        fetchImpl: mockFetch,
      },
    })
  );

  try {
    const login = await request({ port: server.port, path: '/api/auth/login' });
    assert.equal(login.statusCode, 302);
    const state = new URL(String(login.headers.location || '')).searchParams.get('state');
    assert.ok(state);

    const callback = await request({
      port: server.port,
      path: `/api/auth/callback?code=multi-guild-user&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callback.statusCode, 302);
    const sessionCookie = toCookiePair(firstSetCookieHeader(callback.headers));
    assert.ok(sessionCookie);

    const freePreferencesInitial = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${freeGuildId}`,
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(freePreferencesInitial.statusCode, 200);
    const freePreferencesInitialJson = parseJsonBody(freePreferencesInitial);
    assert.equal(freePreferencesInitialJson.ok, true);
    assert.equal(freePreferencesInitialJson.data.plan.status, 'resolved');
    assert.equal(freePreferencesInitialJson.data.plan.tier, 'free');
    assert.equal(
      freePreferencesInitialJson.data.capabilities.advancedDashboardPreferences.available,
      false
    );
    assert.equal(freePreferencesInitialJson.data.preferences.advancedLayoutMode, null);

    const freeBasicWrite = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${freeGuildId}`,
      method: 'PUT',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          defaultView: 'guild',
          compactMode: true,
          dismissedNoticeIds: ['notice-free'],
        },
      }),
    });
    assert.equal(freeBasicWrite.statusCode, 200);
    const freeBasicWriteJson = parseJsonBody(freeBasicWrite);
    assert.equal(freeBasicWriteJson.ok, true);
    assert.equal(freeBasicWriteJson.data.plan.tier, 'free');
    assert.equal(freeBasicWriteJson.data.preferences.defaultView, 'guild');
    assert.equal(freeBasicWriteJson.data.preferences.compactMode, true);
    assert.deepEqual(freeBasicWriteJson.data.preferences.dismissedNoticeIds, ['notice-free']);
    assert.equal(freeBasicWriteJson.data.preferences.advancedLayoutMode, null);

    const freeAdvancedWrite = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${freeGuildId}`,
      method: 'PUT',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          advancedLayoutMode: 'focus',
        },
      }),
    });
    assert.equal(freeAdvancedWrite.statusCode, 403);
    const freeAdvancedWriteJson = parseJsonBody(freeAdvancedWrite);
    assert.equal(freeAdvancedWriteJson.ok, false);
    assert.equal(freeAdvancedWriteJson.error, 'capability_denied');
    assert.equal(
      freeAdvancedWriteJson.details.reasonCode,
      'advanced_dashboard_preferences_plan_required'
    );
    assert.equal(
      freeAdvancedWriteJson.details.field,
      'preferences.advancedLayoutMode'
    );

    const premiumAdvancedWrite = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${premiumGuildId}`,
      method: 'PUT',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          advancedLayoutMode: 'split',
        },
      }),
    });
    assert.equal(premiumAdvancedWrite.statusCode, 200);
    const premiumAdvancedWriteJson = parseJsonBody(premiumAdvancedWrite);
    assert.equal(premiumAdvancedWriteJson.ok, true);
    assert.equal(premiumAdvancedWriteJson.data.plan.status, 'resolved');
    assert.equal(premiumAdvancedWriteJson.data.plan.tier, 'pro');
    assert.equal(
      premiumAdvancedWriteJson.data.capabilities.advancedDashboardPreferences.available,
      true
    );
    assert.equal(
      premiumAdvancedWriteJson.data.preferences.advancedLayoutMode,
      'split'
    );

    const premiumReadBack = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${premiumGuildId}`,
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(premiumReadBack.statusCode, 200);
    const premiumReadBackJson = parseJsonBody(premiumReadBack);
    assert.equal(premiumReadBackJson.ok, true);
    assert.equal(premiumReadBackJson.data.plan.tier, 'pro');
    assert.equal(
      premiumReadBackJson.data.preferences.advancedLayoutMode,
      'split'
    );

    const ambiguousAdvancedWrite = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${ambiguousGuildId}`,
      method: 'PUT',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          advancedLayoutMode: 'focus',
        },
      }),
    });
    assert.equal(ambiguousAdvancedWrite.statusCode, 403);
    const ambiguousAdvancedWriteJson = parseJsonBody(ambiguousAdvancedWrite);
    assert.equal(ambiguousAdvancedWriteJson.ok, false);
    assert.equal(ambiguousAdvancedWriteJson.error, 'capability_denied');
    assert.equal(
      ambiguousAdvancedWriteJson.details.reasonCode,
      'advanced_dashboard_preferences_unavailable'
    );

    const ambiguousBasicWrite = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${ambiguousGuildId}`,
      method: 'PUT',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          compactMode: true,
        },
      }),
    });
    assert.equal(ambiguousBasicWrite.statusCode, 200);
    const ambiguousBasicWriteJson = parseJsonBody(ambiguousBasicWrite);
    assert.equal(ambiguousBasicWriteJson.ok, true);
    assert.equal(ambiguousBasicWriteJson.data.plan.status, 'unresolved');
    assert.equal(ambiguousBasicWriteJson.data.plan.tier, null);
    assert.equal(ambiguousBasicWriteJson.data.plan.reasonCode, 'repository_plan_invalid');
    assert.equal(ambiguousBasicWriteJson.data.preferences.compactMode, true);
    assert.equal(ambiguousBasicWriteJson.data.preferences.advancedLayoutMode, null);

    const ambiguousReadBack = await request({
      port: server.port,
      path: `/api/dashboard/protected/preferences?guildId=${ambiguousGuildId}`,
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(ambiguousReadBack.statusCode, 200);
    const ambiguousReadBackJson = parseJsonBody(ambiguousReadBack);
    assert.equal(ambiguousReadBackJson.ok, true);
    assert.equal(ambiguousReadBackJson.data.plan.status, 'unresolved');
    assert.equal(ambiguousReadBackJson.data.preferences.compactMode, true);
    assert.equal(ambiguousReadBackJson.data.preferences.advancedLayoutMode, null);

    const freeFeatureContext = await request({
      port: server.port,
      path: `/api/dashboard/context/features?guildId=${freeGuildId}`,
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(freeFeatureContext.statusCode, 200);
    const freeFeatureContextJson = parseJsonBody(freeFeatureContext);
    assert.equal(freeFeatureContextJson.ok, true);
    assert.equal(freeFeatureContextJson.data.plan.tier, 'free');
    assert.equal(
      freeFeatureContextJson.data.capabilities.advanced_dashboard_preferences.allowed,
      false
    );

    const premiumFeatureContext = await request({
      port: server.port,
      path: `/api/dashboard/context/features?guildId=${premiumGuildId}`,
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(premiumFeatureContext.statusCode, 200);
    const premiumFeatureContextJson = parseJsonBody(premiumFeatureContext);
    assert.equal(premiumFeatureContextJson.ok, true);
    assert.equal(premiumFeatureContextJson.data.plan.tier, 'pro');
    assert.equal(
      premiumFeatureContextJson.data.capabilities.advanced_dashboard_preferences.allowed,
      true
    );

    const responseBodies = [
      freePreferencesInitial.body,
      freeBasicWrite.body,
      freeAdvancedWrite.body,
      premiumAdvancedWrite.body,
      premiumReadBack.body,
      ambiguousAdvancedWrite.body,
      ambiguousBasicWrite.body,
      ambiguousReadBack.body,
      freeFeatureContext.body,
      premiumFeatureContext.body,
    ].join('\n');
    assert.equal(responseBodies.includes('oauth-client-secret'), false);
    assert.equal(responseBodies.includes('token-multi-guild'), false);
    assert.equal(responseBodies.includes('access_token'), false);

    assert.equal(oauthFetchCalls.length, 3);
    assert.equal(oauthFetchCalls[0].method, 'POST');
    assert.match(oauthFetchCalls[0].url, /\/api\/oauth2\/token$/);
    assert.equal(oauthFetchCalls[1].method, 'GET');
    assert.match(oauthFetchCalls[1].url, /\/api\/users\/@me$/);
    assert.equal(oauthFetchCalls[2].method, 'GET');
    assert.match(oauthFetchCalls[2].url, /\/api\/users\/@me\/guilds$/);
  } finally {
    await server.close();
  }
});

test('dashboard endpoints handle missing guild context with bounded unscoped responses', async () => {
  const server = await startServer(
    createControlPlaneRequestHandler({
      enabled: true,
      config: {
        nodeEnv: 'test',
        controlPlane: { enabled: true },
        discord: { token: '', targetGuildId: '', startupVoiceChannelId: '' },
        oauth: { singleGuildId: '' },
        db: {},
        cache: {},
        rateLimit: {},
      },
      getConfiguredStaticGuildIdsFn: () => [],
    })
  );

  try {
    const overview = await request({ port: server.port, path: '/api/dashboard/overview' });
    const guild = await request({ port: server.port, path: '/api/dashboard/guild' });

    assert.equal(overview.statusCode, 200);
    const overviewJson = parseJsonBody(overview);
    assert.equal(overviewJson.ok, true);
    assert.equal(overviewJson.data.guildScope.mode, 'unscoped');
    assert.equal(overviewJson.data.guildScope.guildId, null);
    assert.equal(overviewJson.data.guildScope.valid, true);

    assert.equal(guild.statusCode, 200);
    const guildJson = parseJsonBody(guild);
    assert.equal(guildJson.ok, true);
    assert.equal(guildJson.data.guildScope.mode, 'unscoped');
    assert.equal(guildJson.data.guild, null);
  } finally {
    await server.close();
  }
});
