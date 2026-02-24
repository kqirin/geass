import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
const DEFAULT_PRIVATE_CONFIG = {
  enabled: false,
  hubChannelId: null,
  requiredRoleId: null,
  categoryId: null,
};

function isSnowflake(value) {
  return /^\d{5,32}$/.test(String(value || '').trim());
}

export function useVcController(guildId) {
  const [groups, setGroups] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [status, setStatus] = useState({ connected: false, channelId: null, channelName: null });
  const [privateConfig, setPrivateConfig] = useState(DEFAULT_PRIVATE_CONFIG);
  const [busy, setBusy] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [toast, setToast] = useState(null);

  const allChannels = useMemo(() => {
    const out = [];
    for (const g of groups) for (const ch of g.channels || []) out.push(ch);
    return out;
  }, [groups]);

  const selectedName = allChannels.find((c) => c.id === selectedChannelId)?.name;

  const load = useCallback(async () => {
    if (!guildId) return;

    try {
      const [chRes, stRes, cfgRes] = await Promise.all([
        axios.get(`${API_BASE}/api/vc/voice-channels/${guildId}`, { withCredentials: true }),
        axios.get(`${API_BASE}/api/vc/status/${guildId}`, { withCredentials: true }),
        axios
          .get(`${API_BASE}/api/vc/private/${guildId}/config`, { withCredentials: true })
          .catch(() => ({ data: DEFAULT_PRIVATE_CONFIG })),
      ]);

      setGroups(chRes.data || []);
      setStatus(stRes.data || { connected: false, channelId: null, channelName: null });
      setPrivateConfig({ ...DEFAULT_PRIVATE_CONFIG, ...(cfgRes.data || {}) });

      const connectedId = stRes.data?.channelId;
      const firstId = chRes.data?.[0]?.channels?.[0]?.id || '';
      setSelectedChannelId(connectedId || firstId);
    } catch {
      setToast({ type: 'err', text: 'VC verileri cekilemedi (401 ise cookie/withCredentials kontrol et).' });
    }
  }, [guildId]);

  useEffect(() => {
    load();
  }, [load]);

  const connect = useCallback(async () => {
    if (!guildId || !selectedChannelId) return;

    setBusy(true);
    setToast(null);
    try {
      const res = await axios.post(
        `${API_BASE}/api/vc/connect/${guildId}`,
        { channelId: selectedChannelId },
        { withCredentials: true }
      );
      setStatus(res.data?.status || { connected: true, channelId: selectedChannelId });
      setToast({ type: 'ok', text: 'Bot ses kanalina baglandi.' });
    } catch (e) {
      setToast({ type: 'err', text: e?.response?.data?.error || 'Baglanilamadi.' });
    } finally {
      setBusy(false);
    }
  }, [guildId, selectedChannelId]);

  const disconnect = useCallback(async () => {
    if (!guildId) return;

    setBusy(true);
    setToast(null);
    try {
      const res = await axios.post(`${API_BASE}/api/vc/disconnect/${guildId}`, {}, { withCredentials: true });
      setStatus(res.data?.status || { connected: false, channelId: null, channelName: null });
      setToast({ type: 'ok', text: 'Baglanti kesildi.' });
    } catch (e) {
      setToast({ type: 'err', text: e?.response?.data?.error || 'Baglanti kesilemedi.' });
    } finally {
      setBusy(false);
    }
  }, [guildId]);

  const savePrivateConfig = useCallback(async () => {
    if (!guildId) return;
    setSavingConfig(true);
    setToast(null);

    try {
      const payload = {
        enabled: Boolean(privateConfig?.enabled),
        hubChannelId: privateConfig?.hubChannelId || null,
        requiredRoleId: privateConfig?.requiredRoleId || null,
        categoryId: privateConfig?.categoryId || null,
      };

      if (payload.enabled) {
        if (!isSnowflake(payload.hubChannelId) || !isSnowflake(payload.requiredRoleId)) {
          setToast({ type: 'err', text: 'Aktif durumda hub kanali ve gerekli rol secilmeli.' });
          return;
        }
      }

      const res = await axios.post(`${API_BASE}/api/vc/private/${guildId}/config`, payload, {
        withCredentials: true,
      });
      setPrivateConfig({ ...DEFAULT_PRIVATE_CONFIG, ...(res.data?.config || payload) });
      setToast({ type: 'ok', text: 'Ozel oda ayarlari kaydedildi.' });
    } catch (e) {
      setToast({ type: 'err', text: e?.response?.data?.error || 'Ozel oda ayarlari kaydedilemedi.' });
    } finally {
      setSavingConfig(false);
    }
  }, [guildId, privateConfig]);

  return {
    groups,
    selectedChannelId,
    setSelectedChannelId,
    status,
    privateConfig,
    setPrivateConfig,
    busy,
    savingConfig,
    toast,
    selectedName,
    load,
    connect,
    disconnect,
    savePrivateConfig,
  };
}
