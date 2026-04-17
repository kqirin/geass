import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DASHBOARD_VIEW_STATES,
  bootstrapDashboardAuthSession,
  deriveViewStateFromError,
  loadProtectedDashboardSnapshot,
  parseDismissedNoticeIdsInput,
} from '../src/hooks/useDashboardData.js';
import {
  normalizeApiError,
  putCommandSettings,
  putDashboardPreferences,
  putMessageAutomationSettings,
} from '../src/lib/apiClient.js';

function createHttpError(status, error, reasonCode = null) {
  return {
    response: {
      status,
      data: {
        ok: false,
        error,
        details: reasonCode ? { reasonCode } : null,
      },
    },
  };
}

function createMockClient({
  getMap = {},
  putMap = {},
  postMap = {},
} = {}) {
  const calls = [];

  function resolveKey(url, config = {}) {
    const guildId = String(config?.params?.guildId || '').trim();
    return guildId ? `${url}?guildId=${guildId}` : url;
  }

  function resolveFromMap(map, method, url, payload = null, config = {}) {
    const key = resolveKey(url, config);
    calls.push({ method, url, key, payload, config });
    const resolved = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : map[url];

    if (resolved === undefined) {
      throw new Error(`No mock configured for ${method} ${key}`);
    }
    if (resolved && typeof resolved === 'object' && resolved.__error) {
      throw resolved.__error;
    }
    if (typeof resolved === 'function') {
      return { data: resolved({ method, url, key, payload, config }) };
    }
    return { data: resolved };
  }

  return {
    calls,
    client: {
      get(url, config = {}) {
        return Promise.resolve(resolveFromMap(getMap, 'GET', url, null, config));
      },
      put(url, payload = {}, config = {}) {
        return Promise.resolve(resolveFromMap(putMap, 'PUT', url, payload, config));
      },
      post(url, payload = {}, config = {}) {
        return Promise.resolve(resolveFromMap(postMap, 'POST', url, payload, config));
      },
    },
  };
}

test('auth unavailable mode fails closed without me/guild requests', async () => {
  const { client, calls } = createMockClient({
    getMap: {
      '/api/auth/status': {
        ok: true,
        data: {
          auth: {
            enabled: true,
            configured: false,
            authenticated: false,
          },
        },
      },
    },
  });

  const snapshot = await bootstrapDashboardAuthSession({ client });

  assert.equal(snapshot.viewState, DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE);
  assert.equal(snapshot.authenticated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/auth/status');
});

test('unauthenticated auth status maps to unauthenticated dashboard state', async () => {
  const { client } = createMockClient({
    getMap: {
      '/api/auth/status': {
        ok: true,
        data: {
          auth: {
            enabled: true,
            configured: true,
            authenticated: false,
          },
        },
      },
    },
  });

  const snapshot = await bootstrapDashboardAuthSession({ client });

  assert.equal(snapshot.viewState, DASHBOARD_VIEW_STATES.UNAUTHENTICATED);
  assert.equal(snapshot.authenticated, false);
});

test('authenticated bootstrap resolves guild selection and principal summary', async () => {
  const { client } = createMockClient({
    getMap: {
      '/api/auth/status': {
        ok: true,
        data: {
          auth: {
            enabled: true,
            configured: true,
            authenticated: true,
          },
        },
      },
      '/api/auth/me': {
        ok: true,
        data: {
          principal: {
            id: 'u-1',
            username: 'user',
            displayName: 'User',
          },
          session: {
            id: 's-1',
          },
        },
      },
      '/api/auth/guilds': {
        ok: true,
        data: {
          guilds: [
            { id: 'g-free', name: 'Free Guild', isOperator: false },
            { id: 'g-pro', name: 'Pro Guild', isOperator: true },
          ],
        },
      },
    },
  });

  const snapshot = await bootstrapDashboardAuthSession({ client });

  assert.equal(snapshot.viewState, DASHBOARD_VIEW_STATES.LOADING);
  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.guildId, 'g-pro');
  assert.equal(snapshot.principal.id, 'u-1');
  assert.equal(snapshot.session.id, 's-1');
});

