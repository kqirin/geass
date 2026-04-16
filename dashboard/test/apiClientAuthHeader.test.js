import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apiClient,
  clearStoredDashboardAuthToken,
  getStoredDashboardAuthTokenRecord,
  storeDashboardAuthToken,
} from '../src/lib/apiClient.js';

const DASHBOARD_AUTH_TOKEN_STORAGE_KEY = 'geass_dashboard_access_token_v1';

function createMockLocalStorage() {
  const storage = new Map();
  return {
    getItem(key) {
      return storage.has(key) ? String(storage.get(key)) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };
}

function useMockWindowStorage(t) {
  const previousWindow = globalThis.window;
  const localStorage = createMockLocalStorage();
  globalThis.window = {
    localStorage,
  };

  t.after(() => {
    clearStoredDashboardAuthToken();
    if (previousWindow === undefined) {
      delete globalThis.window;
      return;
    }
    globalThis.window = previousWindow;
  });

  return localStorage;
}

async function captureAuthorizationHeader() {
  const response = await apiClient.request({
    method: 'GET',
    url: '/api/dashboard/protected/overview',
    adapter: async (requestConfig) => ({
      config: requestConfig,
      data: {
        ok: true,
      },
      headers: {},
      status: 200,
      statusText: 'OK',
    }),
  });

  const headers =
    response?.config?.headers && typeof response.config.headers === 'object'
      ? response.config.headers
      : {};
  return (
    String(headers.Authorization || '').trim() ||
    String(headers.authorization || '').trim() ||
    null
  );
}

test('authorization header uses only accessToken from stored auth payload', async (t) => {
  const localStorage = useMockWindowStorage(t);
  localStorage.setItem(
    DASHBOARD_AUTH_TOKEN_STORAGE_KEY,
    JSON.stringify({
      accessToken: 'payload-token-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      principal: {
        id: 'u-1',
      },
    })
  );

  const authorizationHeader = await captureAuthorizationHeader();
  assert.equal(authorizationHeader, 'Bearer payload-token-1');
  assert.equal(authorizationHeader.includes('{'), false);
});

test('authorization header supports legacy plain token string storage', async (t) => {
  const localStorage = useMockWindowStorage(t);
  localStorage.setItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY, 'legacy-token-1');

  const storedTokenRecord = getStoredDashboardAuthTokenRecord();
  assert.equal(storedTokenRecord?.accessToken, 'legacy-token-1');

  const authorizationHeader = await captureAuthorizationHeader();
  assert.equal(authorizationHeader, 'Bearer legacy-token-1');
});

test('storeDashboardAuthToken accepts plain token strings', async (t) => {
  useMockWindowStorage(t);

  const storedTokenRecord = storeDashboardAuthToken('  plain-token-1  ');
  assert.equal(storedTokenRecord?.accessToken, 'plain-token-1');

  const authorizationHeader = await captureAuthorizationHeader();
  assert.equal(authorizationHeader, 'Bearer plain-token-1');
});
