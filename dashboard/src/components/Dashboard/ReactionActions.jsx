import { useMemo, useState } from 'react';

const ACTION_TYPES = [
  'ROLE_ADD',
  'ROLE_REMOVE',
  'DM_SEND',
  'REPLY',
  'CHANNEL_LINK',
  'RUN_INTERNAL_COMMAND',
  'REMOVE_OTHER_REACTIONS_IN_GROUP',
];

const INTERNAL_COMMAND_OPTIONS = [
  { value: 'partner-bilgi', label: 'partner-bilgi' },
];

const ACTION_LABELS = {
  ROLE_ADD: 'Rol Ver',
  ROLE_REMOVE: 'Rol Al',
  DM_SEND: 'DM Gönder',
  REPLY: 'Kanala Yanit',
  CHANNEL_LINK: 'Kanal Linki Gönder',
  RUN_INTERNAL_COMMAND: 'Ic Komut Calistir',
  REMOVE_OTHER_REACTIONS_IN_GROUP: 'Ayni Grupta Diger Tepkileri Kaldir',
};

const TRIGGER_LABELS = {
  TOGGLE: 'Ekle-Kaldir',
  ADD: 'Sadece Ekleyince',
  REMOVE: 'Sadece Kaldirinca',
};

function emojiLabel(rule) {
  if (rule.emojiType === 'custom') return `<:${rule.emojiName || 'emoji'}:${rule.emojiId}>`;
  return rule.emojiName || '-';
}

function newActionTemplate(type) {
  if (type === 'ROLE_ADD' || type === 'ROLE_REMOVE') return { type, payload: { roleId: '' } };
  if (type === 'CHANNEL_LINK') return { type, payload: { channelId: '', delivery: 'dm' } };
  if (type === 'RUN_INTERNAL_COMMAND') return { type, payload: { command: INTERNAL_COMMAND_OPTIONS[0].value } };
  if (type === 'DM_SEND' || type === 'REPLY') return { type, payload: { text: '' } };
  return { type, payload: {} };
}