test('authenticated bootstrap supports top-level authenticated auth-status shape', async () => {
  const { client } = createMockClient({
    getMap: {
      '/api/auth/status': {
        ok: true,
        data: {
          authenticated: true,
          principal: {
            id: 'u-top',
            username: 'top-user',
            displayName: 'Top User',
          },
          session: {
            id: 's-top',
          },
        },
      },
      '/api/auth/me': {
        ok: true,
        data: {
          principal: {
            id: 'u-top',
            username: 'top-user',
            displayName: 'Top User',
          },
          session: {
            id: 's-top',
          },
        },
      },
      '/api/auth/guilds': {
        ok: true,
        data: {
          guilds: [{ id: 'g-top', name: 'Top Guild', isOperator: true }],
        },
      },
    },
  });

  const snapshot = await bootstrapDashboardAuthSession({ client });

  assert.equal(snapshot.viewState, DASHBOARD_VIEW_STATES.LOADING);
  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.guildId, 'g-top');
  assert.equal(snapshot.principal.id, 'u-top');
  assert.equal(snapshot.session.id, 's-top');
});

test('protected snapshot loads overview, plan, capabilities, preferences, and command settings', async () => {
  const { client, calls } = createMockClient({
    getMap: {
      '/api/auth/plan?guildId=g-pro': {
        ok: true,
        data: {
          plan: { status: 'resolved', tier: 'pro', source: 'repository', reasonCode: null },
          access: { targetGuildId: 'g-pro' },
        },
      },
      '/api/dashboard/context/features?guildId=g-pro': {
        ok: true,
        data: {
          capabilities: {
            advanced_dashboard_preferences: { allowed: true },
          },
          capabilitySummary: {
            totalCapabilities: 4,
            allowedCapabilities: 3,
            deniedCapabilities: 1,
            activeCapabilities: 3,
          },
        },
      },
      '/api/dashboard/protected/overview?guildId=g-pro': {
        ok: true,
        data: {
          mode: 'protected_read_only_overview',
          runtime: {
            startupPhase: 'ready',
            discordGatewayReady: true,
          },
        },
      },
      '/api/dashboard/protected/preferences?guildId=g-pro': {
        ok: true,
        data: {
          preferences: {
            defaultView: 'overview',
            compactMode: true,
            dismissedNoticeIds: ['banner'],
            advancedLayoutMode: 'split',
          },
          capabilities: {
            advancedDashboardPreferences: { available: true },
          },
        },
      },
      '/api/dashboard/protected/bot-settings/commands?guildId=g-pro': {
        ok: true,
        data: {
          commands: {
            durum: {
              enabled: false,
              detailMode: 'compact',
            },
          },
          effective: {
            durum: {
              enabled: false,
              detailMode: 'compact',
            },
          },
        },
      },
      '/api/dashboard/protected/message-automation?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          settings: {
            welcome: {
              enabled: false,
              channelId: null,
              plainMessage: 'Hoş geldin {user_mention}',
              embed: {
                enabled: true,
                title: 'Yeni Üye',
                description: 'Sunucumuza hoş geldin, {user_mention}!',
                color: '#7c3aed',
                imageUrl: null,
                thumbnailMode: 'user_avatar',
                footer: '{server_name}',
              },
            },
            goodbye: {
              enabled: false,
              channelId: null,
              plainMessage: 'Güle güle {user_name}',
              embed: {
                enabled: true,
                title: 'Üye Ayrıldı',
                description: '{user_name} sunucudan ayrıldı.',
                color: '#ef4444',
                imageUrl: null,
                thumbnailMode: 'user_avatar',
                footer: '{server_name}',
              },
            },
            boost: {
              enabled: false,
              channelId: null,
              plainMessage: '{user_mention} sunucuyu boostladı!',
              embed: {
                enabled: true,
                title: 'Sunucu Boostlandı',
                description: 'Teşekkürler, {user_mention}!',
                color: '#cc97ff',
                imageUrl: null,
                thumbnailMode: 'user_avatar',
                footer: '{server_name}',
              },
            },
          },
          updatedAt: '2026-04-17T10:30:00.000Z',
        },
      },
      '/api/dashboard/protected/setup-readiness?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          summary: {
            status: 'warning',
            score: 67,
            totalChecks: 6,
            passedChecks: 3,
            warningChecks: 2,
            failedChecks: 1,
          },
          sections: [
            {
              id: 'static-config',
              title: 'Statik Yapilandirma',
              status: 'warning',
              checks: [],
            },
          ],
          issues: [
            {
              severity: 'warning',
              reasonCode: 'static_config_defaults_in_use',
              title: 'Ayar bulunamadi',
              description: 'Bu sunucu defaults ayarlari ile calisiyor.',
              targetType: 'config',
              targetKey: 'static_server_config.defaults',
            },
          ],
        },
      },
      '/api/dashboard/protected/logs/moderation?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          available: true,
          items: [
            {
              id: '100',
              action: 'warn',
              targetUserId: 'u-1',
              moderatorUserId: 'mod-1',
              reason: 'Test',
              createdAt: '2026-04-16T10:00:00.000Z',
              expiresAt: null,
              status: 'applied',
            },
          ],
          pagination: {
            limit: 25,
            nextCursor: null,
          },
          reasonCode: null,
        },
      },
      '/api/dashboard/protected/logs/commands?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          available: false,
          items: [],
          pagination: {
            limit: 25,
            nextCursor: null,
          },
          reasonCode: 'command_logs_not_available',
          explanation: 'Bu log turu icin kayit kaynagi henuz aktif degil.',
        },
      },
      '/api/dashboard/protected/logs/system?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          available: false,
          items: [],
          pagination: {
            limit: 25,
            nextCursor: null,
          },
          reasonCode: 'system_logs_not_available',
          explanation: 'Bu log turu icin kayit kaynagi henuz aktif degil.',
        },
      },
    },
  });

  const snapshot = await loadProtectedDashboardSnapshot({ guildId: 'g-pro', client });

  assert.equal(snapshot.guildId, 'g-pro');
  assert.equal(snapshot.planPayload.plan.tier, 'pro');
  assert.equal(
    snapshot.featuresPayload.capabilities.advanced_dashboard_preferences.allowed,
    true
  );
  assert.equal(snapshot.overviewPayload.mode, 'protected_read_only_overview');
  assert.equal(snapshot.preferencesPayload.preferences.advancedLayoutMode, 'split');
  assert.equal(snapshot.commandSettingsPayload.effective.durum.detailMode, 'compact');
  assert.equal(snapshot.commandSettingsPayload.effective.durum.enabled, false);
  assert.equal(snapshot.messageAutomationPayload.settings.welcome.enabled, false);
  assert.equal(snapshot.messageAutomationPayload.settings.boost.embed.color, '#cc97ff');
  assert.equal(snapshot.messageAutomationError, null);
  assert.equal(snapshot.setupReadinessPayload.summary.status, 'warning');
  assert.equal(snapshot.setupReadinessPayload.summary.score, 67);
  assert.equal(snapshot.setupReadinessError, null);
  assert.equal(snapshot.moderationLogsPayload.available, true);
  assert.equal(snapshot.commandLogsPayload.reasonCode, 'command_logs_not_available');
  assert.equal(snapshot.systemLogsPayload.reasonCode, 'system_logs_not_available');
  assert.equal(
    calls.filter((entry) => entry.method === 'GET').length,
    10
  );
});

