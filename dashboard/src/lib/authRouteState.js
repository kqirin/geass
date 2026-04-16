import { normalizeAuthStatusSnapshot } from '../hooks/useDashboardData.js';
import { normalizeApiError } from './apiClient.js';

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