function Picker({ label, selectedLabel, items, open, onToggle, onPick }) {
  return (
    <div className="bg-black/20 rounded-xl p-3 border border-white/10">
      <div className="text-xs text-gray-400 mb-2">{label}</div>
      <button
        onClick={onToggle}
        className="w-full text-left bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 hover:bg-black/60"
      >
        {selectedLabel || 'Sec'}
      </button>
      {open && (
        <div className="mt-2 max-h-44 overflow-auto space-y-1 pr-1">
          {items.map((item) => (
            <button
              key={item.value}
              onClick={() => onPick(item.value)}
              className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                item.active
                  ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                  : 'bg-black/40 border-white/10 text-gray-300 hover:bg-black/60'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReactionActions({
  roles,
  channels,
  emojis,
  reactionRules,
  reactionHealth,
  reactionForm,
  setReactionForm,
  onSave,
  onDelete,
  onToggleEnabled,
  onEdit,
  onReset,
  onReload,
  onTest,
}) {
  const [pickerOpen, setPickerOpen] = useState({
    channel: false,
    emojiType: false,
    customEmoji: false,
    trigger: false,
  });

  const selectableRoles = useMemo(() => (roles || []).filter((r) => r.id !== '0'), [roles]);
  const selectedChannel = useMemo(() => (channels || []).find((c) => c.id === reactionForm.channelId), [channels, reactionForm.channelId]);
  const selectedCustomEmoji = useMemo(() => (emojis || []).find((e) => e.id === reactionForm.emojiId), [emojis, reactionForm.emojiId]);

  function toggleRoleList(key, roleId) {
    setReactionForm((prev) => {
      const list = Array.isArray(prev?.[key]) ? prev[key] : [];
      const exists = list.includes(roleId);
      return { ...prev, [key]: exists ? list.filter((x) => x !== roleId) : [...list, roleId] };
    });
  }

  function addAction(type) {
    setReactionForm((prev) => ({ ...prev, actions: [...(prev.actions || []), newActionTemplate(type)] }));
  }

  function removeAction(index) {
    setReactionForm((prev) => ({ ...prev, actions: (prev.actions || []).filter((_, i) => i !== index) }));
  }

  function updateAction(index, nextAction) {
    setReactionForm((prev) => {
      const list = [...(prev.actions || [])];
      list[index] = nextAction;
      return { ...prev, actions: list };
    });
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black tracking-widest uppercase text-cyan-200">Tepki Aksiyonu Kurali</h3>
          <div className="flex gap-2">
            <button onClick={onReload} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold">YENILE</button>
            <button onClick={onReset} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold">TEMIZLE</button>
            <button onClick={onSave} className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-xs font-bold text-cyan-200">KAYDET</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Picker
            label="Kanal"
            selectedLabel={selectedChannel?.name}
            open={pickerOpen.channel}
            onToggle={() => setPickerOpen((p) => ({ ...p, channel: !p.channel }))}
            onPick={(channelId) => {
              setReactionForm((p) => ({ ...p, channelId }));
              setPickerOpen((p) => ({ ...p, channel: false }));
            }}
            items={(channels || []).map((c) => ({
              value: c.id,
              label: c.name,
              active: reactionForm.channelId === c.id,
            }))}
          />

          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Mesaj ID</span>
            <input
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-gray-100"
              value={reactionForm.messageId || ''}
              onChange={(e) => setReactionForm((p) => ({ ...p, messageId: e.target.value }))}
            />
          </label>

          <Picker
            label="Emoji Tipi"
            selectedLabel={reactionForm.emojiType === 'custom' ? 'Sunucu Emojisi' : 'Unicode Emoji'}
            open={pickerOpen.emojiType}
            onToggle={() => setPickerOpen((p) => ({ ...p, emojiType: !p.emojiType }))}
            onPick={(emojiType) => {
              setReactionForm((p) => ({ ...p, emojiType }));
              setPickerOpen((p) => ({ ...p, emojiType: false }));
            }}
            items={[
              { value: 'unicode', label: 'Unicode Emoji', active: reactionForm.emojiType === 'unicode' },
              { value: 'custom', label: 'Sunucu Emojisi', active: reactionForm.emojiType === 'custom' },
            ]}
          />

          {reactionForm.emojiType === 'custom' ? (
            <Picker
              label="Custom Emoji"
              selectedLabel={selectedCustomEmoji?.name}
              open={pickerOpen.customEmoji}
              onToggle={() => setPickerOpen((p) => ({ ...p, customEmoji: !p.customEmoji }))}
              onPick={(emojiId) => {
                const em = (emojis || []).find((e) => e.id === emojiId);
                setReactionForm((p) => ({ ...p, emojiId, emojiName: em?.name || p.emojiName }));
                setPickerOpen((p) => ({ ...p, customEmoji: false }));
              }}
              items={(emojis || []).map((e) => ({
                value: e.id,
                label: e.name,
                active: reactionForm.emojiId === e.id,
              }))}
            />
          ) : (
            <label className="bg-black/20 rounded-xl p-3 border border-white/10">
              <span className="block text-xs text-gray-400 mb-2">Unicode Emoji</span>
              <input
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-gray-100"
                value={reactionForm.emojiName || ''}
                onChange={(e) => setReactionForm((p) => ({ ...p, emojiName: e.target.value }))}
              />
            </label>
          )}

          <Picker
            label="Tetikleme"
            selectedLabel={TRIGGER_LABELS[reactionForm.triggerMode] || reactionForm.triggerMode}
            open={pickerOpen.trigger}
            onToggle={() => setPickerOpen((p) => ({ ...p, trigger: !p.trigger }))}
            onPick={(triggerMode) => {
              setReactionForm((p) => ({ ...p, triggerMode }));
              setPickerOpen((p) => ({ ...p, trigger: false }));
            }}
            items={['TOGGLE', 'ADD', 'REMOVE'].map((x) => ({
              value: x,
              label: TRIGGER_LABELS[x],
              active: reactionForm.triggerMode === x,
            }))}
          />

          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Cooldown (sn)</span>
            <input
              type="number"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-gray-100"
              value={reactionForm.cooldownSeconds ?? 5}
              onChange={(e) => setReactionForm((p) => ({ ...p, cooldownSeconds: Number(e.target.value || 0) }))}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <div className="text-xs text-gray-300 mb-2">Izinli Roller</div>
            <div className="max-h-28 overflow-auto space-y-1 pr-1">
              {selectableRoles.map((role) => {
                const active = (reactionForm.allowedRoles || []).includes(role.id);
                return (
                  <button
                    key={`allow-${role.id}`}
                    onClick={() => toggleRoleList('allowedRoles', role.id)}
                    className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                      active ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100' : 'bg-black/40 border-white/10 text-gray-300'
                    }`}
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <div className="text-xs text-gray-300 mb-2">Haric Roller</div>
            <div className="max-h-28 overflow-auto space-y-1 pr-1">
              {selectableRoles.map((role) => {
                const active = (reactionForm.excludedRoles || []).includes(role.id);
                return (
                  <button
                    key={`exclude-${role.id}`}
                    onClick={() => toggleRoleList('excludedRoles', role.id)}
                    className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                      active ? 'bg-rose-500/20 border-rose-400/40 text-rose-100' : 'bg-black/40 border-white/10 text-gray-300'
                    }`}
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 bg-black/20 rounded-xl p-3 border border-white/10">
          <div className="flex gap-2 flex-wrap mb-3">
            {ACTION_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => addAction(type)}
                className="px-2 py-1 rounded-lg border border-white/10 text-xs bg-black/40 hover:bg-black/60 text-gray-200"
              >
                + {ACTION_LABELS[type]}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {(reactionForm.actions || []).map((action, index) => (
              <div key={`action-${index}`} className="border border-white/10 rounded-lg p-2 bg-black/30">
                <div className="text-[11px] text-cyan-200 mb-2">{ACTION_LABELS[action.type] || action.type}</div>
                <div className="flex gap-2 flex-wrap mb-2">
                  {ACTION_TYPES.map((t) => (
                    <button
                      key={`${index}-${t}`}
                      onClick={() => updateAction(index, newActionTemplate(t))}
                      className={`px-2 py-1 rounded border text-[11px] ${
                        action.type === t
                          ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                          : 'bg-black/40 border-white/10 text-gray-300'
                      }`}
                    >
                      {ACTION_LABELS[t]}
                    </button>
                  ))}
                </div>

                {(action.type === 'ROLE_ADD' || action.type === 'ROLE_REMOVE') && (
                  <div className="max-h-28 overflow-auto space-y-1 pr-1">
                    {selectableRoles.map((r) => (
                      <button
                        key={`${index}-role-${r.id}`}
                        onClick={() => updateAction(index, { ...action, payload: { ...action.payload, roleId: r.id } })}
                        className={`w-full text-left rounded-lg px-2 py-1 text-xs border ${
                          action.payload?.roleId === r.id
                            ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                            : 'bg-black/40 border-white/10 text-gray-300'
                        }`}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}

                {(action.type === 'DM_SEND' || action.type === 'REPLY') && (
                  <input
                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-100"
                    placeholder="Mesaj"
                    value={action.payload?.text || ''}
                    onChange={(e) => updateAction(index, { ...action, payload: { ...action.payload, text: e.target.value } })}
                  />
                )}

                {action.type === 'CHANNEL_LINK' && (
                  <div className="space-y-2">
                    <div className="max-h-24 overflow-auto space-y-1 pr-1">
                      {(channels || []).map((c) => (
                        <button
                          key={`${index}-channel-${c.id}`}
                          onClick={() => updateAction(index, { ...action, payload: { ...action.payload, channelId: c.id } })}
                          className={`w-full text-left rounded-lg px-2 py-1 text-xs border ${
                            action.payload?.channelId === c.id
                              ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                              : 'bg-black/40 border-white/10 text-gray-300'
                          }`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {[
                        { value: 'dm', label: 'DM' },
                        { value: 'reply', label: 'Kanala Yanit' },
                      ].map((x) => (
                        <button
                          key={`${index}-delivery-${x.value}`}
                          onClick={() => updateAction(index, { ...action, payload: { ...action.payload, delivery: x.value } })}
                          className={`px-2 py-1 rounded border text-xs ${
                            (action.payload?.delivery || 'dm') === x.value
                              ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                              : 'bg-black/40 border-white/10 text-gray-300'
                          }`}
                        >
                          {x.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {action.type === 'RUN_INTERNAL_COMMAND' && (
                  <select
                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-100"
                    value={action.payload?.command || INTERNAL_COMMAND_OPTIONS[0].value}
                    onChange={(e) =>
                      updateAction(index, { ...action, payload: { ...action.payload, command: e.target.value } })
                    }
                  >
                    {INTERNAL_COMMAND_OPTIONS.map((option) => (
                      <option key={`${index}-icmd-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}

                <div className="mt-2">
                  <button onClick={() => removeAction(index)} className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-200">Sil</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h3 className="text-sm font-black tracking-widest uppercase text-emerald-200 mb-3">Sağlık</h3>
        <div className={`rounded-lg p-2 text-xs border ${reactionHealth?.ok ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-red-400/40 bg-red-500/10 text-red-200'}`}>
          {reactionHealth?.ok ? 'Sistem sağlıklı' : `Sorun: ${(reactionHealth?.issues || []).join(', ') || '...'}`}
        </div>
        {(reactionHealth?.ruleIssues || []).slice(0, 6).map((x) => (
          <div key={`issue-${x.ruleId}`} className="mt-2 text-xs text-rose-200">Kural #{x.ruleId}: {x.issues.join(', ')}</div>
        ))}

        <h3 className="text-sm font-black tracking-widest uppercase text-cyan-200 mt-6 mb-3">Kurallar</h3>
        <div className="space-y-2 max-h-[500px] overflow-auto pr-1">
          {(reactionRules || []).length === 0 && <div className="text-xs text-gray-400">Kural yok</div>}
          {(reactionRules || []).map((rule) => (
            <div key={rule.id} className="border border-white/10 rounded-lg p-3 bg-black/20 text-xs">
              <div className="font-bold">#{rule.id} {emojiLabel(rule)} {TRIGGER_LABELS[rule.triggerMode] || rule.triggerMode}</div>
              <div className="text-gray-300 mt-1">Mesaj: {rule.messageId}</div>
              <div className="text-gray-300">Aksiyon: {(rule.actions || []).map((a) => ACTION_LABELS[a.type] || a.type).join(', ') || '-'}</div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={() => onEdit(rule)} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">Duzenle</button>
                <button onClick={() => onToggleEnabled(rule)} className="px-2 py-1 rounded bg-amber-500/20 text-amber-200">{rule.enabled ? 'Pasif Yap' : 'Aktif Yap'}</button>
                <button onClick={() => onTest(rule.id)} className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-200">Test</button>
                <button onClick={() => onDelete(rule.id)} className="px-2 py-1 rounded bg-red-500/20 text-red-200">Sil</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
