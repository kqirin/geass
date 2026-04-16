import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOT_AUTH_ROUTE_STATES,
  deriveRootAuthRouteState,
  resolveRootAuthRouteDecision,
  toRootAuthNotice,
} from '../src/lib/authRouteState.js';

test('authenticated status routes to dashboard', () => {
  const routeDecision = deriveRootAuthRouteState({
    authStatus: {
      authenticated: true,
      principal: { id: 'u-1' },
    },
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.DASHBOARD);
  assert.equal(toRootAuthNotice(routeDecision), '');
});

test('unauthenticated status routes to login', () => {
  const routeDecision = deriveRootAuthRouteState({
    authStatus: {
      auth: {
        enabled: true,
        configured: true,
        authenticated: false,
      },
    },
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.LOGIN);
  assert.equal(toRootAuthNotice(routeDecision), '');
});

test('auth unavailable status routes to safe login/error state', () => {
  const routeDecision = deriveRootAuthRouteState({
    authStatus: {
      auth: {
        enabled: true,
        configured: false,
        authenticated: false,
        reasonCode: 'oauth_config_missing',
      },
    },
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.SAFE_LOGIN);
  assert.match(toRootAuthNotice(routeDecision), /oauth_config_missing/);
});

test('loginCode exchange resolves to dashboard route when exchange and status succeed', async () => {
  let exchangeCallCount = 0;
  let authStatusCallCount = 0;
  let storedTokenRecord = null;
  let loginCodeCleared = 0;

  const routeDecision = await resolveRootAuthRouteDecision({
    readLoginCodeFn: () => 'one-time-code',
    exchangeLoginCodeFn: async ({ code }) => {
      exchangeCallCount += 1;
      assert.equal(code, 'one-time-code');
      return {
        accessToken: 'access-token-1',
        expiresAt: '2030-01-01T00:00:00.000Z',
        principal: {
          id: 'u-1',
        },
      };
    },
    getAuthStatusFn: async () => {
      authStatusCallCount += 1;
      return {
        auth: {
          enabled: true,
          configured: true,
          authenticated: true,
        },
      };
    },
    storeAuthTokenFn: (record) => {
      storedTokenRecord = record;
    },
    clearLoginCodeFn: () => {
      loginCodeCleared += 1;
    },
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.DASHBOARD);
  assert.equal(exchangeCallCount, 1);
  assert.equal(authStatusCallCount, 1);
  assert.equal(loginCodeCleared, 1);
  assert.equal(storedTokenRecord.accessToken, 'access-token-1');
});

test('existing authenticated auth status routes to dashboard without loginCode exchange', async () => {
  let exchangeCallCount = 0;
  const routeDecision = await resolveRootAuthRouteDecision({
    readLoginCodeFn: () => null,
    exchangeLoginCodeFn: async () => {
      exchangeCallCount += 1;
      return null;
    },
    getAuthStatusFn: async () => ({
      auth: {
        enabled: true,
        configured: true,
        authenticated: true,
      },
    }),
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.DASHBOARD);
  assert.equal(exchangeCallCount, 0);
});

test('no loginCode and unauthenticated status routes to login', async () => {
  const routeDecision = await resolveRootAuthRouteDecision({
    readLoginCodeFn: () => null,
    getAuthStatusFn: async () => ({
      auth: {
        enabled: true,
        configured: true,
        authenticated: false,
      },
    }),
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.LOGIN);
});

test('loginCode exchange failure routes to safe login/error state', async () => {
  let authStatusCallCount = 0;
  let clearTokenCallCount = 0;
  let clearLoginCodeCallCount = 0;
  const routeDecision = await resolveRootAuthRouteDecision({
    readLoginCodeFn: () => 'broken-code',
    exchangeLoginCodeFn: async () => {
      throw {
        response: {
          status: 400,
          data: {
            ok: false,
            error: 'invalid_login_code',
            details: {
              reasonCode: 'code_not_found',
            },
          },
        },
      };
    },
    getAuthStatusFn: async () => {
      authStatusCallCount += 1;
      return {
        auth: {
          enabled: true,
          configured: true,
          authenticated: true,
        },
      };
    },
    clearAuthTokenFn: () => {
      clearTokenCallCount += 1;
    },
    clearLoginCodeFn: () => {
      clearLoginCodeCallCount += 1;
    },
  });

  assert.equal(routeDecision.routeState, ROOT_AUTH_ROUTE_STATES.SAFE_LOGIN);
  assert.match(toRootAuthNotice(routeDecision), /invalid_login_code/);
  assert.equal(authStatusCallCount, 0);
  assert.equal(clearTokenCallCount, 1);
  assert.equal(clearLoginCodeCallCount, 1);
});
