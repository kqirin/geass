export default function DashboardHeader({
  guilds,
  guildId,
  activeGuildName,
  singleGuildMode,
  canSelectGuild,
  onGuildChange,
  onLogout,
}) {
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <div>
          <div className="text-3xl font-black italic tracking-tight">GEASS</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.3em] text-gray-400">
            <span>{activeGuildName || 'Sunucu'}</span>
            {singleGuildMode ? (
              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-cyan-100">
                Single Guild
              </span>
            ) : null}
          </div>
        </div>

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
        ) : null}
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

