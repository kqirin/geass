import { Info } from 'lucide-react';

export default function VCStatusCard({ status, selectedName }) {
  return (
    <div className="mt-8 flex items-start gap-4 bg-[#0c0c16] border border-white/5 rounded-2xl p-5">
      <div className="mt-0.5 text-blue-400">
        <Info size={18} />
      </div>
      <div className="text-xs text-gray-300 font-bold leading-relaxed">
        Durum:{' '}
        {status?.connected ? <span className="text-green-400">Bagli</span> : <span className="text-gray-400">Bagli degil</span>}
        {status?.connected && <span className="text-gray-400"> - {status.channelName || selectedName || status.channelId}</span>}
      </div>
    </div>
  );
}

