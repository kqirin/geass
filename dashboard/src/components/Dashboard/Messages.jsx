import { useCallback, useEffect, useMemo, useState } from 'react';
import MessagesInfoCard from './messages/MessagesInfoCard';
import MessageGroupCard from './messages/MessageGroupCard';
import MessagesActionBar from './messages/MessagesActionBar';
import { MESSAGE_GROUPS, MESSAGE_VARIABLE_HELP } from './messages/constants';
import { apiClient, extractApiError, extractRequestId } from '../../lib/apiClient';

function buildMessageDraft(resolvedTemplates, keys) {
  const draft = {};
  keys.forEach((key) => {
    draft[key] = resolvedTemplates?.[key]?.content || '';
  });
  return draft;
}

export default function Messages({ guildId, showToast }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resolvedTemplates, setResolvedTemplates] = useState({});
  const [customMessages, setCustomMessages] = useState({});

  const allKeys = useMemo(() => MESSAGE_GROUPS.flatMap((group) => group.items.map((item) => item.key)), []);

  const notify = useCallback(
    (text, type = 'ok', duration = 2200) => {
      if (typeof showToast === 'function') showToast(text, type, duration);
    },
    [showToast]
  );

  const loadGlobalMessages = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/messages/templates/${guildId}`, { params: { scope: 'global' } });
      const nextResolved = res.data?.resolvedTemplates && typeof res.data.resolvedTemplates === 'object' ? res.data.resolvedTemplates : {};
      setResolvedTemplates(nextResolved);
      setCustomMessages(buildMessageDraft(nextResolved, allKeys));
    } catch (e) {
      notify(extractApiError(e, 'Global mesajlar alinamadi'), 'err', 3600);
    } finally {
      setLoading(false);
    }
  }, [guildId, allKeys, notify]);

  useEffect(() => {
    loadGlobalMessages();
  }, [loadGlobalMessages]);

  const updateMessage = (key, value) => {
    setCustomMessages((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = useCallback(async () => {
    if (!guildId) return;
    setSaving(true);
    try {
      const templates = {};
      allKeys.forEach((key) => {
        const base = resolvedTemplates?.[key] || {};
        templates[key] = {
          mode: base.mode === 'normal' ? 'normal' : 'embed',
          content: String(customMessages?.[key] || ''),
          embedTitle: String(base.embedTitle || ''),
          color: String(base.color || '#BD37FB'),
          withIcon: typeof base.withIcon === 'boolean' ? base.withIcon : true,
        };
      });

      await apiClient.post(`/api/messages/templates/${guildId}`, {
        scope: 'global',
        templates,
      });

      await loadGlobalMessages();
      notify('Global mesajlar kaydedildi', 'ok', 1700);
    } catch (e) {
      const msg = extractApiError(e, 'Kaydedilemedi');
      const reqId = extractRequestId(e);
      notify(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    } finally {
      setSaving(false);
    }
  }, [guildId, allKeys, resolvedTemplates, customMessages, loadGlobalMessages, notify]);

  const handleReset = useCallback(async () => {
    if (!guildId) return;
    setResetting(true);
    try {
      await apiClient.post(`/api/messages/templates/${guildId}/reset`, { scope: 'global' });
      await loadGlobalMessages();
      notify('Global mesajlar varsayilana sifirlandi', 'ok', 1700);
    } catch (e) {
      const msg = extractApiError(e, 'Sifirlama basarisiz');
      const reqId = extractRequestId(e);
      notify(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    } finally {
      setResetting(false);
    }
  }, [guildId, loadGlobalMessages, notify]);

  if (loading) {
    return (
      <div className="bg-[#16162a]/80 p-8 rounded-[2rem] border border-white/5 text-center text-white/70">
        Global mesajlar yukleniyor...
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <MessagesInfoCard variableHelp={MESSAGE_VARIABLE_HELP} />

      <div className="grid grid-cols-1 gap-8">
        {MESSAGE_GROUPS.map((group) => (
          <MessageGroupCard
            key={group.title}
            group={group}
            customMessages={customMessages}
            onChange={updateMessage}
          />
        ))}
      </div>

      <div className={saving || resetting ? 'opacity-70 pointer-events-none' : ''}>
        <MessagesActionBar onReset={handleReset} onSave={handleSave} />
      </div>
    </div>
  );
}