test('protected snapshot keeps core dashboard data when setup-readiness request fails', async () => {
  const { client } = createMockClient({
    getMap: {
      '/api/auth/plan?guildId=g-pro': {
        ok: true,
        data: {
          plan: { status: 'resolved', tier: 'pro', source: 'repository', reasonCode: null },
          access: { targetGuildId: 'g-pro' },
        },
      },
      '/api/dashboard/context/features?guildId=g-pro': {
        ok: true,
        data: {
          capabilities: {
            advanced_dashboard_preferences: { allowed: true },
          },
          capabilitySummary: {
            totalCapabilities: 4,
            allowedCapabilities: 3,
            deniedCapabilities: 1,
            activeCapabilities: 3,
          },
        },
      },
      '/api/dashboard/protected/overview?guildId=g-pro': {
        ok: true,
        data: {
          mode: 'protected_read_only_overview',
        },
      },
      '/api/dashboard/protected/preferences?guildId=g-pro': {
        ok: true,
        data: {
          preferences: {
            defaultView: 'overview',
            compactMode: false,
            dismissedNoticeIds: [],
            advancedLayoutMode: null,
          },
          capabilities: {
            advancedDashboardPreferences: { available: true },
          },
        },
      },
      '/api/dashboard/protected/bot-settings/commands?guildId=g-pro': {
        ok: true,
        data: {
          commands: {
            durum: {
              enabled: true,
              detailMode: 'legacy',
            },
          },
          effective: {
            durum: {
              enabled: true,
              detailMode: 'legacy',
            },
          },
        },
      },
      '/api/dashboard/protected/message-automation?guildId=g-pro': {
        __error: createHttpError(500, 'internal_error', 'message_automation_unavailable'),
      },
      '/api/dashboard/protected/setup-readiness?guildId=g-pro': {
        __error: createHttpError(500, 'internal_error', 'setup_readiness_unavailable'),
      },
      '/api/dashboard/protected/logs/moderation?guildId=g-pro': {
        __error: createHttpError(500, 'internal_error', 'logs_unavailable'),
      },
      '/api/dashboard/protected/logs/commands?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          available: false,
          items: [],
          pagination: {
            limit: 25,
            nextCursor: null,
          },
          reasonCode: 'command_logs_not_available',
        },
      },
      '/api/dashboard/protected/logs/system?guildId=g-pro': {
        ok: true,
        data: {
          contractVersion: 1,
          guildId: 'g-pro',
          available: false,
          items: [],
          pagination: {
            limit: 25,
            nextCursor: null,
          },
          reasonCode: 'system_logs_not_available',
        },
      },
    },
  });

  const snapshot = await loadProtectedDashboardSnapshot({ guildId: 'g-pro', client });

  assert.equal(snapshot.guildId, 'g-pro');
  assert.equal(snapshot.overviewPayload.mode, 'protected_read_only_overview');
  assert.equal(snapshot.commandSettingsPayload.effective.durum.enabled, true);
  assert.equal(snapshot.messageAutomationPayload, null);
  assert.equal(typeof snapshot.messageAutomationError, 'object');
  assert.equal(snapshot.messageAutomationError.code, 'internal_error');
  assert.equal(snapshot.setupReadinessPayload, null);
  assert.equal(typeof snapshot.setupReadinessError, 'object');
  assert.equal(snapshot.setupReadinessError.code, 'internal_error');
  assert.equal(snapshot.moderationLogsPayload, null);
  assert.equal(typeof snapshot.moderationLogsError, 'object');
  assert.equal(snapshot.moderationLogsError.code, 'internal_error');
});

