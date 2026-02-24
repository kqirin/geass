import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ShieldCheck, X } from 'lucide-react';

import { MODERATION_COMMANDS } from './moderation/constants';
import { getUserLabel, normalizeIdList } from './moderation/helpers';
import PrefixCard from './moderation/PrefixCard';
import CommandCard from './moderation/CommandCard';
import CommandMessageTemplates from './CommandMessageTemplates';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export default function Moderation({ roles, modSettings, setModSettings, handleSave, guildId, showToast }) {
  const [searchResults, setSearchResults] = useState([]);
  const [activeSearch, setActiveSearch] = useState(null);
  const [userMap, setUserMap] = useState({});
  const [editorCommand, setEditorCommand] = useState('');
  const selectableRoles = useMemo(() => (roles || []).filter((r) => r.id !== '0'), [roles]);

  const storageKey = useMemo(() => `auri_user_map_${guildId || 'noguild'}`, [guildId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setUserMap(JSON.parse(raw));
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(userMap));
    } catch {}
  }, [storageKey, userMap]);

  const handleSearch = async (value) => {
    if (!value || value.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const res = await axios.get(`${API_BASE}/api/settings/search-members/${guildId}?q=${encodeURIComponent(value)}`, {
        withCredentials: true,
      });
      setSearchResults(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSearchResults([]);
    }
  };

  const resolveUserId = useCallback(
    async (id) => {
      if (!id || userMap[id]) return;

      try {
        const res = await axios.get(
          `${API_BASE}/api/settings/search-members/${guildId}?q=${encodeURIComponent(id)}`,
          {
            withCredentials: true,
          }
        );
        const first = Array.isArray(res.data) ? res.data[0] : null;
        if (first?.id) {
          const label = getUserLabel(first);
          setUserMap((prev) => ({ ...prev, [first.id]: label }));
        }
      } catch {}
    },
    [guildId, userMap]
  );

  useEffect(() => {
    const allIds = new Set();

    MODERATION_COMMANDS.forEach((cmd) => {
      normalizeIdList(modSettings[`${cmd.id}_safe_list`]).forEach((id) => allIds.add(id));
    });

    [...allIds].slice(0, 50).forEach((id) => resolveUserId(id));
  }, [guildId, modSettings, resolveUserId]);

  const addSafeUser = (cmdId, user) => {
    const current = normalizeIdList(modSettings[`${cmdId}_safe_list`]);

    if (!current.includes(user.id)) {
      const label = getUserLabel(user);
      setModSettings({
        ...modSettings,
        [`${cmdId}_safe_list`]: [...current, user.id].join(','),
      });
      setUserMap((prev) => ({ ...prev, [user.id]: label }));
    }

    setSearchResults([]);
    setActiveSearch(null);
  };

  const removeSafeUser = (cmdId, id) => {
    const newList = normalizeIdList(modSettings[`${cmdId}_safe_list`])
      .filter((item) => item !== id)
      .join(',');

    setModSettings({ ...modSettings, [`${cmdId}_safe_list`]: newList });
  };

  return (
    <div className="space-y-10 pb-20">
      <PrefixCard
        prefix={modSettings.prefix}
        onChange={(value) => setModSettings({ ...modSettings, prefix: value })}
      />

      <div className="grid grid-cols-2 gap-8">
        {MODERATION_COMMANDS.map((cmd) => (
          <CommandCard
            key={cmd.id}
            cmd={cmd}
            roles={roles}
            modSettings={modSettings}
            setModSettings={setModSettings}
            userMap={userMap}
            searchResults={searchResults}
            activeSearch={activeSearch}
            setActiveSearch={setActiveSearch}
            onSearch={handleSearch}
            onAddSafeUser={addSafeUser}
            onRemoveSafeUser={removeSafeUser}
            getUserLabel={getUserLabel}
            onEditMessages={setEditorCommand}
          />
        ))}
      </div>

      <div className="bg-[#16162a]/80 p-10 rounded-[2.5rem] border border-white/5 flex flex-col gap-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/5 rounded-2xl text-cyan-300 text-sm font-black">#</div>
            <span className="font-black italic text-xl uppercase tracking-tight text-white">TAG AUTO ROL</span>
          </div>
          <button
            onClick={() => setModSettings({ ...modSettings, tag_enabled: !Boolean(modSettings.tag_enabled) })}
            className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${
              Boolean(modSettings.tag_enabled) ? 'bg-purple-600 shadow-[0_0_15px_#9333ea]' : 'bg-gray-800'
            }`}
          >
            <div
              className={`w-4 h-4 bg-white rounded-full transition-transform duration-300 ${
                Boolean(modSettings.tag_enabled) ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-cyan-300 uppercase ml-2 tracking-widest">Verilecek Rol</label>
            <select
              value={modSettings.tag_role || ''}
              onChange={(e) => setModSettings({ ...modSettings, tag_role: e.target.value })}
              className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-cyan-500/40 text-white transition-all"
            >
              <option value="">Rol Sec...</option>
              {selectableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-gray-400">
          Aciksa: kullanici bu sunucuyu primary guild olarak etiketle kullaniyorsa rol verilir; kapatirsa veya baska sunucuya gecerse rol geri alinir.
        </div>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-[3rem] font-black text-2xl uppercase italic tracking-tighter shadow-[0_20px_40px_rgba(147,51,234,0.3)] transition-all hover:scale-[1.01] active:scale-95 flex items-center justify-center gap-5 text-white"
      >
        <ShieldCheck size={32} /> GUVENLIK AYARLARINI GUNCELLE
      </button>

      {editorCommand && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-[1250px] max-h-[92vh] overflow-auto rounded-[2rem] border border-white/15 bg-[#0e0f20] shadow-[0_40px_80px_rgba(0,0,0,0.55)]">
            <div className="sticky top-0 z-10 px-6 py-4 border-b border-white/10 bg-[#0e0f20]/95 backdrop-blur-sm flex items-center justify-between">
              <div className="text-sm font-black uppercase tracking-widest text-white/80">Komut Mesajlari: {editorCommand}</div>
              <button
                onClick={() => setEditorCommand('')}
                className="w-9 h-9 rounded-xl border border-white/20 bg-black/20 text-white/80 hover:text-white flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6">
              <CommandMessageTemplates guildId={guildId} showToast={showToast} commandName={editorCommand} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

