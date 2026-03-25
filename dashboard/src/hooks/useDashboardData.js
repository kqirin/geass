import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, extractApiError, extractRequestId } from '../lib/apiClient.js';
import { createLatestRequestGate } from '../lib/latestRequestGate.js';
import { normalizeOptionalHttpUrl } from '../components/Dashboard/embed/urlValidation.js';
import { extractModerationSettingsPayload } from './moderationSettingsState.js';

export const STATIC_SETTINGS_DEFAULT_META = {
  readOnly: true,
  source: 'config',
};

export const BOT_PRESENCE_DEFAULT_SETTINGS = {
  enabled: true,
  type: 'CUSTOM',
  text: 'All Hail Lelouch!',
};

export const BOT_PRESENCE_DEFAULT_META = {
  maxTextLength: 128,
  allowedTypes: ['CUSTOM', 'PLAYING', 'LISTENING', 'WATCHING', 'COMPETING'],
  scope: 'global',
  readOnly: true,
  source: 'config',
};

export const BOT_PRESENCE_LOAD_STATES = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
};

export function isBotPresenceReady(loadState) {
  return String(loadState?.status || '') === BOT_PRESENCE_LOAD_STATES.READY;
}

export function resolveInitialGuildId(singleGuildId = '', guilds = []) {
  const configuredSingleGuildId = String(singleGuildId || '').trim();
  const list = Array.isArray(guilds) ? guilds : [];

  if (configuredSingleGuildId) {
    if (list.length === 0) return configuredSingleGuildId;
    const hasConfiguredGuild = list.some(
      (guild) => String(guild?.id || '').trim() === configuredSingleGuildId
    );
    return hasConfiguredGuild ? configuredSingleGuildId : String(list[0]?.id || '').trim();
  }

  return String(list[0]?.id || '').trim();
}

export function shouldShowGuildSelector(singleGuildId = '', guilds = []) {
  return !String(singleGuildId || '').trim() && Array.isArray(guilds) && guilds.length > 1;
}

export function createInitialReactionForm(guildId = '') {
  return {
    id: null,
    guildId: String(guildId || '').trim(),
    channelId: '',
    messageId: '',
    emojiType: 'unicode',
    emojiName: '✅',
    emojiId: '',
    triggerMode: 'TOGGLE',
    enabled: true,
    cooldownSeconds: 5,
    onlyOnce: false,
    groupKey: '',
    allowedRoles: [],
    excludedRoles: [],
    actions: [{ type: 'ROLE_ADD', payload: { roleId: '' } }],
  };
}

