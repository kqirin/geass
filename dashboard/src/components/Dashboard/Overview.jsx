import React from 'react';
import { Users, Mic, Zap, Crown, Shield, Hash } from 'lucide-react';

// Deprecated: kept intentionally for compatibility with previous dashboard layout experiments.
// The active dashboard currently renders feature tabs directly from pages/Dashboard.jsx.
const Overview = ({ guildStats, selectedGuild }) => {
    const stats = [
        { label: 'TOPLAM UYE', value: guildStats?.memberCount, icon: <Users size={28} />, color: 'from-blue-500/20' },
        { label: 'AKTIF', value: guildStats?.onlineCount, icon: <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse shadow-[0_0_15px_#22c55e]" />, color: 'from-green-500/20' },
        { label: 'SESTE', value: guildStats?.voiceCount, icon: <Mic size={28} />, color: 'from-purple-500/20' },
        { label: 'BOOST', value: guildStats?.boostCount, icon: <Zap size={28} />, color: 'from-pink-500/20' }
    ];

    return (
        <div className="space-y-10">
            <div className="grid grid-cols-4 gap-8">
                {stats.map((s, i) => (
                    <div key={i} className={`bg-[#16162a] p-8 rounded-[2.5rem] border border-white/5 bg-gradient-to-br ${s.color} to-transparent flex flex-col justify-between h-48 shadow-xl transition-all hover:scale-[1.02]`}>
                        <div className="flex items-center justify-between opacity-70">
                            <span className="text-xs font-black tracking-[0.2em]">{s.label}</span>
                            {s.icon}
                        </div>
                        <div className="text-6xl font-black italic tracking-tighter">{s.value || 0}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-3 gap-8">
                <div className="col-span-2 bg-[#16162a] p-10 rounded-[3rem] border border-white/5 relative overflow-hidden group h-[300px] flex items-center shadow-2xl">
                    <div className="relative z-10 flex items-center gap-10">
                        {}
                        <img src={guildStats?.iconURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} className="w-40 h-40 rounded-[2.5rem] shadow-2xl border-4 border-white/5 object-cover" alt="Sunucu Ikonu" />
                        <div className="space-y-6">
                            <h2 className="text-5xl font-black italic uppercase tracking-tighter">{selectedGuild.name}</h2>
                            <div className="flex gap-4">
                                {}
                                <div className="bg-white/5 px-6 py-3 rounded-2xl text-xs font-bold text-gray-300 flex items-center gap-3 border border-white/5">
                                    <Crown size={16} className="text-yellow-500"/> {guildStats?.ownerName || 'Bilinmiyor'}
                                </div>
                                <div className="bg-white/5 px-6 py-3 rounded-2xl text-xs font-bold text-gray-300 border border-white/5">
                                    {new Date(guildStats?.createdAt).toLocaleDateString()} Created
                                </div>
                            </div>
                        </div>
                    </div>
                    <Shield size={350} className="absolute -right-20 -bottom-20 opacity-[0.03] -rotate-12 transition-all duration-1000 group-hover:rotate-0 group-hover:opacity-[0.05]" />
                </div>
                <div className="bg-[#16162a] p-10 rounded-[3rem] border border-white/5 flex flex-col items-center justify-center text-center space-y-6 shadow-2xl relative overflow-hidden">
                    <div className="p-6 bg-purple-500/10 rounded-[2rem] relative z-10"><Hash className="text-purple-500" size={48} /></div>
                    <div className="space-y-2 relative z-10">
                         <div className="text-sm font-black text-gray-500 tracking-[0.3em] uppercase">TAG SAYACI</div>
                        <div className="text-7xl font-black italic tracking-tighter">0</div>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-purple-500/5 to-transparent"/>
                </div>
            </div>
        </div>
    );
};

export default Overview;
