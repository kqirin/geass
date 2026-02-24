import { PlugZap, Unplug } from 'lucide-react';

export default function VCChannelControls({
  groups,
  selectedChannelId,
  setSelectedChannelId,
  busy,
  onConnect,
  onDisconnect,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-end">
      <div className="lg:col-span-2 space-y-2">
        <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest">Ses Kanali Sec</label>
        <select
          value={selectedChannelId}
          onChange={(e) => setSelectedChannelId(e.target.value)}
          className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-purple-500/40 text-white transition-all"
        >
          {!groups?.length && <option value="">Ses kanali yok</option>}

          {groups.map((g, idx) => (
            <optgroup key={g.categoryId || `no-cat-${idx}`} label={g.categoryName || 'Kategorisiz'}>
              {(g.channels || []).map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.kind === 'stage' ? 'STAGE' : 'VOICE'} - {ch.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex gap-4">
        <button
          disabled={busy || !selectedChannelId}
          onClick={onConnect}
          className="flex-1 py-5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl font-black text-sm uppercase italic tracking-tighter shadow-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 text-white disabled:opacity-50 disabled:hover:scale-100"
        >
          <PlugZap size={18} /> Baglan
        </button>

        <button
          disabled={busy}
          onClick={onDisconnect}
          className="flex-1 py-5 bg-white/5 border border-white/10 rounded-2xl font-black text-sm uppercase italic tracking-tighter shadow-xl transition-all hover:bg-white/10 active:scale-95 flex items-center justify-center gap-3 text-white disabled:opacity-50"
        >
          <Unplug size={18} /> Kes
        </button>
      </div>
    </div>
  );
}

