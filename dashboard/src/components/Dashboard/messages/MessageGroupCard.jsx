import { MessageSquare } from 'lucide-react';

export default function MessageGroupCard({ group, customMessages, onChange }) {
  const getValue = (key) => customMessages?.[key] || '';

  return (
    <div className="bg-[#16162a]/80 p-8 rounded-[2.5rem] border border-white/5 shadow-2xl">
      <h3 className="text-xl font-black italic uppercase text-purple-400 mb-6 flex items-center gap-3">
        <MessageSquare size={20} /> {group.title}
      </h3>

      <div className="space-y-6">
        {group.items.map((item) => (
          <div key={item.key} className="space-y-2">
            <div className="flex justify-between items-end">
              <label className="text-[10px] font-black text-gray-500 uppercase ml-2 tracking-widest">{item.label}</label>
              <span className="text-[9px] text-gray-600 font-mono">{item.desc}</span>
            </div>

            <input
              type="text"
              placeholder={item.placeholder}
              value={getValue(item.key)}
              onChange={(e) => onChange(item.key, e.target.value)}
              className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-sm font-bold text-white outline-none focus:border-blue-500/40 transition-all placeholder:text-white/20"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

