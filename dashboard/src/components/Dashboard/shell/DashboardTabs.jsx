import { MessageSquare, Mic, Send, Shield, Trophy, Smile } from 'lucide-react';

const TABS = [
  { id: 'moderation', label: 'YETKILER', Icon: Shield },
  { id: 'messages', label: 'MESAJLAR', Icon: MessageSquare },
  { id: 'embed', label: 'EMBED', Icon: Send },
  { id: 'vc', label: 'VC', Icon: Mic },
  { id: 'weeklyStaff', label: 'HAFTALIK', Icon: Trophy },
  { id: 'reactionActions', label: 'TEPKI', Icon: Smile },
];

export default function DashboardTabs({ activeTab, onTabChange }) {
  return (
    <div className="flex gap-4 mt-8">
      {TABS.map((tab) => {
        const Icon = tab.Icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-6 py-3 rounded-2xl border font-black text-xs uppercase tracking-widest transition-all flex items-center gap-3 ${
              activeTab === tab.id
                ? 'bg-purple-600/20 border-purple-500/30 text-purple-200'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

