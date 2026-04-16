import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOT_AUTH_ROUTE_STATES,
  deriveRootAuthRouteState,
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
