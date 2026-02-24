import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers3, MessageSquare, PencilLine, RotateCcw, Save, X } from 'lucide-react';
import { apiClient, extractApiError, extractRequestId } from '../../lib/apiClient';

const EMPTY_TEMPLATE = {
  mode: 'embed',
  content: '',
  embedTitle: '',
  color: '#BD37FB',
  withIcon: true,
};

const FALLBACK_PREVIEW_VARIABLES = {
  target: '@User',
  reason: 'Sebep',
  caseId: '#1',
  time: '10m',
  limit: '3',
  amount: '2',
  user: '@Moderator',
  guild: 'SunucuAdi',
  channel: '#general',
  command: '/warn',
  prefix: '.',
  args: 'ornek arguman ozeti',
};

function normalizeTemplate(template) {
  if (!template || typeof template !== 'object') return { ...EMPTY_TEMPLATE };
  return {
    mode: template.mode === 'normal' ? 'normal' : 'embed',
    content: String(template.content || '').slice(0, 2000),
    embedTitle: String(template.embedTitle || '').slice(0, 256),
    color: /^#?[0-9a-fA-F]{6}$/.test(String(template.color || '').trim())
      ? (String(template.color || '').trim().startsWith('#') ? String(template.color || '').trim() : `#${String(template.color || '').trim()}`).toUpperCase()
      : EMPTY_TEMPLATE.color,
    withIcon: Boolean(template.withIcon),
  };
}

function replaceKnownVariables(text, variableMap) {
  return String(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    if (!Object.prototype.hasOwnProperty.call(variableMap, key)) return full;
    return String(variableMap[key]);
  });
}

