import { FileText, Hash, Image as ImageIcon, MessageSquare, Palette, Send, Type } from 'lucide-react';

export default function EmbedForm({ embedData, setEmbedData, channels, onSend }) {
  return (
    <div className="bg-[#16162a] p-6 rounded-[2rem] border border-white/5 shadow-2xl overflow-y-auto custom-scrollbar">
      <div className="flex items-center gap-4 mb-6 sticky top-0 bg-[#16162a] z-10 py-2 border-b border-white/5">
        <div className="p-3 bg-blue-600/20 rounded-2xl text-blue-400">
          <Type size={24} />
        </div>
        <h2 className="text-xl font-black italic uppercase tracking-wider text-white">Embed Olusturucu</h2>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest flex items-center gap-2">
            <Hash size={12} /> Hedef Kanal
          </label>
          <select
            value={embedData.channelId}
            onChange={(e) => setEmbedData({ ...embedData, channelId: e.target.value })}
            className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-blue-500/40 text-white transition-all"
          >
            <option value="">Kanal Seciniz...</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest flex items-center gap-2">
            <MessageSquare size={12} /> Mesaj Icerigi (Embed Disi)
          </label>
          <input
            type="text"
            placeholder="Herkes gorsun..."
            value={embedData.content}
            onChange={(e) => setEmbedData({ ...embedData, content: e.target.value })}
            className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-blue-500/40 text-white transition-all"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest flex items-center gap-2">
            <Type size={12} /> Embed Basligi
          </label>
          <input
            type="text"
            placeholder="Baslik..."
            value={embedData.title}
            onChange={(e) => setEmbedData({ ...embedData, title: e.target.value })}
            className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-sm font-bold outline-none focus:border-purple-500/40 text-white transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest flex items-center gap-2">
              <Palette size={12} /> Renk
            </label>
            <div className="flex items-center gap-3 bg-[#0c0c16] border border-white/5 p-2 rounded-2xl">
              <input
                type="color"
                value={embedData.color}
                onChange={(e) => setEmbedData({ ...embedData, color: e.target.value })}
                className="w-full h-10 rounded-xl cursor-pointer bg-transparent border-none outline-none"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest flex items-center gap-2">
              <ImageIcon size={12} /> Resim URL
            </label>
            <input
              type="text"
              placeholder="https://..."
              value={embedData.image}
              onChange={(e) => setEmbedData({ ...embedData, image: e.target.value })}
              className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-blue-500/40 text-white transition-all"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest flex items-center gap-2">
            <FileText size={12} /> Aciklama Metni
          </label>
          <textarea
            rows="6"
            placeholder="Detaylar..."
            value={embedData.description}
            onChange={(e) => setEmbedData({ ...embedData, description: e.target.value })}
            className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-blue-500/40 text-white transition-all resize-none"
          />
        </div>

        <button
          onClick={onSend}
          className="w-full py-5 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl font-black text-lg uppercase italic tracking-tighter shadow-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 text-white mt-4"
        >
          <Send size={20} /> GONDER
        </button>
      </div>
    </div>
  );
}

