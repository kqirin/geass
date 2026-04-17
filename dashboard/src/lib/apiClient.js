import axios from 'axios';

const metaEnv = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {};
const API_BASE = metaEnv.VITE_API_BASE || 'http://localhost:3000';
const DASHBOARD_AUTH_TOKEN_STORAGE_KEY = 'geass_dashboard_access_token_v1';

let inMemoryDashboardAuthTokenRecord = null;

export const CONTROL_PLANE_ROUTES = Object.freeze({
  authStatus: '/api/auth/status',
  authLogin: '/api/auth/login',
  authExchange: '/api/auth/exchange',
  authMe: '/api/auth/me',
  authGuilds: '/api/auth/guilds',
  authPlan: '/api/auth/plan',
  authLogout: '/api/auth/logout',
  dashboardOverview: '/api/dashboard/protected/overview',
  dashboardSetupReadiness: '/api/dashboard/protected/setup-readiness',
  dashboardLogsModeration: '/api/dashboard/protected/logs/moderation',
  dashboardLogsCommands: '/api/dashboard/protected/logs/commands',
  dashboardLogsSystem: '/api/dashboard/protected/logs/system',
  dashboardContextFeatures: '/api/dashboard/context/features',
  dashboardPreferences: '/api/dashboard/protected/preferences',
  dashboardStatusCommand: '/api/dashboard/protected/bot-settings/status-command',
  dashboardCommands: '/api/dashboard/protected/bot-settings/commands',
  dashboardMessageAutomation: '/api/dashboard/protected/message-automation',
});

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15_000,
});

function getStorageRef() {
  try {
    if (typeof window !== 'undefined' && window?.localStorage) {
      return window.localStorage;
    }
  } catch {}
  return null;
}

function nowMs() {
  return Date.now();
}

function toAccessToken(rawValue = null) {
  if (rawValue === null || rawValue === undefined) return null;

  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    if (!Object.prototype.hasOwnProperty.call(rawValue, 'accessToken')) {
      return null;
    }
    return toAccessToken(rawValue.accessToken);
  }

  if (typeof rawValue === 'string') {
    const trimmedRawValue = rawValue.trim();
    if (!trimmedRawValue) return null;

    try {
      return toAccessToken(JSON.parse(trimmedRawValue));
    } catch {
      return trimmedRawValue;
    }
  }

  return null;
}

function toStoredTokenRecord(rawValue = null) {
  if (!rawValue) return null;

  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const accessToken = toAccessToken(rawValue.accessToken);
    if (!accessToken) return null;
    const expiresAt =
      rawValue.expiresAt === null || rawValue.expiresAt === undefined
        ? null
        : String(rawValue.expiresAt || '').trim() || null;
    return {
      accessToken,
      expiresAt,
      principal:
        rawValue.principal && typeof rawValue.principal === 'object'
          ? rawValue.principal
          : null,
    };
  }

  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmedRawValue = rawValue.trim();
  if (!trimmedRawValue) return null;

  try {
    const parsed = JSON.parse(trimmedRawValue);
    return toStoredTokenRecord(parsed);
  } catch {
    const accessToken = toAccessToken(trimmedRawValue);
    if (!accessToken) return null;
    return {
      accessToken,
      expiresAt: null,
      principal: null,
    };
  }
}

function isTokenExpired(record = null) {
  const expiresAtIso = String(record?.expiresAt || '').trim();
  if (!expiresAtIso) return false;
  const expiresAtMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs <= nowMs();
}

function readStoredTokenRecord() {
  const storage = getStorageRef();
  if (!storage) return inMemoryDashboardAuthTokenRecord;

  const rawValue = storage.getItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY);
  return toStoredTokenRecord(rawValue);
}

function writeStoredTokenRecord(record = null) {
  const storage = getStorageRef();
  if (!storage) {
    inMemoryDashboardAuthTokenRecord = record;
    return;
  }

  if (!record) {
    storage.removeItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY);
    return;
  }
  storage.setItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY, JSON.stringify(record));
}

export function clearStoredDashboardAuthToken() {
  writeStoredTokenRecord(null);
}

