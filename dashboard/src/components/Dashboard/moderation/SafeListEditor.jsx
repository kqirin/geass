import { UserPlus, X } from 'lucide-react';
import { normalizeIdList } from './helpers';

export default function SafeListEditor({
  cmd,
  modSettings,
  userMap,
  searchResults,
  activeSearch,
  setActiveSearch,
  onSearch,
  onAddSafeUser,
  onRemoveSafeUser,
  getUserLabel,
}) {
  const safeIds = normalizeIdList(modSettings[`${cmd.id}_safe_list`]);

  return (
    <div className="space-y-4 pt-6 border-t border-white/5">
      <div className="flex items-center justify-between mb-2 px-2">
        <label className="text-[10px] font-black text-green-500 uppercase tracking-widest">Guvenli Liste</label>
        <UserPlus size={14} className="text-green-500 opacity-50" />
      </div>

      <div className="flex flex-wrap gap-2 min-h-[40px]">
        {safeIds.map((id) => (
          <div
            key={id}
            className="bg-purple-600/10 px-4 py-2 rounded-xl text-[10px] font-black border border-purple-600/20 flex items-center gap-3 group hover:bg-red-500/10 hover:border-red-500/20 transition-all cursor-default"
          >
            <span className="text-white">@{userMap[id] || id}</span>
            <X
              size={12}
              className="cursor-pointer text-gray-500 group-hover:text-red-500 transition-colors"
              onClick={() => onRemoveSafeUser(cmd.id, id)}
            />
          </div>
        ))}
      </div>

      <div className="relative group">
        <input
          type="text"
          placeholder="Uye ara (ID veya Isim)..."
          onFocus={() => setActiveSearch(cmd.id)}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-green-500/30 text-white transition-all"
        />

        {activeSearch === cmd.id && searchResults.length > 0 && (
          <div className="absolute top-full left-0 w-full bg-[#1e1e2f] border border-white/10 rounded-2xl mt-3 z-50 shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden">
            {searchResults.map((u) => (
              <div
                key={u.id}
                onClick={() => onAddSafeUser(cmd.id, u)}
                className="p-4 text-xs font-bold hover:bg-purple-600/20 cursor-pointer flex justify-between items-center group/item transition-colors"
              >
                <div className="flex flex-col">
                  <span className="text-white group-hover/item:text-purple-400">@{getUserLabel(u)}</span>
                  <span className="text-[9px] text-gray-500 uppercase">{u.id}</span>
                </div>
                <div className="p-2 bg-white/5 rounded-lg group-hover/item:bg-purple-600 transition-all">
                  <UserPlus size={12} className="text-white" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

