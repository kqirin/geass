export default function DashboardHeader({
  guilds,
  guildId,
  activeGuildName,
  singleGuildMode,
  canSelectGuild,
  onGuildChange,
  onLogout,
  onLogin,
  isAuthenticated = true,
}) {
  const actionLabel = isAuthenticated ? 'Çıkış' : 'Giriş';
  const actionHandler = isAuthenticated ? onLogout : onLogin;

  return (
    <div className="flex flex-col gap-5 rounded-[1.8rem] border border-white/10 bg-[#131322]/85 px-5 py-5 shadow-2xl shadow-black/20 md:flex-row md:items-center md:justify-between md:px-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
        <div>
          <div className="text-3xl font-black tracking-tight text-white">GEASS</div>
          <div className="mt-1 text-xs text-white/60">Discord Bot Kontrol Paneli</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-400">
            <span>{activeGuildName || 'Sunucu'}</span>
            {singleGuildMode ? (
              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-cyan-100">
                Tek Sunucu Modu
              </span>
            ) : null}
          </div>
        </div>

        {canSelectGuild ? (
          <select
            value={guildId}
            onChange={(e) => onGuildChange(e.target.value)}
            className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] outline-none transition-all hover:bg-white/10"
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
        onClick={actionHandler}
        className="flex items-center gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/15 px-6 py-3 text-xs font-bold tracking-[0.16em] text-cyan-100 transition-all hover:bg-cyan-500/25"
      >
        {actionLabel}
      </button>
    </div>
  );
}

