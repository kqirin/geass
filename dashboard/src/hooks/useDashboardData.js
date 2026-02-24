import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, extractApiError, extractRequestId } from '../lib/apiClient';

export function useDashboardData({ navigate }) {
  const [activeTab, setActiveTab] = useState('moderation');
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState('');
  const [systemHealth, setSystemHealth] = useState({
    ok: true,
    checks: { db: true, discord: true },
    features: {},
  });
  const [roles, setRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [modSettings, setModSettings] = useState({ custom_messages: {} });
  const [weeklySettings, setWeeklySettings] = useState({
    enabled: false,
    awardRoleId: null,
    announcementChannelId: null,
    announcementMessage: '',
    timezone: 'Europe/Istanbul',
    weekStartDow: 1,
    minimumPoints: 20,
    tieBreakMode: 'moderation_first',
    eligibleRoles: [],
    excludedRoles: [],
    weights: { command: 1, warn: 1, mute: 2, vcmute: 2, jail: 3, kick: 3, ban: 5 },
    spamGuard: { commandCooldownSec: 6, duplicatePenaltyPoints: 1 },
  });
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState([]);
  const [weeklyHistory, setWeeklyHistory] = useState([]);
  const [reactionRules, setReactionRules] = useState([]);
  const [reactionHealth, setReactionHealth] = useState({ ok: true, issues: [], ruleIssues: [] });
  const [emojis, setEmojis] = useState([]);
  const [reactionForm, setReactionForm] = useState({
    id: null,
    guildId: '',
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
  });

  const [embedData, setEmbedData] = useState({
    channelId: '',
    content: '',
    title: '',
    description: '',
    color: '#5865F2',
    image: '',
  });

  const singleGuildId = import.meta.env.VITE_SINGLE_GUILD_ID || import.meta.env.VITE_GUILD_ID || '';

  const showToast = useCallback((text, type = 'ok', duration = 2200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, text });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => {
    document.title = 'AURI';
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

        if (singleGuildId) setGuildId(singleGuildId);
        else setGuildId(list?.[0]?.id || '');
      } catch {
        navigate('/');
      }
    };

    loadSession();
  }, [navigate, singleGuildId]);

  const canSelectGuild = useMemo(() => !singleGuildId && guilds.length > 1, [singleGuildId, guilds.length]);

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
      try {
        const [rolesRes, channelsRes, settingsRes] = await Promise.all([
          apiClient.get(`/api/guilds/${id}/roles`),
          apiClient.get(`/api/guilds/${id}/channels`),
          apiClient.get(`/api/settings/${id}`),
        ]);

        setRoles(rolesRes.data || []);
        setChannels(channelsRes.data || []);
        setEmojis((await apiClient.get(`/api/guilds/${id}/emojis`)).data || []);

        const s = settingsRes.data || { custom_messages: {} };
        setModSettings({ ...s, custom_messages: s.custom_messages || {} });

        const [weeklyCfgRes, weeklyLbRes, weeklyHistoryRes] = await Promise.all([
          apiClient.get(`/api/weekly-staff/${id}/config`),
          apiClient.get(`/api/weekly-staff/${id}/leaderboard`),
          apiClient.get(`/api/weekly-staff/${id}/history`),
        ]);
        setWeeklySettings(weeklyCfgRes.data || {});
        setWeeklyLeaderboard(weeklyLbRes.data?.list || []);
        setWeeklyHistory(weeklyHistoryRes.data || []);
        const [ruleRes, healthRes] = await Promise.all([
          apiClient.get('/api/reaction-rules', { params: { guildId: id } }),
          apiClient.get('/api/reaction-rules/health', { params: { guildId: id } }),
        ]);
        setReactionRules(ruleRes.data || []);
        setReactionHealth(healthRes.data || { ok: true, issues: [], ruleIssues: [] });
        setReactionForm((prev) => ({ ...prev, guildId: id }));
        await loadSystemHealth();
      } catch (e) {
        const msg = extractApiError(e, 'Guncellenemedi');
        const reqId = extractRequestId(e);
        showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 3600);
      }
    },
    [showToast, loadSystemHealth]
  );

  useEffect(() => {
    if (!guildId) return;
    loadGuildData(guildId);
  }, [guildId, loadGuildData]);

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

  const saveSettings = useCallback(async () => {
    if (!guildId) return;

    try {
      await apiClient.post(`/api/settings/${guildId}`, modSettings);
      showToast('Kaydedildi', 'ok', 1500);
    } catch (e) {
      const msg = extractApiError(e, 'Kaydedilemedi');
      const reqId = extractRequestId(e);
      showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    }
  }, [guildId, modSettings, showToast]);

  const sendEmbed = useCallback(async () => {
    if (!guildId || !embedData.channelId) return;

    try {
      await apiClient.post('/api/embed/send', {
        guildId,
        channelId: embedData.channelId,
        title: embedData.title,
        description: embedData.description,
        color: embedData.color,
        imageUrl: embedData.image,
        content: embedData.content,
      });
      showToast('Gonderildi', 'ok', 1500);
    } catch (e) {
      showToast(extractApiError(e, 'Gonderilemedi'), 'err', 3000);
    }
  }, [guildId, embedData, showToast]);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/api/auth/logout', {});
    } catch {}
    navigate('/');
  }, [navigate]);

  const loadWeeklyStaffData = useCallback(async (id) => {
    if (!id) return;
    const [weeklyCfgRes, weeklyLbRes, weeklyHistoryRes] = await Promise.all([
      apiClient.get(`/api/weekly-staff/${id}/config`),
      apiClient.get(`/api/weekly-staff/${id}/leaderboard`),
      apiClient.get(`/api/weekly-staff/${id}/history`),
    ]);
    setWeeklySettings(weeklyCfgRes.data || {});
    setWeeklyLeaderboard(weeklyLbRes.data?.list || []);
    setWeeklyHistory(weeklyHistoryRes.data || []);
  }, []);

  const saveWeeklySettings = useCallback(async () => {
    if (!guildId) return;
    try {
      await apiClient.post(`/api/weekly-staff/${guildId}/config`, weeklySettings);
      await loadWeeklyStaffData(guildId);
      showToast('Haftalik ayarlar kaydedildi', 'ok', 1800);
    } catch (e) {
      const msg = extractApiError(e, 'Haftalik ayarlar kaydedilemedi');
      const reqId = extractRequestId(e);
      showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    }
  }, [guildId, weeklySettings, loadWeeklyStaffData, showToast]);

  const runWeeklySelection = useCallback(async () => {
    if (!guildId) return;
    try {
      const res = await apiClient.post(`/api/weekly-staff/${guildId}/run`, {});
      await loadWeeklyStaffData(guildId);
      const reason = res?.data?.result?.reason;
      if (reason === 'success') showToast('Kazanan secildi, rol/duyuru islemi denendi', 'ok', 2200);
      else if (reason === 'success_with_role_errors') {
        const failures = res?.data?.result?.roleAssign || [];
        const first = failures.find((x) => !x.ok);
        const code = first?.reason || 'unknown';
        showToast(`Kazanan secildi ama rol verilemedi: ${code}`, 'err', 4200);
      } else if (reason === 'already_selected') showToast('Bu hafta zaten secim yapilmis', 'ok', 2200);
      else if (reason === 'no_candidates') showToast('Kosulu saglayan aday yok', 'err', 2600);
      else if (reason === 'disabled') showToast('Sistem kapali, once AC', 'err', 2600);
      else showToast('Haftalik secim tetiklendi', 'ok', 1800);
    } catch (e) {
      const msg = extractApiError(e, 'Haftalik secim basarisiz');
      const reqId = extractRequestId(e);
      showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    }
  }, [guildId, loadWeeklyStaffData, showToast]);

  const toggleWeeklyEnabled = useCallback(async () => {
    if (!guildId) return;
    const next = !Boolean(weeklySettings?.enabled);
    try {
      await apiClient.post(`/api/weekly-staff/${guildId}/config`, {
        ...weeklySettings,
        enabled: next,
      });
      await loadWeeklyStaffData(guildId);
      showToast(next ? 'Haftalik sistem acildi' : 'Haftalik sistem kapatildi', 'ok', 1800);
    } catch (e) {
      const msg = extractApiError(e, 'Durum degistirilemedi');
      const reqId = extractRequestId(e);
      showToast(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    }
  }, [guildId, weeklySettings, loadWeeklyStaffData, showToast]);

  const loadReactionData = useCallback(async (id) => {
    if (!id) return;
    const [ruleRes, healthRes, emojiRes] = await Promise.all([
      apiClient.get('/api/reaction-rules', { params: { guildId: id } }),
      apiClient.get('/api/reaction-rules/health', { params: { guildId: id } }),
      apiClient.get(`/api/guilds/${id}/emojis`),
    ]);
    setReactionRules(ruleRes.data || []);
    setReactionHealth(healthRes.data || { ok: true, issues: [], ruleIssues: [] });
    setEmojis(emojiRes.data || []);
  }, []);

  const resetReactionForm = useCallback(() => {
    setReactionForm({
      id: null,
      guildId,
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
    });
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
      showToast('Kanal secimi gecersiz', 'err', 3200);
      return;
    }
    if (!isSnowflake(payload.messageId)) {
      showToast('Mesaj ID gecersiz', 'err', 3200);
      return;
    }
    if (payload.emojiType === 'custom' && !isSnowflake(payload.emojiId)) {
      showToast('Custom emoji secimi gecersiz', 'err', 3200);
      return;
    }
    if (payload.emojiType === 'unicode' && !String(payload.emojiName || '').trim()) {
      showToast('Unicode emoji bos olamaz', 'err', 3200);
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
        showToast('Rol aksiyonu icin rol secilmeli', 'err', 3200);
        return;
      }
      if (
        (action.type === 'DM_SEND' || action.type === 'REPLY') &&
        !String(action?.payload?.text || '').trim()
      ) {
        showToast('Mesaj aksiyonu bos olamaz', 'err', 3200);
        return;
      }
      if (action.type === 'CHANNEL_LINK' && !isSnowflake(action?.payload?.channelId)) {
        showToast('Kanal link aksiyonu icin kanal secilmeli', 'err', 3200);
        return;
      }
    }

    try {
      let warning = null;
      if (reactionForm.id) {
        const res = await apiClient.put(`/api/reaction-rules/${reactionForm.id}`, payload);
        warning = res?.data?.warning || null;
      } else {
        await apiClient.post('/api/reaction-rules', payload);
      }
      await loadReactionData(guildId);
      showToast(
        warning ? `Kural kaydedildi, not: ${warning}` : 'Tepki kurali kaydedildi',
        warning ? 'err' : 'ok',
        warning ? 3600 : 1800
      );
      resetReactionForm();
    } catch (e) {
      const msg = extractApiError(e, 'Tepki kurali kaydedilemedi');
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
        const msg = extractApiError(e, 'Durum degistirilemedi');
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
          showToast('Test: Bot bu hesapta rol islemi yapamiyor (rol hiyerarsisi)', 'err', 4200);
        } else {
          showToast('Kural testi tamamlandi (dry-run)', 'ok', 1800);
        }
        await loadReactionData(guildId);
      } catch (e) {
        const msg = extractApiError(e, 'Test basarisiz');
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
    systemHealth,
    roles,
    channels,
    modSettings,
    setModSettings,
    weeklySettings,
    setWeeklySettings,
    weeklyLeaderboard,
    weeklyHistory,
    reactionRules,
    reactionHealth,
    emojis,
    reactionForm,
    setReactionForm,
    embedData,
    setEmbedData,
    canSelectGuild,
    saveSettings,
    saveWeeklySettings,
    runWeeklySelection,
    toggleWeeklyEnabled,
    loadWeeklyStaffData,
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
