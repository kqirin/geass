import { Terminal } from 'lucide-react';

export default function PrefixCard({ prefix, onChange }) {
  return (
    <div className="bg-[#16162a] p-8 rounded-[2.5rem] border border-white/5 flex items-center justify-between shadow-xl transition-all hover:border-purple-500/30">
      <div className="flex items-center gap-6">
        <div className="p-4 bg-purple-600/20 rounded-2xl text-purple-400 shadow-[0_0_15px_rgba(147,51,234,0.3)]">
          <Terminal size={32} />
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">Bot Komut On Eki (Prefix)</h2>
          <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">
            Komutlarin hangi isaretle baslayacagini secin (Orn: . veya !)
          </p>
        </div>
      </div>
      <input
        type="text"
        value={prefix || '!'}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#0c0c16] border border-white/10 rounded-2xl w-32 h-16 text-center text-3xl font-black text-white outline-none focus:border-purple-500 transition-all shadow-inner"
        maxLength={3}
      />
    </div>
  );
}