export function useDashboardData({ navigate }) {
  const [activeTab, setActiveTab] = useState('reactionActions');
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const activeGuildRef = useRef('');
  const guildDataGateRef = useRef(createLatestRequestGate());
  const botPresenceGateRef = useRef(createLatestRequestGate());
  const reactionDataGateRef = useRef(createLatestRequestGate());

  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState('');
  const [systemHealth, setSystemHealth] = useState({
    ok: true,
    checks: { db: true, discord: true },
    features: {},
  });
  const [roles, setRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [modSettings, setModSettings] = useState({});
  const [settingsMeta, setSettingsMeta] = useState({ ...STATIC_SETTINGS_DEFAULT_META });
  const [botPresenceSettings, setBotPresenceSettings] = useState({ ...BOT_PRESENCE_DEFAULT_SETTINGS });
  const [botPresenceMeta, setBotPresenceMeta] = useState({ ...BOT_PRESENCE_DEFAULT_META });
  const [botPresenceLoadState, setBotPresenceLoadState] = useState({
    status: BOT_PRESENCE_LOAD_STATES.IDLE,
    error: null,
  });
  const [reactionRules, setReactionRules] = useState([]);
  const [reactionHealth, setReactionHealth] = useState({ ok: true, issues: [], ruleIssues: [] });
  const [emojis, setEmojis] = useState([]);
  const [reactionForm, setReactionForm] = useState(() => createInitialReactionForm());

  const [embedData, setEmbedData] = useState({
    channelId: '',
    content: '',
    title: '',
    titleUrl: '',
    description: '',
    color: '#5865F2',
    image: '',
  });

  const metaEnv = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {};
  const singleGuildId = metaEnv.VITE_SINGLE_GUILD_ID || metaEnv.VITE_GUILD_ID || '';

  const showToast = useCallback((text, type = 'ok', duration = 2200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, text });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const loadBotPresence = useCallback(async (targetGuildId) => {
    const resolvedGuildId = String(targetGuildId || '').trim();
    if (!resolvedGuildId) return;
    const request = botPresenceGateRef.current.begin(resolvedGuildId);
    setBotPresenceLoadState({
      status: BOT_PRESENCE_LOAD_STATES.LOADING,
      error: null,
    });
    try {
      const res = await apiClient.get('/api/bot-presence', {
        params: { guildId: resolvedGuildId },
      });
      if (!request.isCurrent() || activeGuildRef.current !== resolvedGuildId) return;
      const nextSettings = res.data?.settings || BOT_PRESENCE_DEFAULT_SETTINGS;
      const nextMeta = res.data?.meta || BOT_PRESENCE_DEFAULT_META;
      setBotPresenceSettings({ ...BOT_PRESENCE_DEFAULT_SETTINGS, ...nextSettings });
      setBotPresenceMeta({ ...BOT_PRESENCE_DEFAULT_META, ...nextMeta });
      setBotPresenceLoadState({
        status: BOT_PRESENCE_LOAD_STATES.READY,
        error: null,
      });
    } catch (e) {
      if (!request.isCurrent() || activeGuildRef.current !== resolvedGuildId) return;
      const msg = extractApiError(e, 'Bot durumu yuklenemedi');
      const reqId = extractRequestId(e);
      const detailed = reqId ? `${msg} (#${reqId})` : msg;
      setBotPresenceLoadState({
        status: BOT_PRESENCE_LOAD_STATES.ERROR,
        error: detailed,
      });
      showToast(detailed, 'err', 4200);
    }
  }, [showToast]);

  useEffect(() => {
    document.title = 'GEASS';
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const res = await apiClient.get('/api/auth/session');
        const list = res.data?.guilds || [];
        setGuilds(list);

        const initialGuildId = resolveInitialGuildId(singleGuildId, list);
        activeGuildRef.current = initialGuildId;
        guildDataGateRef.current.switchKey(initialGuildId);
        botPresenceGateRef.current.switchKey(initialGuildId);
        reactionDataGateRef.current.switchKey(initialGuildId);
        setGuildId(initialGuildId);
        await loadBotPresence(initialGuildId);
      } catch {
        navigate('/');
      }
    };

    loadSession();
  }, [navigate, singleGuildId, loadBotPresence]);

  const canSelectGuild = useMemo(
    () => shouldShowGuildSelector(singleGuildId, guilds),
    [singleGuildId, guilds]
  );
  const singleGuildMode = useMemo(
    () => Boolean(String(singleGuildId || '').trim()) || guilds.length <= 1,
    [singleGuildId, guilds.length]
  );
  const activeGuildName = useMemo(
    () => guilds.find((guild) => String(guild?.id || '') === String(guildId || ''))?.name || guilds[0]?.name || 'Sunucu',
    [guilds, guildId]
  );

  const loadSystemHealth = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/health');
      setSystemHealth(res.data || { ok: false, checks: { db: false, discord: false }, features: {} });
    } catch {
      setSystemHealth({ ok: false, checks: { db: false, discord: false }, features: {} });
    }
  }, []);

  const loadGuildData = useCallback(
    async (id) => {
      if (!id) return;
      const request = guildDataGateRef.current.begin(id);
      try {
        const [rolesRes, channelsRes, settingsRes] = await Promise.all([
          apiClient.get(`/api/guilds/${id}/roles`),
          apiClient.get(`/api/guilds/${id}/channels`),
          apiClient.get(`/api/settings/${id}`),
        ]);
        if (!request.isCurrent() || activeGuildRef.current !== id) return;

        setRoles(rolesRes.data || []);
        setChannels(channelsRes.data || []);
        const emojiRes = await apiClient.get(`/api/guilds/${id}/emojis`);
        if (!request.isCurrent() || activeGuildRef.current !== id) return;
        setEmojis(emojiRes.data || []);

        setModSettings(extractModerationSettingsPayload(settingsRes.data));
        setSettingsMeta({
          ...STATIC_SETTINGS_DEFAULT_META,
          ...(settingsRes.data?.meta || {}),
        });
        const [ruleRes, healthRes] = await Promise.all([
          apiClient.get('/api/reaction-rules', { params: { guildId: id } }),
          apiClient.get('/api/reaction-rules/health', { params: { guildId: id } }),
        ]);
        if (!request.isCurrent() || activeGuildRef.current !== id) return;
        setReactionRules(ruleRes.data || []);
        setReactionHealth(healthRes.data || { ok: true, issues: [], ruleIssues: [] });
        setReactionForm((prev) => ({ ...prev, guildId: id }));
        await loadSystemHealth();
      } catch (e) {
        const msg = extractApiError(e, 'Güncellenemedi');
        if (!request.isCurrent() || activeGuildRef.current !== id) return;
        const reqId = extractRequestId(e);
        showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 3600);
      }
    },
    [showToast, loadSystemHealth]
  );

  useEffect(() => {
    if (!guildId) return;
    activeGuildRef.current = guildId;
    guildDataGateRef.current.switchKey(guildId);
    botPresenceGateRef.current.switchKey(guildId);
    reactionDataGateRef.current.switchKey(guildId);
    loadGuildData(guildId);
    loadBotPresence(guildId);
  }, [guildId, loadGuildData, loadBotPresence]);

  useEffect(() => {
    let active = true;

    const pollHealth = () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      loadSystemHealth();
    };

    const handleVisibilityChange = () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadSystemHealth();
      }
    };

    pollHealth();
    const timer = setInterval(pollHealth, 60_000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      active = false;
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [loadSystemHealth]);

  const sendEmbed = useCallback(async () => {
    if (!guildId || !embedData.channelId) return;
    const titleUrlCheck = normalizeOptionalHttpUrl(embedData.titleUrl);
    if (!titleUrlCheck.ok) {
      showToast(titleUrlCheck.error, 'err', 3200);
      return;
    }

    try {
      await apiClient.post('/api/embed/send', {
        guildId,
        channelId: embedData.channelId,
        title: embedData.title,
        embedTitleUrl: titleUrlCheck.value,
        description: embedData.description,
        color: embedData.color,
        imageUrl: embedData.image,
        content: embedData.content,
      });
      showToast('Gönderildi', 'ok', 1500);
    } catch (e) {
      showToast(extractApiError(e, 'Gönderilemedi'), 'err', 3000);
    }
  }, [guildId, embedData, showToast]);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/api/auth/logout', {});
    } catch {}
    navigate('/');
  }, [navigate]);

  const loadReactionData = useCallback(async (id) => {
    if (!id) return;
    const request = reactionDataGateRef.current.begin(id);
    const [ruleRes, healthRes, emojiRes] = await Promise.all([
      apiClient.get('/api/reaction-rules', { params: { guildId: id } }),
      apiClient.get('/api/reaction-rules/health', { params: { guildId: id } }),
      apiClient.get(`/api/guilds/${id}/emojis`),
    ]);
    if (!request.isCurrent() || activeGuildRef.current !== id) return;
    setReactionRules(ruleRes.data || []);
    setReactionHealth(healthRes.data || { ok: true, issues: [], ruleIssues: [] });
    setEmojis(emojiRes.data || []);
  }, []);

  const resetReactionForm = useCallback(() => {
    setReactionForm(createInitialReactionForm(guildId));
  }, [guildId]);

  const editReactionRule = useCallback((rule) => {
    setReactionForm({
      id: rule.id,
      guildId: rule.guildId,
      channelId: rule.channelId,
      messageId: rule.messageId,
      emojiType: rule.emojiType || 'unicode',
      emojiName: rule.emojiName || '',
      emojiId: rule.emojiId || '',
      triggerMode: rule.triggerMode || 'TOGGLE',
      enabled: Boolean(rule.enabled),
      cooldownSeconds: Number(rule.cooldownSeconds || 0),
      onlyOnce: Boolean(rule.onlyOnce),
      groupKey: rule.groupKey || '',
      allowedRoles: Array.isArray(rule.allowedRoles) ? rule.allowedRoles : [],
      excludedRoles: Array.isArray(rule.excludedRoles) ? rule.excludedRoles : [],
      actions:
        Array.isArray(rule.actions) && rule.actions.length > 0
          ? rule.actions
          : [{ type: 'ROLE_ADD', payload: { roleId: '' } }],
    });
  }, []);

  const saveReactionRule = useCallback(async () => {
    if (!guildId) return;
    const payload = { ...reactionForm, guildId };
    const isSnowflake = (value) => /^\d{5,32}$/.test(String(value || '').trim());

    if (!isSnowflake(payload.channelId)) {
      showToast('Kanal seçimi geçersiz', 'err', 3200);
      return;
    }
    if (!isSnowflake(payload.messageId)) {
      showToast('Mesaj ID geçersiz', 'err', 3200);
      return;
    }
    if (payload.emojiType === 'custom' && !isSnowflake(payload.emojiId)) {
      showToast('Custom emoji seçimi geçersiz', 'err', 3200);
      return;
    }
    if (payload.emojiType === 'unicode' && !String(payload.emojiName || '').trim()) {
      showToast('Unicode emoji boş olamaz', 'err', 3200);
      return;
    }
    if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
      showToast('En az bir aksiyon gerekli', 'err', 3200);
      return;
    }

    for (const action of payload.actions) {
      if (!action?.type) {
        showToast('Aksiyon tipi eksik', 'err', 3200);
        return;
      }
      if (
        (action.type === 'ROLE_ADD' || action.type === 'ROLE_REMOVE') &&
        !isSnowflake(action?.payload?.roleId)
      ) {
        showToast('Rol aksiyonu için rol seçilmeli', 'err', 3200);
        return;
      }
      if (
        (action.type === 'DM_SEND' || action.type === 'REPLY') &&
        !String(action?.payload?.text || '').trim()
      ) {
        showToast('Mesaj aksiyonu boş olamaz', 'err', 3200);
        return;
      }
      if (action.type === 'CHANNEL_LINK' && !isSnowflake(action?.payload?.channelId)) {
        showToast('Kanal link aksiyonu için kanal seçilmeli', 'err', 3200);
        return;
      }
      if (
        action.type === 'RUN_INTERNAL_COMMAND' &&
        String(action?.payload?.command || '').trim().toLowerCase() !== 'partner-bilgi'
      ) {
        showToast('Ic komut whitelist disi', 'err', 3200);
        return;
      }
    }

    try {
      let warning = null;
      if (reactionForm.id) {
        const res = await apiClient.put(`/api/reaction-rules/${reactionForm.id}`, payload);
        warning = res?.data?.warning || null;
      } else {
        const res = await apiClient.post('/api/reaction-rules', payload);
        warning = res?.data?.warning || null;
      }
      await loadReactionData(guildId);
      showToast(
        warning ? `Kural kaydedildi, not: ${warning}` : 'Tepki kuralı kaydedildi',
        warning ? 'err' : 'ok',
        warning ? 3600 : 1800
      );
      resetReactionForm();
    } catch (e) {
      const msg = extractApiError(e, 'Tepki kuralı kaydedilemedi');
      const reqId = extractRequestId(e);
      showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    }
  }, [guildId, reactionForm, loadReactionData, showToast, resetReactionForm]);

  const deleteReactionRule = useCallback(
    async (ruleId) => {
      if (!guildId || !ruleId) return;
      try {
        const res = await apiClient.delete(`/api/reaction-rules/${ruleId}`);
        await loadReactionData(guildId);
        const warning = res?.data?.warning || null;
        showToast(
          warning ? `Kural silindi, not: ${warning}` : 'Kural silindi',
          warning ? 'err' : 'ok',
          warning ? 3600 : 1500
        );
      } catch (e) {
        const msg = extractApiError(e, 'Kural silinemedi');
        const reqId = extractRequestId(e);
        showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
      }
    },
    [guildId, loadReactionData, showToast]
  );

  const toggleReactionRuleEnabled = useCallback(
    async (rule) => {
      if (!rule?.id || !guildId) return;
      try {
        await apiClient.put(`/api/reaction-rules/${rule.id}`, {
          ...rule,
          guildId,
          enabled: !Boolean(rule.enabled),
        });
        await loadReactionData(guildId);
      } catch (e) {
        const msg = extractApiError(e, 'Durum değiştirilemedi');
        const reqId = extractRequestId(e);
        showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
      }
    },
    [guildId, loadReactionData, showToast]
  );

  const testReactionRule = useCallback(
    async (ruleId) => {
      if (!ruleId) return;
      try {
        const res = await apiClient.post(`/api/reaction-rules/${ruleId}/test`, {});
        const manageable = res?.data?.requesterCheck?.manageable;
        if (manageable === false) {
          showToast('Test: Bot bu hesapta rol işlemi yapamıyor (rol hiyerarşisi)', 'err', 4200);
        } else {
          showToast('Kural testi tamamlandı (dry-run)', 'ok', 1800);
        }
        await loadReactionData(guildId);
      } catch (e) {
        const msg = extractApiError(e, 'Test başarısız');
        const reqId = extractRequestId(e);
        showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
      }
    },
    [guildId, loadReactionData, showToast]
  );

  return {
    showToast,
    activeTab,
    setActiveTab,
    toast,
    guilds,
    guildId,
    setGuildId,
    activeGuildName,
    singleGuildMode,
    systemHealth,
    roles,
    channels,
    modSettings,
    settingsMeta,
    botPresenceSettings,
    botPresenceMeta,
    botPresenceLoadState,
    reactionRules,
    reactionHealth,
    emojis,
    reactionForm,
    setReactionForm,
    embedData,
    setEmbedData,
    canSelectGuild,
    loadReactionData,
    saveReactionRule,
    deleteReactionRule,
    toggleReactionRuleEnabled,
    editReactionRule,
    resetReactionForm,
    testReactionRule,
    sendEmbed,
    logout,
  };
}