test('no-access and auth-unavailable errors map to safe dashboard states', async () => {
  const noAccess = normalizeApiError(
    createHttpError(403, 'guild_access_denied', 'guild_membership_missing')
  );
  const unavailable = normalizeApiError(
    createHttpError(503, 'auth_not_configured', 'oauth_config_missing')
  );

  assert.equal(deriveViewStateFromError(noAccess), DASHBOARD_VIEW_STATES.NO_ACCESS);
  assert.equal(
    deriveViewStateFromError(unavailable),
    DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE
  );
});

test('preferences write sends protected payload and guild scope', async () => {
  const { client, calls } = createMockClient({
    putMap: {
      '/api/dashboard/protected/preferences?guildId=g-pro': ({ payload }) => {
        assert.equal(payload.preferences.defaultView, 'resources');
        assert.equal(payload.preferences.compactMode, true);
        assert.deepEqual(payload.preferences.dismissedNoticeIds, ['notice-a']);
        assert.equal(payload.preferences.advancedLayoutMode, 'focus');
        return {
          ok: true,
          data: {
            preferences: payload.preferences,
            mutation: { applied: true },
          },
        };
      },
    },
  });

  const response = await putDashboardPreferences({
    guildId: 'g-pro',
    preferences: {
      defaultView: 'resources',
      compactMode: true,
      dismissedNoticeIds: ['notice-a'],
      advancedLayoutMode: 'focus',
    },
    client,
  });

  assert.equal(response.mutation.applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, '/api/dashboard/protected/preferences?guildId=g-pro');
});

test('command settings write sends durum enabled/detail mode mutation', async () => {
  const { client, calls } = createMockClient({
    putMap: {
      '/api/dashboard/protected/bot-settings/commands?guildId=g-pro': ({ payload }) => {
        assert.equal(payload.commands.durum.enabled, false);
        assert.equal(payload.commands.durum.detailMode, 'compact');
        return {
          ok: true,
          data: {
            commands: {
              durum: {
                enabled: false,
                detailMode: 'compact',
              },
            },
            effective: {
              durum: {
                enabled: false,
                detailMode: 'compact',
              },
            },
            mutation: { applied: true },
          },
        };
      },
    },
  });

  const response = await putCommandSettings({
    guildId: 'g-pro',
    commands: {
      durum: {
        enabled: false,
        detailMode: 'compact',
      },
    },
    client,
  });

  assert.equal(response.effective.durum.detailMode, 'compact');
  assert.equal(response.effective.durum.enabled, false);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].key,
    '/api/dashboard/protected/bot-settings/commands?guildId=g-pro'
  );
});