export default function CommandMessageTemplates({ guildId, showToast, commandName = '', onExitCommandEditor = null }) {
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [commands, setCommands] = useState([]);
  const [variables, setVariables] = useState([]);

  const [templateKeys, setTemplateKeys] = useState([]);
  const [storedTemplates, setStoredTemplates] = useState({});
  const [resolvedTemplates, setResolvedTemplates] = useState({});

  const [editorOpen, setEditorOpen] = useState(false);
  const [activeTemplateKey, setActiveTemplateKey] = useState('');
  const [draftTemplate, setDraftTemplate] = useState({ ...EMPTY_TEMPLATE });

  const notify = useCallback(
    (text, type = 'ok', duration = 2200) => {
      if (typeof showToast === 'function') showToast(text, type, duration);
    },
    [showToast]
  );

  const previewVariableMap = useMemo(() => {
    const out = { ...FALLBACK_PREVIEW_VARIABLES };
    (variables || []).forEach((item) => {
      if (!item?.key) return;
      out[item.key] = item.preview || out[item.key] || '';
    });
    return out;
  }, [variables]);

  const lockedCommandName = useMemo(() => String(commandName || '').trim().toLowerCase(), [commandName]);
  const isCommandLocked = Boolean(lockedCommandName);
  const effectiveScope = isCommandLocked ? 'command' : 'global';
  const effectiveCommandName = isCommandLocked ? lockedCommandName : '';

  const loadCatalog = useCallback(async () => {
    if (!guildId) return;
    setCatalogLoading(true);
    try {
      const res = await apiClient.get(`/api/messages/commands/${guildId}`);
      const nextCommands = Array.isArray(res.data?.commands) ? res.data.commands : [];
      const nextVariables = Array.isArray(res.data?.variables) ? res.data.variables : [];

      setCommands(nextCommands);
      setVariables(nextVariables);
    } catch (e) {
      notify(extractApiError(e, 'Mesaj komutlari alinamadi'), 'err', 3200);
    } finally {
      setCatalogLoading(false);
    }
  }, [guildId, notify]);

  const loadTemplates = useCallback(
    async (scope, commandName) => {
      if (!guildId) return;
      if (scope === 'command' && !commandName) return;
      setTemplatesLoading(true);
      try {
        const params = { scope };
        if (scope === 'command') params.commandName = commandName;

        const res = await apiClient.get(`/api/messages/templates/${guildId}`, { params });
        setTemplateKeys(Array.isArray(res.data?.templateKeys) ? res.data.templateKeys : []);
        setStoredTemplates(res.data?.storedTemplates && typeof res.data.storedTemplates === 'object' ? res.data.storedTemplates : {});
        setResolvedTemplates(
          res.data?.resolvedTemplates && typeof res.data.resolvedTemplates === 'object' ? res.data.resolvedTemplates : {}
        );
      } catch (e) {
        notify(extractApiError(e, 'Mesaj sablonlari alinamadi'), 'err', 3200);
      } finally {
        setTemplatesLoading(false);
      }
    },
    [guildId, notify]
  );

  useEffect(() => {
    setEditorOpen(false);
    setActiveTemplateKey('');
    setDraftTemplate({ ...EMPTY_TEMPLATE });
    loadCatalog();
  }, [guildId, loadCatalog]);

  useEffect(() => {
    const scope = effectiveScope;
    const commandName = effectiveCommandName;
    if (!guildId) return;
    if (scope === 'command' && !commandName) return;
    loadTemplates(scope, commandName);
  }, [guildId, effectiveScope, effectiveCommandName, loadTemplates]);

  const openEditorForKey = useCallback(
    (templateKey) => {
      const base = storedTemplates[templateKey] || resolvedTemplates[templateKey] || EMPTY_TEMPLATE;
      setActiveTemplateKey(templateKey);
      setDraftTemplate(normalizeTemplate(base));
      setEditorOpen(true);
    },
    [storedTemplates, resolvedTemplates]
  );

  const activeTemplateMeta = useMemo(
    () => templateKeys.find((item) => item.key === activeTemplateKey) || null,
    [templateKeys, activeTemplateKey]
  );

  const activeTemplateHasOverride = useMemo(
    () => Object.prototype.hasOwnProperty.call(storedTemplates, activeTemplateKey),
    [storedTemplates, activeTemplateKey]
  );

  const previewContent = useMemo(
    () => replaceKnownVariables(draftTemplate.content, previewVariableMap),
    [draftTemplate.content, previewVariableMap]
  );
  const previewTitle = useMemo(
    () => replaceKnownVariables(draftTemplate.embedTitle, previewVariableMap),
    [draftTemplate.embedTitle, previewVariableMap]
  );

  const persistTemplates = useCallback(
    async (nextTemplates, closeModalAfterSave = true) => {
      if (!guildId) return;
      setSaving(true);
      try {
        const payload = {
          scope: effectiveScope,
          templates: nextTemplates,
        };
        if (effectiveScope === 'command') payload.commandName = effectiveCommandName;

        await apiClient.post(`/api/messages/templates/${guildId}`, payload);
        await loadTemplates(effectiveScope, effectiveCommandName);
        notify('Mesaj sablonu kaydedildi', 'ok', 1700);
        if (closeModalAfterSave) setEditorOpen(false);
      } catch (e) {
        const msg = extractApiError(e, 'Mesaj sablonu kaydedilemedi');
        const reqId = extractRequestId(e);
        notify(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
      } finally {
        setSaving(false);
      }
    },
    [guildId, effectiveScope, effectiveCommandName, loadTemplates, notify]
  );

  const handleSaveActiveTemplate = useCallback(async () => {
    if (!activeTemplateKey) return;
    const nextStored = {
      ...storedTemplates,
      [activeTemplateKey]: normalizeTemplate(draftTemplate),
    };
    await persistTemplates(nextStored, true);
  }, [activeTemplateKey, storedTemplates, draftTemplate, persistTemplates]);

  const handleRemoveActiveOverride = useCallback(async () => {
    if (!activeTemplateKey) return;
    const nextStored = { ...storedTemplates };
    delete nextStored[activeTemplateKey];
    await persistTemplates(nextStored, false);
    const nextBase = nextStored[activeTemplateKey] || resolvedTemplates[activeTemplateKey] || EMPTY_TEMPLATE;
    setDraftTemplate(normalizeTemplate(nextBase));
  }, [activeTemplateKey, storedTemplates, resolvedTemplates, persistTemplates]);

  const handleResetScope = useCallback(async () => {
    if (!guildId) return;
    setResetting(true);
    try {
      const payload = { scope: effectiveScope };
      if (effectiveScope === 'command') payload.commandName = effectiveCommandName;
      await apiClient.post(`/api/messages/templates/${guildId}/reset`, payload);
      await loadTemplates(effectiveScope, effectiveCommandName);
      notify('Sablonlar varsayilana sifirlandi', 'ok', 1700);
      setEditorOpen(false);
    } catch (e) {
      const msg = extractApiError(e, 'Sifirlama basarisiz');
      const reqId = extractRequestId(e);
      notify(reqId ? `${msg} (#${reqId})` : msg, 'err', 4200);
    } finally {
      setResetting(false);
    }
  }, [guildId, effectiveScope, effectiveCommandName, loadTemplates, notify]);

  const selectedCommandLabel = useMemo(() => {
    if (!isCommandLocked) return 'Global (Varsayilan)';
    return commands.find((item) => item.name === lockedCommandName)?.label || lockedCommandName;
  }, [isCommandLocked, lockedCommandName, commands]);

  const variableHelp = useMemo(() => {
    const list = Object.keys(previewVariableMap).map((key) => `{${key}}`);
    return list.join(', ');
  }, [previewVariableMap]);

  return (
    <div className="space-y-8 pb-20">
      <div className="bg-[#16162a] p-6 rounded-[2rem] border border-white/5 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-purple-500/20 text-purple-300">
            <Layers3 size={22} />
          </div>
          <div>
            <h2 className="text-xl font-black italic uppercase text-white">Mesaj Ayarlari</h2>
            <p className="text-xs text-gray-400 mt-1">
              Degisken butonu yok. Degiskenleri elle yaz: {variableHelp}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <section className="bg-[#16162a]/90 border border-white/5 rounded-[2rem] p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              {isCommandLocked && onExitCommandEditor ? (
                <button
                  onClick={onExitCommandEditor}
                  className="w-10 h-10 rounded-xl border border-white/15 bg-[#0d0d19] text-white/80 hover:text-white flex items-center justify-center"
                  title="Yetkilere don"
                >
                  <ArrowLeft size={16} />
                </button>
              ) : null}
              <div>
                <h3 className="text-lg font-black italic uppercase tracking-wide text-white">Mesaj Sablonlari</h3>
                <p className="text-xs text-white/60 mt-1">{selectedCommandLabel}</p>
              </div>
            </div>
            <button
              onClick={handleResetScope}
              disabled={resetting || templatesLoading}
              className="px-4 py-2 rounded-xl border border-white/15 bg-[#0d0d19] text-xs font-black uppercase tracking-wider text-white flex items-center gap-2 disabled:opacity-50"
            >
              <RotateCcw size={14} />
              Sifirla
            </button>
          </div>

          {(catalogLoading || templatesLoading) ? (
            <div className="py-14 text-center text-sm text-white/60">Yukleniyor...</div>
          ) : (
            <div className="space-y-3">
              {templateKeys.map((item) => {
                const resolved = normalizeTemplate(resolvedTemplates[item.key] || EMPTY_TEMPLATE);
                const isOverride = Object.prototype.hasOwnProperty.call(storedTemplates, item.key);
                return (
                  <div
                    key={item.key}
                    className="rounded-2xl border border-white/10 bg-[#101022] px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="text-sm font-black text-white">{item.label}</div>
                      <div className="text-xs text-white/50 mt-1">{item.description}</div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="px-2 py-1 rounded-lg text-[10px] uppercase tracking-wider bg-white/10 text-white/80">
                        {resolved.mode === 'embed' ? 'Embed' : 'Normal'}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-lg text-[10px] uppercase tracking-wider ${
                          isOverride ? 'bg-purple-500/20 text-purple-200' : 'bg-white/10 text-white/60'
                        }`}
                      >
                        {isOverride ? 'Override' : 'Global/Default'}
                      </span>
                      <button
                        onClick={() => openEditorForKey(item.key)}
                        className="px-3 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2"
                      >
                        <PencilLine size={14} />
                        Mesaji Duzenle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-[1280px] rounded-[2rem] border border-white/10 bg-[#121228] shadow-[0_40px_80px_rgba(0,0,0,0.55)] overflow-hidden">
            <div className="px-8 py-6 border-b border-white/10 flex items-center justify-between">
              <div className="text-3xl font-black uppercase tracking-tight text-white">Mesaji Duzenle</div>
              <button
                onClick={() => setEditorOpen(false)}
                className="w-10 h-10 rounded-xl border border-white/20 bg-black/20 text-white/80 hover:text-white flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[250px_1fr_1fr]">
              <aside className="border-r border-white/10 p-5 space-y-2 max-h-[620px] overflow-auto">
                {templateKeys.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActiveTemplateKey(item.key);
                      setDraftTemplate(normalizeTemplate(storedTemplates[item.key] || resolvedTemplates[item.key] || EMPTY_TEMPLATE));
                    }}
                    className={`w-full text-left px-4 py-3 rounded-2xl border transition-all ${
                      activeTemplateKey === item.key
                        ? 'bg-purple-600/25 border-purple-400/40 text-white'
                        : 'bg-[#0b0b1a] border-white/10 text-white/70 hover:text-white'
                    }`}
                  >
                    <div className="text-sm font-black">{item.label}</div>
                    <div className="text-[11px] opacity-70 mt-1">{item.description}</div>
                  </button>
                ))}
              </aside>

              <div className="border-r border-white/10 p-6 space-y-5">
                <div className="inline-flex items-center rounded-2xl border border-white/10 bg-[#0d0d1d] p-1">
                  <button
                    onClick={() => setDraftTemplate((prev) => ({ ...prev, mode: 'normal' }))}
                    className={`px-5 py-2 rounded-xl text-sm font-black transition-all ${
                      draftTemplate.mode === 'normal' ? 'bg-purple-600 text-white' : 'text-white/70'
                    }`}
                  >
                    Normal
                  </button>
                  <button
                    onClick={() => setDraftTemplate((prev) => ({ ...prev, mode: 'embed' }))}
                    className={`px-5 py-2 rounded-xl text-sm font-black transition-all ${
                      draftTemplate.mode === 'embed' ? 'bg-purple-600 text-white' : 'text-white/70'
                    }`}
                  >
                    Embed
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-white/60 mb-2">
                    Mesaj
                  </label>
                  <textarea
                    rows={5}
                    value={draftTemplate.content}
                    onChange={(e) => setDraftTemplate((prev) => ({ ...prev, content: e.target.value }))}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-[#0d0d1d] p-4 text-white font-bold text-sm outline-none focus:border-purple-400/50"
                    placeholder="{target} uyarildi. (sebep: {reason}) ({caseId})"
                  />
                  <p className="text-xs text-white/40 mt-2">Degiskenleri elle yaz: {'{target}'} {'{reason}'} {'{caseId}'}</p>
                </div>

                {draftTemplate.mode === 'embed' && (
                  <>
                    <label className="flex items-center gap-3 text-sm font-semibold text-white/80">
                      <button
                        type="button"
                        onClick={() => setDraftTemplate((prev) => ({ ...prev, withIcon: !prev.withIcon }))}
                        className={`w-12 h-7 rounded-full p-1 transition-all ${
                          draftTemplate.withIcon ? 'bg-purple-500' : 'bg-white/15'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            draftTemplate.withIcon ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      Kucuk ikonla gonder
                    </label>

                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-white/60 mb-2">
                        Embed Basligi
                      </label>
                      <input
                        type="text"
                        value={draftTemplate.embedTitle}
                        onChange={(e) => setDraftTemplate((prev) => ({ ...prev, embedTitle: e.target.value }))}
                        className="w-full rounded-2xl border border-white/10 bg-[#0d0d1d] p-3 text-white font-bold text-sm outline-none focus:border-purple-400/50"
                        placeholder="WARN BASARILI"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-white/60 mb-2">Renk</label>
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0d0d1d] p-3">
                        <input
                          type="color"
                          value={draftTemplate.color}
                          onChange={(e) => setDraftTemplate((prev) => ({ ...prev, color: e.target.value.toUpperCase() }))}
                          className="w-10 h-10 rounded-lg border border-white/10 bg-transparent p-0"
                        />
                        <input
                          type="text"
                          value={draftTemplate.color}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            setDraftTemplate((prev) => ({ ...prev, color: raw.startsWith('#') ? raw.toUpperCase() : `#${raw.toUpperCase()}` }));
                          }}
                          className="flex-1 bg-transparent outline-none text-white font-bold text-sm"
                          maxLength={7}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="p-6 flex flex-col">
                <h4 className="text-4xl font-black uppercase tracking-tight text-white/80 mb-4">Canli Onizleme</h4>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 min-h-[320px]">
                  {draftTemplate.mode === 'embed' ? (
                    <div className="rounded-2xl bg-[#0f1020] p-4 border border-white/10">
                      {draftTemplate.withIcon ? (
                        <div
                          className="rounded-xl border border-white/10 bg-[#14142a] p-4"
                          style={{ borderLeft: `4px solid ${draftTemplate.color || '#BD37FB'}` }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-300 to-purple-500" />
                            <div className="text-white/95 font-bold leading-relaxed whitespace-pre-wrap break-words">
                              {previewContent || <span className="text-white/40">Bos mesaj</span>}
                            </div>
                          </div>
                          {previewTitle ? (
                            <div className="mt-3 text-[11px] font-black uppercase tracking-wider text-white/70">
                              {previewTitle}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div
                          className="rounded-xl border border-white/10 bg-[#14142a] p-4"
                          style={{ borderLeft: `4px solid ${draftTemplate.color || '#BD37FB'}` }}
                        >
                          {previewTitle ? <div className="text-sm font-black uppercase text-white mb-2">{previewTitle}</div> : null}
                          <div className="text-white/90 leading-relaxed whitespace-pre-wrap break-words">
                            {previewContent || <span className="text-white/40">Bos mesaj</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-[#0f1020] p-4 border border-white/10">
                      <div className="text-xs text-white/50 mb-3">Reply in #general</div>
                      <div className="inline-block max-w-full rounded-2xl border border-white/10 bg-[#1a1b34] px-4 py-3 text-white whitespace-pre-wrap break-words">
                        {previewContent || <span className="text-white/40">Bos mesaj</span>}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={handleSaveActiveTemplate}
                    disabled={saving}
                    className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Save size={18} />
                    Kaydet
                  </button>
                  {activeTemplateHasOverride ? (
                    <button
                      onClick={handleRemoveActiveOverride}
                      disabled={saving}
                      className="px-4 py-4 rounded-2xl border border-white/20 bg-white/5 text-xs uppercase font-black tracking-wider text-white disabled:opacity-50"
                    >
                      Override Kaldir
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 text-xs text-white/40">
                  Aktif satir: <span className="text-white/70 font-bold">{activeTemplateMeta?.label || '-'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!editorOpen && templateKeys.length === 0 && !catalogLoading && !templatesLoading && (
        <div className="bg-[#16162a]/80 p-6 rounded-[2rem] border border-white/5 text-center text-white/60 text-sm">
          <MessageSquare size={18} className="inline-block mr-2" />
          Bu kapsam icin duzenlenebilir mesaj sablonu bulunamadi.
        </div>
      )}
    </div>
  );
}
