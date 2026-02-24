export default function DashboardHeader({ guilds, guildId, canSelectGuild, onGuildChange, onLogout }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div className="text-3xl font-black italic tracking-tight">AURI</div>

        {canSelectGuild ? (
          <select
            value={guildId}
            onChange={(e) => onGuildChange(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-widest outline-none hover:bg-white/10 transition-all"
          >
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-200">
            {guilds.find((g) => g.id === guildId)?.name || 'Sunucu'}
          </div>
        )}
      </div>

      <button
        onClick={onLogout}
        className="px-6 py-3 bg-white/5 border border-white/10 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3"
      >
        CIKIS
      </button>
    </div>
  );
}