test('message automation write sends welcome module payload', async () => {
  const { client, calls } = createMockClient({
    putMap: {
      '/api/dashboard/protected/message-automation?guildId=g-pro': ({ payload }) => {
        assert.equal(payload.settings.welcome.enabled, true);
        assert.equal(payload.settings.welcome.channelId, '123456789012345678');
        assert.equal(payload.settings.welcome.embed.title, 'Yeni Üye');
        return {
          ok: true,
          data: {
            contractVersion: 1,
            guildId: 'g-pro',
            settings: payload.settings,
            mutation: { applied: true },
          },
        };
      },
    },
  });

  const response = await putMessageAutomationSettings({
    guildId: 'g-pro',
    settings: {
      welcome: {
        enabled: true,
        channelId: '123456789012345678',
        plainMessage: 'Hoş geldin {user_mention}',
        embed: {
          enabled: true,
          title: 'Yeni Üye',
          description: 'Sunucumuza hoş geldin, {user_mention}!',
          color: '#7c3aed',
          imageUrl: null,
          thumbnailMode: 'user_avatar',
          footer: '{server_name}',
        },
      },
    },
    client,
  });

  assert.equal(response.guildId, 'g-pro');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].key,
    '/api/dashboard/protected/message-automation?guildId=g-pro'
  );
});

test('message automation write sends goodbye module payload', async () => {
  const { client, calls } = createMockClient({
    putMap: {
      '/api/dashboard/protected/message-automation?guildId=g-pro': ({ payload }) => {
        assert.equal(payload.settings.goodbye.plainMessage, 'Güle güle {user_name}');
        assert.equal(payload.settings.goodbye.embed.title, 'Üye Ayrıldı');
        return {
          ok: true,
          data: {
            contractVersion: 1,
            guildId: 'g-pro',
            settings: payload.settings,
            mutation: { applied: true },
          },
        };
      },
    },
  });

  const response = await putMessageAutomationSettings({
    guildId: 'g-pro',
    settings: {
      goodbye: {
        enabled: false,
        channelId: null,
        plainMessage: 'Güle güle {user_name}',
        embed: {
          enabled: true,
          title: 'Üye Ayrıldı',
          description: '{user_name} sunucudan ayrıldı.',
          color: '#ef4444',
          imageUrl: null,
          thumbnailMode: 'user_avatar',
          footer: '{server_name}',
        },
      },
    },
    client,
  });

  assert.equal(response.guildId, 'g-pro');
  assert.equal(calls.length, 1);
});

test('message automation write sends boost module payload', async () => {
  const { client, calls } = createMockClient({
    putMap: {
      '/api/dashboard/protected/message-automation?guildId=g-pro': ({ payload }) => {
        assert.equal(payload.settings.boost.plainMessage, '{user_mention} sunucuyu boostladı!');
        assert.equal(payload.settings.boost.embed.imageUrl, 'https://example.com/boost.png');
        return {
          ok: true,
          data: {
            contractVersion: 1,
            guildId: 'g-pro',
            settings: payload.settings,
            mutation: { applied: true },
          },
        };
      },
    },
  });

  const response = await putMessageAutomationSettings({
    guildId: 'g-pro',
    settings: {
      boost: {
        enabled: true,
        channelId: '123456789012345678',
        plainMessage: '{user_mention} sunucuyu boostladı!',
        embed: {
          enabled: true,
          title: 'Sunucu Boostlandı',
          description: 'Teşekkürler, {user_mention}!',
          color: '#cc97ff',
          imageUrl: 'https://example.com/boost.png',
          thumbnailMode: 'user_avatar',
          footer: '{server_name}',
        },
      },
    },
    client,
  });

  assert.equal(response.guildId, 'g-pro');
  assert.equal(calls.length, 1);
});

test('dismissed notice input parsing normalizes comma-separated values', () => {
  assert.deepEqual(parseDismissedNoticeIdsInput('notice-a, notice-b ,notice-a'), [
    'notice-a',
    'notice-b',
  ]);
});
