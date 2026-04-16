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
  userDisplayName = 'Misafir',
  userHandle = '@misafir',
  userId = null,
  planLabel = 'Belirsiz Paket',
}) {
  const actionLabel = isAuthenticated ? 'Çıkış' : 'Giriş';
  const actionHandler = isAuthenticated ? onLogout : onLogin;

  return (
    <header className="rounded-[1.8rem] border border-white/10 bg-[#131322]/90 px-5 py-5 shadow-2xl shadow-black/25 md:px-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-3xl font-black tracking-tight text-white">GEASS</div>
          <div className="mt-1 text-sm text-white/60">Premium Discord Bot Kontrol Paneli</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-400">
            <span>{activeGuildName || 'Sunucu'}</span>
            {singleGuildMode ? (
              <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-100">
                Tek Sunucu Modu
              </span>
            ) : (
              <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white/70">
                Çoklu Sunucu
              </span>
            )}
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white/70">
              {planLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {canSelectGuild ? (
            <label className="block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-white/55">
                Sunucu Seçimi
              </div>
              <select
                value={guildId}
                onChange={(event) => onGuildChange(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold tracking-[0.16em] text-white outline-none transition-all hover:bg-white/10 sm:w-[260px]"
              >
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-sm font-semibold text-white">{userDisplayName || 'Misafir'}</div>
            <div className="text-xs text-white/65">{userHandle || '@misafir'}</div>
            <div className="mt-1 text-[10px] tracking-wide text-white/45">
              {userId ? `ID: ${userId}` : 'Oturum kimliği yok'}
            </div>
          </div>

          <button
            onClick={actionHandler}
            className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-[0.16em] text-cyan-100 transition-all hover:bg-cyan-500/30"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </header>
  );
}