export function getStoredDashboardAuthTokenRecord() {
  const record = toStoredTokenRecord(readStoredTokenRecord());
  if (!record) return null;

  if (isTokenExpired(record)) {
    clearStoredDashboardAuthToken();
    return null;
  }
  return record;
}

export function getStoredDashboardAccessToken() {
  return getStoredDashboardAuthTokenRecord()?.accessToken || null;
}

export function storeDashboardAuthToken(rawRecord = {}) {
  const record = toStoredTokenRecord(rawRecord);
  if (!record) {
    clearStoredDashboardAuthToken();
    return null;
  }

  writeStoredTokenRecord(record);
  return record;
}

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

apiClient.interceptors.request.use((requestConfig) => {
  const existingAuthorizationHeader =
    String(requestConfig?.headers?.Authorization || '').trim() ||
    String(requestConfig?.headers?.authorization || '').trim();
  if (existingAuthorizationHeader) return requestConfig;

  const accessToken = getStoredDashboardAccessToken();
  if (!accessToken) return requestConfig;

  const nextHeaders =
    requestConfig?.headers && typeof requestConfig.headers === 'object'
      ? requestConfig.headers
      : {};
  nextHeaders.Authorization = `Bearer ${accessToken}`;
  return {
    ...requestConfig,
    headers: nextHeaders,
  };
});

export async function getAuthStatus(client = apiClient) {
  const response = await client.get(CONTROL_PLANE_ROUTES.authStatus);
  return unwrapApiData(response);
}

export async function postAuthExchange({ code = '', client = apiClient } = {}) {
  const response = await client.post(CONTROL_PLANE_ROUTES.authExchange, { code });
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

export async function getSetupReadiness({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardSetupReadiness,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function getModerationLogs({
  guildId = null,
  limit = null,
  cursor = null,
  client = apiClient,
} = {}) {
  const config = toGuildQueryConfig(guildId);
  const params =
    config?.params && typeof config.params === 'object' ? { ...config.params } : {};
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.limit = Math.floor(Number(limit));
  }
  const normalizedCursor = String(cursor || '').trim();
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  }
  const response = await client.get(CONTROL_PLANE_ROUTES.dashboardLogsModeration, {
    params,
  });
  return unwrapApiData(response);
}

export async function getCommandLogs({
  guildId = null,
  limit = null,
  cursor = null,
  client = apiClient,
} = {}) {
  const config = toGuildQueryConfig(guildId);
  const params =
    config?.params && typeof config.params === 'object' ? { ...config.params } : {};
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.limit = Math.floor(Number(limit));
  }
  const normalizedCursor = String(cursor || '').trim();
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  }
  const response = await client.get(CONTROL_PLANE_ROUTES.dashboardLogsCommands, {
    params,
  });
  return unwrapApiData(response);
}

export async function getSystemLogs({
  guildId = null,
  limit = null,
  cursor = null,
  client = apiClient,
} = {}) {
  const config = toGuildQueryConfig(guildId);
  const params =
    config?.params && typeof config.params === 'object' ? { ...config.params } : {};
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.limit = Math.floor(Number(limit));
  }
  const normalizedCursor = String(cursor || '').trim();
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  }
  const response = await client.get(CONTROL_PLANE_ROUTES.dashboardLogsSystem, {
    params,
  });
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

export async function getCommandSettings({ guildId = null, client = apiClient } = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardCommands,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function putCommandSettings({
  guildId = null,
  commands = {},
  client = apiClient,
} = {}) {
  const response = await client.put(
    CONTROL_PLANE_ROUTES.dashboardCommands,
    { commands },
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function getMessageAutomationSettings({
  guildId = null,
  client = apiClient,
} = {}) {
  const response = await client.get(
    CONTROL_PLANE_ROUTES.dashboardMessageAutomation,
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}

export async function putMessageAutomationSettings({
  guildId = null,
  settings = {},
  client = apiClient,
} = {}) {
  const response = await client.put(
    CONTROL_PLANE_ROUTES.dashboardMessageAutomation,
    { settings },
    toGuildQueryConfig(guildId)
  );
  return unwrapApiData(response);
}
