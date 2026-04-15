import axios from 'axios';

const metaEnv = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {};
const API_BASE = metaEnv.VITE_API_BASE || 'http://localhost:3000';

export const CONTROL_PLANE_ROUTES = Object.freeze({
  authStatus: '/api/auth/status',
  authLogin: '/api/auth/login',
  authMe: '/api/auth/me',
  authGuilds: '/api/auth/guilds',
  authPlan: '/api/auth/plan',
  authLogout: '/api/auth/logout',
  dashboardOverview: '/api/dashboard/protected/overview',
  dashboardContextFeatures: '/api/dashboard/context/features',
  dashboardPreferences: '/api/dashboard/protected/preferences',
  dashboardStatusCommand: '/api/dashboard/protected/bot-settings/status-command',
});

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15_000,
});

function toNormalizedPath(path = '/') {
  const raw = String(path || '').trim() || '/';
  if (raw.startsWith('/')) return raw;
  return `/${raw}`;
}

function toResponseEnvelopeData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (payload.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

function toGuildQueryConfig(guildId = null) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) return {};
  return {
    params: {
      guildId: normalizedGuildId,
    },
  };
}

export function buildApiUrl(path = '/') {
  const normalizedBase = String(API_BASE || '').trim().replace(/\/+$/, '');
  return `${normalizedBase}${toNormalizedPath(path)}`;
}

export function getAuthLoginUrl() {
  return buildApiUrl(CONTROL_PLANE_ROUTES.authLogin);
}

export function extractRequestId(error) {
  return error?.response?.data?.requestId || null;
}

export function normalizeApiError(error, fallback = 'Islem basarisiz') {
  const responseData =
    error?.response?.data && typeof error.response.data === 'object'
      ? error.response.data
      : {};
  const details =
    responseData?.details && typeof responseData.details === 'object' && !Array.isArray(responseData.details)
      ? responseData.details
      : null;
  const requestId = extractRequestId(error);
  const status = Number(error?.response?.status || 0) || null;
  const code = String(responseData?.error || '').trim() || 'unknown_error';
  const reasonCode =
    details?.reasonCode === undefined || details?.reasonCode === null
      ? null
      : String(details.reasonCode || '').trim() || null;
  const baseMessage = String(responseData?.message || responseData?.error || fallback);
  const message = requestId ? `${baseMessage} (#${requestId})` : baseMessage;

  return {
    status,
    code,
    reasonCode,
    details,
    requestId,
    message,
    isUnauthenticated: status === 401 || code === 'unauthenticated',
    isNoAccess: status === 403 && code === 'guild_access_denied',
    isCapabilityDenied: status === 403 && code === 'capability_denied',
    isAuthUnavailable:
      status === 503 && (code === 'auth_disabled' || code === 'auth_not_configured'),
  };
}

export function extractApiError(error, fallback = 'Islem basarisiz') {
  return normalizeApiError(error, fallback).message;
}

export function unwrapApiData(response) {
  return toResponseEnvelopeData(response?.data);
}

export async function getAuthStatus(client = apiClient) {
  const response = await client.get(CONTROL_PLANE_ROUTES.authStatus);
  return unwrapApiData(response);
}

export async function getAuthMe(client = apiClient) {
  const response = await client.get(CONTROL_PLANE_ROUTES.authMe);
  return unwrapApiData(response);
}

export async function getAuthGuilds(client = apiClient) {
  const response = await client.get(CONTROL_PLANE_ROUTES.authGuilds);
  return unwrapApiData(response);
}

export async function getAuthPlan({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(CONTROL_PLANE_ROUTES.authPlan, toGuildQueryConfig(guildId));
  return unwrapApiData(response);
}

export async function postAuthLogout(client = apiClient) {
  const response = await client.post(CONTROL_PLANE_ROUTES.authLogout, {});
  return unwrapApiData(response);
}

export async function getDashboardContextFeatures({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardContextFeatures,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function getProtectedOverview({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardOverview,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function getDashboardPreferences({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardPreferences,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function putDashboardPreferences({
  guildId = null,
  preferences = {},
  client = apiClient,
} = {}) {
  const response = await client.put(
    CONTROL_PLANE_ROUTES.dashboardPreferences,
    { preferences },
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function getStatusCommandSettings({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardStatusCommand,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function putStatusCommandSettings({
  guildId = null,
  detailMode = null,
  client = apiClient,
} = {}) {
  const response = await client.put(
    CONTROL_PLANE_ROUTES.dashboardStatusCommand,
    {
      settings: {
        detailMode,
      },
    },
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}
