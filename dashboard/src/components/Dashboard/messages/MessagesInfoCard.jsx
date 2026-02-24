import { Info } from 'lucide-react';

export default function MessagesInfoCard({ variableHelp }) {
  return (
    <div className="bg-[#16162a] p-6 rounded-[2rem] border border-white/5 flex items-center gap-6 shadow-xl">
      <div className="p-4 bg-blue-500/20 rounded-2xl text-blue-400">
        <Info size={32} />
      </div>
      <div>
        <h2 className="text-xl font-black italic uppercase text-white">Degiskenler</h2>
        <p className="text-xs text-gray-400 mt-1">{variableHelp}</p>
      </div>
    </div>
  );
}

