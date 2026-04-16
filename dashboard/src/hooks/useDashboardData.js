import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearStoredDashboardAuthToken,
  getAuthGuilds,
  getAuthLoginUrl,
  getAuthMe,
  getAuthPlan,
  getAuthStatus,
  getDashboardContextFeatures,
  getDashboardPreferences,
  getProtectedOverview,
  getStatusCommandSettings,
  normalizeApiError,
  postAuthLogout,
  putDashboardPreferences,
  putStatusCommandSettings,
} from '../lib/apiClient.js';
import { createLatestRequestGate } from '../lib/latestRequestGate.js';

export const DASHBOARD_VIEW_STATES = Object.freeze({
  LOADING: 'loading',
  UNAUTHENTICATED: 'unauthenticated',
  AUTH_UNAVAILABLE: 'auth_unavailable',
  NO_ACCESS: 'no_access',
  READY: 'ready',
  ERROR: 'error',
});

export const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  defaultView: 'overview',
  compactMode: false,
  dismissedNoticeIds: [],
  advancedLayoutMode: null,
});

export const DEFAULT_STATUS_COMMAND_DETAIL_MODE = 'legacy';

function toNormalizedList(rawValue) {
  if (!Array.isArray(rawValue)) return [];
  const unique = new Set();
  const normalized = [];
  for (const entry of rawValue) {
    const value = String(entry || '').trim();
    if (!value) continue;
    if (unique.has(value)) continue;
    unique.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function parseDismissedNoticeIdsInput(value = '') {
  if (typeof value !== 'string') return [];
  return toNormalizedList(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function formatDismissedNoticeIdsInput(ids = []) {
  return toNormalizedList(ids).join(', ');
}

export function pickInitialGuildId(guilds = [], preferredGuildId = '') {
  const normalizedGuilds = Array.isArray(guilds) ? guilds : [];
  const normalizedPreferredGuildId = String(preferredGuildId || '').trim();

  if (normalizedPreferredGuildId) {
    const preferredMatch = normalizedGuilds.find(
      (guild) => String(guild?.id || '').trim() === normalizedPreferredGuildId
    );
    if (preferredMatch) return normalizedPreferredGuildId;
  }

  const operatorGuild = normalizedGuilds.find((guild) => Boolean(guild?.isOperator));
  if (operatorGuild?.id) return String(operatorGuild.id);

  const firstGuildId = String(normalizedGuilds[0]?.id || '').trim();
  return firstGuildId || '';
}

export function deriveViewStateFromError(errorMeta) {
  if (!errorMeta || typeof errorMeta !== 'object') return DASHBOARD_VIEW_STATES.ERROR;
  if (errorMeta.isAuthUnavailable) return DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE;
  if (errorMeta.isUnauthenticated) return DASHBOARD_VIEW_STATES.UNAUTHENTICATED;
  if (errorMeta.isNoAccess) return DASHBOARD_VIEW_STATES.NO_ACCESS;
  return DASHBOARD_VIEW_STATES.ERROR;
}

export function normalizeAuthStatusSnapshot(rawStatus = {}) {
  const status =
    rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
      ? rawStatus
      : {};
  const rawAuth =
    status?.auth && typeof status.auth === 'object' && !Array.isArray(status.auth)
      ? status.auth
      : {};

  const enabled =
    typeof rawAuth.enabled === 'boolean'
      ? rawAuth.enabled
      : typeof status.enabled === 'boolean'
        ? status.enabled
        : true;
  const configured =
    typeof rawAuth.configured === 'boolean'
      ? rawAuth.configured
      : typeof status.configured === 'boolean'
        ? status.configured
        : true;
  const authenticated =
    typeof rawAuth.authenticated === 'boolean'
      ? rawAuth.authenticated
      : typeof status.authenticated === 'boolean'
        ? status.authenticated
        : false;

  const reasonCodeFromAuth =
    rawAuth.reasonCode === undefined || rawAuth.reasonCode === null
      ? null
      : String(rawAuth.reasonCode || '').trim() || null;
  const reasonCodeFromStatus =
    status.reasonCode === undefined || status.reasonCode === null
      ? null
      : String(status.reasonCode || '').trim() || null;
  const reasonCode =
    reasonCodeFromAuth ||
    reasonCodeFromStatus ||
    (!enabled ? 'auth_disabled' : !configured ? 'auth_not_configured' : null);

  const principal =
    status?.principal && typeof status.principal === 'object' ? status.principal : null;
  const session =
    status?.session && typeof status.session === 'object' ? status.session : null;

  return {
    ...status,
    auth: {
      ...rawAuth,
      enabled,
      configured,
      authenticated,
      reasonCode,
    },
    authenticated,
    principal,
    session,
  };
}

export async function bootstrapDashboardAuthSession({
  preferredGuildId = '',
  client,
} = {}) {
  const authStatus = normalizeAuthStatusSnapshot(await getAuthStatus(client));
  const auth = authStatus?.auth && typeof authStatus.auth === 'object' ? authStatus.auth : {};

  if (!auth.enabled || !auth.configured) {
    return {
      viewState: DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE,
      authenticated: false,
      authStatus,
      principal: null,
      session: null,
      guilds: [],
      guildId: '',
    };
  }

  if (!auth.authenticated) {
    return {
      viewState: DASHBOARD_VIEW_STATES.UNAUTHENTICATED,
      authenticated: false,
      authStatus,
      principal: null,
      session: null,
      guilds: [],
      guildId: '',
    };
  }

  const [mePayload, guildPayload] = await Promise.all([getAuthMe(client), getAuthGuilds(client)]);
  const guilds = Array.isArray(guildPayload?.guilds) ? guildPayload.guilds : [];
  const guildId = pickInitialGuildId(guilds, preferredGuildId);

  return {
    viewState: DASHBOARD_VIEW_STATES.LOADING,
    authenticated: true,
    authStatus,
    principal: mePayload?.principal || authStatus?.principal || null,
    session: mePayload?.session || authStatus?.session || null,
    guilds,
    guildId,
  };
}

export async function loadProtectedDashboardSnapshot({ guildId = null, client } = {}) {
  const planPayload = await getAuthPlan({ guildId, client });
  const resolvedGuildId =
    String(planPayload?.access?.targetGuildId || guildId || '').trim() || null;

  const [featuresPayload, overviewPayload, preferencesPayload, statusCommandPayload] =
    await Promise.all([
      getDashboardContextFeatures({ guildId: resolvedGuildId, client }),
      getProtectedOverview({ guildId: resolvedGuildId, client }),
      getDashboardPreferences({ guildId: resolvedGuildId, client }),
      getStatusCommandSettings({ guildId: resolvedGuildId, client }),
    ]);

  return {
    guildId: resolvedGuildId,
    planPayload,
    featuresPayload,
    overviewPayload,
    preferencesPayload,
    statusCommandPayload,
  };
}

function toDefaultPreferences(rawPreferences = {}) {
  return {
    defaultView: String(rawPreferences?.defaultView || DEFAULT_DASHBOARD_PREFERENCES.defaultView),
    compactMode:
      typeof rawPreferences?.compactMode === 'boolean'
        ? rawPreferences.compactMode
        : DEFAULT_DASHBOARD_PREFERENCES.compactMode,
    dismissedNoticeIds: toNormalizedList(rawPreferences?.dismissedNoticeIds),
    advancedLayoutMode:
      rawPreferences?.advancedLayoutMode === null || typeof rawPreferences?.advancedLayoutMode === 'string'
        ? rawPreferences?.advancedLayoutMode || null
        : null,
  };
}

function toStatusCommandDetailMode(rawStatusSettings = {}) {
  const effectiveDetailMode = String(rawStatusSettings?.effective?.detailMode || '').trim().toLowerCase();
  if (effectiveDetailMode === 'compact') return 'compact';

  const rawDetailMode = String(rawStatusSettings?.settings?.detailMode || '').trim().toLowerCase();
  if (rawDetailMode === 'compact') return 'compact';

  return DEFAULT_STATUS_COMMAND_DETAIL_MODE;
}

function normalizeCapabilitySummary(rawSummary = {}) {
  return {
    totalCapabilities: Number(rawSummary?.totalCapabilities || 0),
    allowedCapabilities: Number(rawSummary?.allowedCapabilities || 0),
    deniedCapabilities: Number(rawSummary?.deniedCapabilities || 0),
    activeCapabilities: Number(rawSummary?.activeCapabilities || 0),
  };
}

export function useDashboardData({ navigate }) {
  const [viewState, setViewState] = useState(DASHBOARD_VIEW_STATES.LOADING);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const bootstrapGateRef = useRef(createLatestRequestGate());
  const protectedDataGateRef = useRef(createLatestRequestGate());

  const [authenticated, setAuthenticated] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [principal, setPrincipal] = useState(null);
  const [session, setSession] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState('');

  const [plan, setPlan] = useState(null);
  const [capabilities, setCapabilities] = useState({});
  const [capabilitySummary, setCapabilitySummary] = useState(
    normalizeCapabilitySummary({})
  );
  const [overview, setOverview] = useState(null);
  const [preferences, setPreferences] = useState({ ...DEFAULT_DASHBOARD_PREFERENCES });
  const [preferencesPlan, setPreferencesPlan] = useState(null);
  const [preferencesCapabilities, setPreferencesCapabilities] = useState(null);
  const [statusCommandSettings, setStatusCommandSettings] = useState(null);

  const [preferencesDraft, setPreferencesDraft] = useState({ ...DEFAULT_DASHBOARD_PREFERENCES });
  const [dismissedNoticeIdsInput, setDismissedNoticeIdsInput] = useState('');
  const [statusCommandDetailModeDraft, setStatusCommandDetailModeDraft] = useState(
    DEFAULT_STATUS_COMMAND_DETAIL_MODE
  );

  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isProtectedLoading, setIsProtectedLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [protectedError, setProtectedError] = useState(null);
  const [preferencesSaveState, setPreferencesSaveState] = useState('idle');
  const [preferencesSaveMessage, setPreferencesSaveMessage] = useState('');
  const [statusCommandSaveState, setStatusCommandSaveState] = useState('idle');
  const [statusCommandSaveMessage, setStatusCommandSaveMessage] = useState('');

  const metaEnv = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {};
  const preferredGuildId = metaEnv.VITE_SINGLE_GUILD_ID || metaEnv.VITE_GUILD_ID || '';

  const showToast = useCallback((text, type = 'ok', duration = 2400) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, text: String(text || '') });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const resetProtectedData = useCallback(() => {
    setPlan(null);
    setCapabilities({});
    setCapabilitySummary(normalizeCapabilitySummary({}));
    setOverview(null);
    setPreferences({ ...DEFAULT_DASHBOARD_PREFERENCES });
    setPreferencesDraft({ ...DEFAULT_DASHBOARD_PREFERENCES });
    setDismissedNoticeIdsInput('');
    setPreferencesPlan(null);
    setPreferencesCapabilities(null);
    setStatusCommandSettings(null);
    setStatusCommandDetailModeDraft(DEFAULT_STATUS_COMMAND_DETAIL_MODE);
    setProtectedError(null);
    setPreferencesSaveState('idle');
    setPreferencesSaveMessage('');
    setStatusCommandSaveState('idle');
    setStatusCommandSaveMessage('');
  }, []);

  const applyProtectedSnapshot = useCallback((snapshot = {}) => {
    setPlan(snapshot?.planPayload?.plan || null);
    setCapabilities(snapshot?.featuresPayload?.capabilities || {});
    setCapabilitySummary(normalizeCapabilitySummary(snapshot?.featuresPayload?.capabilitySummary));
    setOverview(snapshot?.overviewPayload || null);

    const normalizedPreferences = toDefaultPreferences(
      snapshot?.preferencesPayload?.preferences || {}
    );
    setPreferences(normalizedPreferences);
    setPreferencesDraft(normalizedPreferences);
    setDismissedNoticeIdsInput(formatDismissedNoticeIdsInput(normalizedPreferences.dismissedNoticeIds));
    setPreferencesPlan(snapshot?.preferencesPayload?.plan || null);
    setPreferencesCapabilities(snapshot?.preferencesPayload?.capabilities || null);

    setStatusCommandSettings(snapshot?.statusCommandPayload || null);
    setStatusCommandDetailModeDraft(
      toStatusCommandDetailMode(snapshot?.statusCommandPayload || {})
    );
  }, []);

  const runAuthBootstrap = useCallback(async () => {
    const request = bootstrapGateRef.current.begin('auth-bootstrap');
    setIsAuthLoading(true);
    setAuthError(null);
    setProtectedError(null);
    setViewState(DASHBOARD_VIEW_STATES.LOADING);

    try {
      const sessionSnapshot = await bootstrapDashboardAuthSession({
        preferredGuildId,
      });
      if (!request.isCurrent()) return;

      setAuthStatus(sessionSnapshot.authStatus || null);
      setPrincipal(sessionSnapshot.principal || null);
      setSession(sessionSnapshot.session || null);
      setGuilds(Array.isArray(sessionSnapshot.guilds) ? sessionSnapshot.guilds : []);
      setAuthenticated(Boolean(sessionSnapshot.authenticated));
      resetProtectedData();

      const resolvedGuildId = String(sessionSnapshot.guildId || '').trim();
      setGuildId(resolvedGuildId);
      if (!sessionSnapshot.authenticated) {
        clearStoredDashboardAuthToken();
      }

      if (sessionSnapshot.viewState !== DASHBOARD_VIEW_STATES.LOADING) {
        setViewState(sessionSnapshot.viewState);
      } else if (!resolvedGuildId) {
        setViewState(DASHBOARD_VIEW_STATES.NO_ACCESS);
      }
    } catch (error) {
      if (!request.isCurrent()) return;
      const normalizedError = normalizeApiError(error, 'Auth status yuklenemedi');
      setAuthError(normalizedError);
      if (normalizedError.isUnauthenticated) {
        clearStoredDashboardAuthToken();
      }
      setAuthenticated(false);
      resetProtectedData();
      setGuilds([]);
      setGuildId('');
      setViewState(deriveViewStateFromError(normalizedError));
    } finally {
      if (request.isCurrent()) {
        setIsAuthLoading(false);
      }
    }
  }, [preferredGuildId, resetProtectedData]);

  const loadProtectedData = useCallback(
    async (targetGuildId) => {
      const normalizedGuildId = String(targetGuildId || '').trim();
      if (!normalizedGuildId) {
        setViewState(DASHBOARD_VIEW_STATES.NO_ACCESS);
        return;
      }

      const request = protectedDataGateRef.current.begin(normalizedGuildId);
      setIsProtectedLoading(true);
      setProtectedError(null);
      setViewState(DASHBOARD_VIEW_STATES.LOADING);

      try {
        const snapshot = await loadProtectedDashboardSnapshot({
          guildId: normalizedGuildId,
        });
        if (!request.isCurrent()) return;

        const resolvedGuildId = String(snapshot?.guildId || normalizedGuildId).trim();
        if (resolvedGuildId && resolvedGuildId !== normalizedGuildId) {
          setGuildId(resolvedGuildId);
        }

        applyProtectedSnapshot(snapshot);
        setViewState(DASHBOARD_VIEW_STATES.READY);
      } catch (error) {
        if (!request.isCurrent()) return;
        const normalizedError = normalizeApiError(
          error,
          'Korumali dashboard verisi yuklenemedi'
        );
        setProtectedError(normalizedError);
        setViewState(deriveViewStateFromError(normalizedError));
      } finally {
        if (request.isCurrent()) {
          setIsProtectedLoading(false);
        }
      }
    },
    [applyProtectedSnapshot]
  );

  useEffect(() => {
    document.title = 'GEASS Dashboard';
    void runAuthBootstrap();
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [runAuthBootstrap]);

  useEffect(() => {
    if (!authenticated) return;
    void loadProtectedData(guildId);
  }, [authenticated, guildId, loadProtectedData]);

  const refreshProtectedData = useCallback(async () => {
    if (!authenticated) return;
    await loadProtectedData(guildId);
  }, [authenticated, guildId, loadProtectedData]);

  const savePreferences = useCallback(async () => {
    if (!authenticated || !guildId) return;

    const dismissedNoticeIds = parseDismissedNoticeIdsInput(dismissedNoticeIdsInput);
    const advancedAvailable = Boolean(
      preferencesCapabilities?.advancedDashboardPreferences?.available
    );
    const payload = {
      defaultView: preferencesDraft.defaultView || DEFAULT_DASHBOARD_PREFERENCES.defaultView,
      compactMode: Boolean(preferencesDraft.compactMode),
      dismissedNoticeIds,
      advancedLayoutMode: advancedAvailable
        ? preferencesDraft.advancedLayoutMode || null
        : null,
    };

    setPreferencesSaveState('saving');
    setPreferencesSaveMessage('');

    try {
      const response = await putDashboardPreferences({
        guildId,
        preferences: payload,
      });

      const nextPreferences = toDefaultPreferences(response?.preferences || payload);
      setPreferences(nextPreferences);
      setPreferencesDraft(nextPreferences);
      setDismissedNoticeIdsInput(formatDismissedNoticeIdsInput(nextPreferences.dismissedNoticeIds));
      setPreferencesPlan(response?.plan || null);
      setPreferencesCapabilities(response?.capabilities || null);
      setPreferencesSaveState('success');
      setPreferencesSaveMessage('Tercihler kaydedildi');
      showToast('Tercihler kaydedildi', 'ok');
    } catch (error) {
      const normalizedError = normalizeApiError(
        error,
        'Tercihler kaydedilemedi'
      );
      setPreferencesSaveState('error');
      setPreferencesSaveMessage(normalizedError.message);
      showToast(normalizedError.message, 'err', 3600);

      const nextViewState = deriveViewStateFromError(normalizedError);
      if (nextViewState !== DASHBOARD_VIEW_STATES.ERROR) {
        setViewState(nextViewState);
      }
    }
  }, [
    authenticated,
    dismissedNoticeIdsInput,
    guildId,
    preferencesCapabilities?.advancedDashboardPreferences?.available,
    preferencesDraft,
    showToast,
  ]);

  const saveStatusCommandSettings = useCallback(async () => {
    if (!authenticated || !guildId) return;

    const detailMode =
      statusCommandDetailModeDraft === 'compact'
        ? 'compact'
        : DEFAULT_STATUS_COMMAND_DETAIL_MODE;
    setStatusCommandSaveState('saving');
    setStatusCommandSaveMessage('');

    try {
      const response = await putStatusCommandSettings({
        guildId,
        detailMode,
      });
      setStatusCommandSettings(response || null);
      setStatusCommandDetailModeDraft(toStatusCommandDetailMode(response || {}));
      setStatusCommandSaveState('success');
      setStatusCommandSaveMessage('Durum komutu ayari kaydedildi');
      showToast('Durum komutu ayari kaydedildi', 'ok');
    } catch (error) {
      const normalizedError = normalizeApiError(
        error,
        'Durum komutu ayari kaydedilemedi'
      );
      setStatusCommandSaveState('error');
      setStatusCommandSaveMessage(normalizedError.message);
      showToast(normalizedError.message, 'err', 3600);

      const nextViewState = deriveViewStateFromError(normalizedError);
      if (nextViewState !== DASHBOARD_VIEW_STATES.ERROR) {
        setViewState(nextViewState);
      }
    }
  }, [authenticated, guildId, showToast, statusCommandDetailModeDraft]);

  const login = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.location.href = getAuthLoginUrl();
  }, []);

  const logout = useCallback(async () => {
    try {
      await postAuthLogout();
    } catch {}
    clearStoredDashboardAuthToken();
    setAuthenticated(false);
    setViewState(DASHBOARD_VIEW_STATES.UNAUTHENTICATED);
    resetProtectedData();
    if (typeof navigate === 'function') {
      navigate('/');
    }
  }, [navigate, resetProtectedData]);

  const singleGuildMode = useMemo(
    () => guilds.length <= 1 || Boolean(String(preferredGuildId || '').trim()),
    [guilds.length, preferredGuildId]
  );
  const canSelectGuild = useMemo(() => guilds.length > 1, [guilds.length]);
  const activeGuildName = useMemo(() => {
    const byId = guilds.find((guild) => String(guild?.id || '') === String(guildId || ''));
    return byId?.name || guilds[0]?.name || 'Guild';
  }, [guildId, guilds]);

  const authenticatedUserSummary = useMemo(() => {
    if (!principal) return null;
    return {
      id: String(principal.id || ''),
      username: String(principal.username || ''),
      displayName: String(principal.displayName || principal.username || ''),
      avatarUrl: String(principal.avatarUrl || '') || null,
      guildCount: Number(principal.guildCount || 0),
      operatorGuildCount: Number(principal.operatorGuildCount || 0),
    };
  }, [principal]);

  const advancedPreferencesCapability = useMemo(() => {
    const fromPreferences = preferencesCapabilities?.advancedDashboardPreferences;
    if (fromPreferences && typeof fromPreferences === 'object') {
      return {
        available: Boolean(fromPreferences.available),
        reasonCode:
          fromPreferences.reasonCode === undefined || fromPreferences.reasonCode === null
            ? null
            : String(fromPreferences.reasonCode || '') || null,
        requiredPlan: String(fromPreferences.requiredPlan || 'pro'),
      };
    }
    const fromFeatureContext = capabilities?.advanced_dashboard_preferences;
    if (fromFeatureContext && typeof fromFeatureContext === 'object') {
      return {
        available: Boolean(fromFeatureContext.allowed),
        reasonCode:
          fromFeatureContext.reasonCode === undefined || fromFeatureContext.reasonCode === null
            ? null
            : String(fromFeatureContext.reasonCode || '') || null,
        requiredPlan: String(fromFeatureContext.requiredPlan || 'pro'),
      };
    }
    return {
      available: false,
      reasonCode: null,
      requiredPlan: 'pro',
    };
  }, [capabilities?.advanced_dashboard_preferences, preferencesCapabilities?.advancedDashboardPreferences]);

  const effectivePlan = useMemo(() => {
    if (plan && typeof plan === 'object') return plan;
    if (overview?.plan && typeof overview.plan === 'object') return overview.plan;
    if (preferencesPlan && typeof preferencesPlan === 'object') return preferencesPlan;
    return {
      status: 'unresolved',
      tier: null,
      source: 'unresolved',
      reasonCode: null,
    };
  }, [overview?.plan, plan, preferencesPlan]);

  return {
    viewState,
    isAuthLoading,
    isProtectedLoading,
    authStatus,
    authError,
    protectedError,
    toast,
    showToast,
    login,
    logout,
    refreshAuth: runAuthBootstrap,
    refreshProtectedData,

    guilds,
    guildId,
    setGuildId,
    canSelectGuild,
    singleGuildMode,
    activeGuildName,

    authenticatedUserSummary,
    session,
    effectivePlan,
    capabilities,
    capabilitySummary,
    advancedPreferencesCapability,
    overview,

    preferences,
    preferencesDraft,
    setPreferencesDraft,
    dismissedNoticeIdsInput,
    setDismissedNoticeIdsInput,
    preferencesSaveState,
    preferencesSaveMessage,
    savePreferences,

    statusCommandSettings,
    statusCommandDetailModeDraft,
    setStatusCommandDetailModeDraft,
    statusCommandSaveState,
    statusCommandSaveMessage,
    saveStatusCommandSettings,
  };
}
