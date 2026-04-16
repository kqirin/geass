import { normalizeAuthStatusSnapshot } from '../hooks/useDashboardData.js';
import {
  clearStoredDashboardAuthToken,
  getAuthStatus,
  normalizeApiError,
  postAuthExchange,
  storeDashboardAuthToken,
} from './apiClient.js';

export const ROOT_AUTH_ROUTE_STATES = Object.freeze({
  LOADING: 'loading',
  DASHBOARD: 'dashboard',
  LOGIN: 'login',
  SAFE_LOGIN: 'safe_login',
});

export function deriveRootAuthRouteState({ authStatus = null, error = null } = {}) {
  if (error) {
    const normalizedError = normalizeApiError(error, 'Auth status yuklenemedi');
    return {
      routeState: ROOT_AUTH_ROUTE_STATES.SAFE_LOGIN,
      reasonCode: normalizedError.reasonCode || normalizedError.code || 'auth_status_unavailable',
      message: normalizedError.message,
    };
  }

  const normalizedStatus = normalizeAuthStatusSnapshot(authStatus);
  const auth =
    normalizedStatus?.auth && typeof normalizedStatus.auth === 'object'
      ? normalizedStatus.auth
      : {};

  if (!auth.enabled || !auth.configured) {
    return {
      routeState: ROOT_AUTH_ROUTE_STATES.SAFE_LOGIN,
      reasonCode: auth.reasonCode || 'auth_not_configured',
      message: null,
    };
  }

  if (auth.authenticated) {
    return {
      routeState: ROOT_AUTH_ROUTE_STATES.DASHBOARD,
      reasonCode: null,
      message: null,
    };
  }

  return {
    routeState: ROOT_AUTH_ROUTE_STATES.LOGIN,
    reasonCode: null,
    message: null,
  };
}

export function toRootAuthNotice(routeDecision = {}) {
  if (routeDecision?.routeState !== ROOT_AUTH_ROUTE_STATES.SAFE_LOGIN) return '';
  if (routeDecision.message) return routeDecision.message;
  return routeDecision.reasonCode
    ? `Auth gecici olarak kullanilamiyor (${routeDecision.reasonCode}).`
    : 'Auth gecici olarak kullanilamiyor.';
}

export function readLoginCodeFromLocation(locationRef = null) {
  const resolvedLocation =
    locationRef ||
    (typeof window !== 'undefined' && window?.location ? window.location : null);
  if (!resolvedLocation) return null;

  const rawHref = String(
    resolvedLocation.href ||
      `${resolvedLocation.pathname || '/'}${resolvedLocation.search || ''}${
        resolvedLocation.hash || ''
      }`
  ).trim();
  if (!rawHref) return null;

  try {
    const parsed = new URL(rawHref, 'http://127.0.0.1');
    const loginCode = String(parsed.searchParams.get('loginCode') || '').trim();
    return loginCode || null;
  } catch {
    return null;
  }
}

export function clearLoginCodeFromLocation({ locationRef = null, historyRef = null } = {}) {
  const resolvedLocation =
    locationRef ||
    (typeof window !== 'undefined' && window?.location ? window.location : null);
  const resolvedHistory =
    historyRef ||
    (typeof window !== 'undefined' && window?.history ? window.history : null);
  if (
    !resolvedLocation ||
    !resolvedHistory ||
    typeof resolvedHistory.replaceState !== 'function'
  ) {
    return;
  }

  const rawHref = String(
    resolvedLocation.href ||
      `${resolvedLocation.pathname || '/'}${resolvedLocation.search || ''}${
        resolvedLocation.hash || ''
      }`
  ).trim();
  if (!rawHref) return;

  try {
    const parsed = new URL(rawHref, 'http://127.0.0.1');
    if (!parsed.searchParams.has('loginCode')) return;
    parsed.searchParams.delete('loginCode');
    const nextSearch = parsed.search || '';
    const nextHash = parsed.hash || '';
    const nextPath = `${parsed.pathname || '/'}${nextSearch}${nextHash}`;
    resolvedHistory.replaceState(null, '', nextPath);
  } catch {}
}

function createExchangeResponseValidationError() {
  return {
    response: {
      status: 502,
      data: {
        ok: false,
        error: 'auth_exchange_invalid_response',
        details: {
          reasonCode: 'missing_access_token',
        },
      },
    },
  };
}

export async function resolveRootAuthRouteDecision({
  getAuthStatusFn = getAuthStatus,
  exchangeLoginCodeFn = postAuthExchange,
  readLoginCodeFn = readLoginCodeFromLocation,
  clearLoginCodeFn = clearLoginCodeFromLocation,
  storeAuthTokenFn = storeDashboardAuthToken,
  clearAuthTokenFn = clearStoredDashboardAuthToken,
} = {}) {
  const loginCode =
    typeof readLoginCodeFn === 'function' ? readLoginCodeFn() : null;
  if (loginCode) {
    try {
      const exchangePayload =
        typeof exchangeLoginCodeFn === 'function'
          ? await exchangeLoginCodeFn({ code: loginCode })
          : null;
      if (!exchangePayload?.accessToken) {
        throw createExchangeResponseValidationError();
      }

      if (typeof storeAuthTokenFn === 'function') {
        storeAuthTokenFn({
          accessToken: exchangePayload.accessToken,
          expiresAt: exchangePayload.expiresAt || null,
          principal:
            exchangePayload.principal && typeof exchangePayload.principal === 'object'
              ? exchangePayload.principal
              : null,
        });
      }
    } catch (error) {
      if (typeof clearAuthTokenFn === 'function') {
        clearAuthTokenFn();
      }
      if (typeof clearLoginCodeFn === 'function') {
        clearLoginCodeFn();
      }
      return deriveRootAuthRouteState({ error });
    }

    if (typeof clearLoginCodeFn === 'function') {
      clearLoginCodeFn();
    }
  }

  try {
    const authStatus =
      typeof getAuthStatusFn === 'function' ? await getAuthStatusFn() : null;
    return deriveRootAuthRouteState({ authStatus });
  } catch (error) {
    const normalizedError = normalizeApiError(error, 'Auth status yuklenemedi');
    if (
      normalizedError?.isUnauthenticated &&
      typeof clearAuthTokenFn === 'function'
    ) {
      clearAuthTokenFn();
    }
    return deriveRootAuthRouteState({ error });
  }
}
