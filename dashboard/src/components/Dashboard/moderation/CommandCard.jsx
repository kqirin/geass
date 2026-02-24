import { Zap } from 'lucide-react';
import SafeListEditor from './SafeListEditor';

export default function CommandCard({
  cmd,
  roles,
  modSettings,
  setModSettings,
  userMap,
  searchResults,
  activeSearch,
  setActiveSearch,
  onSearch,
  onAddSafeUser,
  onRemoveSafeUser,
  getUserLabel,
  onEditMessages,
}) {
  const enabled = !!modSettings[`${cmd.id}_enabled`];
  const Icon = cmd.Icon;

  const setField = (field, value) => {
    setModSettings({ ...modSettings, [field]: value });
  };

  return (
    <div
      className={`bg-[#16162a]/80 p-10 rounded-[2.5rem] border border-white/5 flex flex-col gap-8 shadow-2xl transition-all duration-500 hover:shadow-purple-900/10 ${
        !enabled && 'opacity-50 grayscale'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white/5 rounded-2xl">
            <Icon size={22} className={cmd.iconClass} />
          </div>
          <span className="font-black italic text-xl uppercase tracking-tight text-white">{cmd.name}</span>
        </div>

        <button
          onClick={() => setField(`${cmd.id}_enabled`, !enabled)}
          className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${
            enabled ? 'bg-purple-600 shadow-[0_0_15px_#9333ea]' : 'bg-gray-800'
          }`}
        >
          <div className={`w-4 h-4 bg-white rounded-full transition-transform duration-300 ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {cmd.id !== 'log' && (
        <button
          onClick={() => onEditMessages?.(cmd.id)}
          className="w-full rounded-2xl border border-purple-400/35 bg-gradient-to-r from-purple-600/25 to-blue-600/25 px-4 py-3 text-xs font-black uppercase tracking-wider text-white hover:border-purple-300/60 transition-all"
        >
          Mesaji Duzenle
        </button>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest">Yetkili Rolu</label>
          <select
            value={modSettings[`${cmd.id}_role`] || ''}
            onChange={(e) => setField(`${cmd.id}_role`, e.target.value)}
            className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-purple-500/40 text-white transition-all"
          >
            <option value="">Rol Sec...</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-blue-400 uppercase ml-2 tracking-widest flex items-center gap-2">
            <Zap size={12} /> Saatlik Limit
          </label>
          <input
            type="number"
            value={modSettings[`${cmd.id}_limit`] || 0}
            onChange={(e) => setField(`${cmd.id}_limit`, parseInt(e.target.value, 10) || 0)}
            className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-blue-500/40 text-white transition-all"
          />
        </div>
      </div>

      {cmd.penalty && (
        <div className="space-y-2">
          <label className="text-[10px] font-black text-purple-400 uppercase ml-2 tracking-widest">Cezali Rolu</label>
          <select
            value={modSettings[`${cmd.id}_penalty_role`] || ''}
            onChange={(e) => setField(`${cmd.id}_penalty_role`, e.target.value)}
            className="w-full bg-[#0c0c16] border border-purple-500/20 rounded-2xl p-4 text-xs font-bold outline-none focus:border-purple-500 text-white transition-all"
          >
            <option value="">Sec...</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <SafeListEditor
        cmd={cmd}
        modSettings={modSettings}
        userMap={userMap}
        searchResults={searchResults}
        activeSearch={activeSearch}
        setActiveSearch={setActiveSearch}
        onSearch={onSearch}
        onAddSafeUser={onAddSafeUser}
        onRemoveSafeUser={onRemoveSafeUser}
        getUserLabel={getUserLabel}
      />
    </div>
  );
}

