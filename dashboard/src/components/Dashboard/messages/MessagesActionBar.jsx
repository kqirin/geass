import { RotateCcw, Save } from 'lucide-react';

export default function MessagesActionBar({ onReset, onSave }) {
  return (
    <div className="flex gap-6">
      <button
        onClick={onReset}
        className="flex-1 py-8 bg-[#16162a] border border-white/10 rounded-[3rem] font-black text-2xl uppercase italic tracking-tighter shadow-2xl transition-all hover:scale-[1.01] flex items-center justify-center gap-5 text-white"
      >
        <RotateCcw size={32} /> SIFIRLA
      </button>

      <button
        onClick={onSave}
        className="flex-1 py-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-[3rem] font-black text-2xl uppercase italic tracking-tighter shadow-2xl transition-all hover:scale-[1.01] flex items-center justify-center gap-5 text-white"
      >
        <Save size={32} /> CEVAPLARI KAYDET
      </button>
    </div>
  );
}

