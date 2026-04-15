import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DASHBOARD_VIEW_STATES,
  bootstrapDashboardAuthSession,
  deriveViewStateFromError,
  loadProtectedDashboardSnapshot,
  parseDismissedNoticeIdsInput,
} from '../src/hooks/useDashboardData.js';
import { normalizeApiError, putDashboardPreferences, putStatusCommandSettings } from '../src/lib/apiClient.js';

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

test('protected snapshot loads overview, plan, capabilities, preferences, and status-command settings', async () => {
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
      '/api/dashboard/protected/bot-settings/status-command?guildId=g-pro': {
        ok: true,
        data: {
          settings: { detailMode: 'compact' },
          effective: { detailMode: 'compact' },
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
  assert.equal(snapshot.statusCommandPayload.effective.detailMode, 'compact');
  assert.equal(
    calls.filter((entry) => entry.method === 'GET').length,
    5
  );
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

test('status-command write sends low-risk detail mode mutation', async () => {
  const { client, calls } = createMockClient({
    putMap: {
      '/api/dashboard/protected/bot-settings/status-command?guildId=g-pro': ({ payload }) => {
        assert.equal(payload.settings.detailMode, 'compact');
        return {
          ok: true,
          data: {
            settings: { detailMode: 'compact' },
            effective: { detailMode: 'compact' },
            mutation: { applied: true },
          },
        };
      },
    },
  });

  const response = await putStatusCommandSettings({
    guildId: 'g-pro',
    detailMode: 'compact',
    client,
  });

  assert.equal(response.effective.detailMode, 'compact');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].key,
    '/api/dashboard/protected/bot-settings/status-command?guildId=g-pro'
  );
});

test('dismissed notice input parsing normalizes comma-separated values', () => {
  assert.deepEqual(parseDismissedNoticeIdsInput('notice-a, notice-b ,notice-a'), [
    'notice-a',
    'notice-b',
  ]);
});
