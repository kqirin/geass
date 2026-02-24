import { Mic, RefreshCw } from 'lucide-react';

export default function VCHeader({ busy, onRefresh }) {
  return (
    <div className="bg-[#16162a] p-8 rounded-[2.5rem] border border-white/5 flex items-center justify-between shadow-xl">
      <div className="flex items-center gap-6">
        <div className="p-4 bg-purple-600/20 rounded-2xl text-purple-400 shadow-[0_0_15px_rgba(147,51,234,0.3)]">
          <Mic size={32} />
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">SES KONTROLU</h2>
          <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Botu panelden ses kanalina sok / cikar</p>
        </div>
      </div>

      <button
        disabled={busy}
        onClick={onRefresh}
        className="px-6 py-4 bg-white/5 border border-white/10 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all backdrop-blur-md flex items-center gap-3 disabled:opacity-50"
      >
        <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Yenile
      </button>
    </div>
  );
}

