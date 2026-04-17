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
  userId = null,
  userAvatarUrl = null,
  planLabel = 'Belirsiz Paket',
  withSidebar = false,
}) {
  const actionLabel = isAuthenticated ? 'Çıkış' : 'Giriş';
  const actionHandler = isAuthenticated ? onLogout : onLogin;
  const initials = String(userDisplayName || 'M')
    .trim()
    .slice(0, 2)
    .toUpperCase();

  return (
    <header
      className={`geass-top-header fixed top-0 right-0 z-40 ${withSidebar ? 'left-0 lg:left-[256px]' : 'left-0'}`}
    >
      <div className="geass-top-header-inner">
        <div className="flex min-w-0 items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="geass-brand-badge">G</div>
            <div className="text-2xl font-bold tracking-tight text-transparent bg-gradient-to-r from-[#cc97ff] to-[#9c48ea] bg-clip-text font-['Space_Grotesk']">
              Obsidian Nebula
            </div>
          </div>

          <nav className="hidden items-center gap-6 md:flex">
            <span className="geass-top-nav-item is-active">Servers</span>
            <span className="geass-top-nav-item">Network</span>
            <span className="geass-top-nav-item">Resources</span>
          </nav>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          <label className="hidden items-center rounded-lg border border-[#40485d]/20 bg-black/65 px-3 py-2 text-xs lg:flex">
            <span className="material-symbols-outlined mr-2 text-sm text-[#a3aac4]">search</span>
            <input
              type="text"
              readOnly
              value=""
              placeholder="Search commands or modules..."
              className="w-48 bg-transparent text-[#dee5ff] placeholder:text-[#a3aac4]/55 outline-none"
            />
          </label>

          {canSelectGuild ? (
            <label className="hidden min-w-[210px] xl:block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9ca9ce]">
                Sunucu Seçimi
              </div>
              <select
                value={guildId}
                onChange={(event) => onGuildChange(event.target.value)}
                className="geass-select geass-input w-full py-2 text-xs"
              >
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="geass-chip geass-chip-muted hidden xl:inline-flex">{activeGuildName || 'Sunucu'}</span>
          )}

          <span className="geass-top-plan hidden sm:inline-flex">{singleGuildMode ? 'Tek Sunucu Modu' : 'Çoklu Sunucu'}</span>
          <span className="geass-top-plan">{planLabel}</span>

          <button className="geass-icon-btn" type="button">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button className="geass-icon-btn" type="button">
            <span className="material-symbols-outlined">settings</span>
          </button>

          <div className="geass-top-avatar">
            {userAvatarUrl ? (
              <img
                src={userAvatarUrl}
                alt={`${userDisplayName || 'Kullanıcı'} avatar`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-bold text-[#e8d9ff]">
                {initials}
              </div>
            )}
          </div>

          <button
            onClick={actionHandler}
            className="geass-btn geass-btn-primary min-w-[102px] px-4 py-2 text-[11px]"
          >
            {actionLabel}
          </button>

          {userId ? (
            <span className="hidden text-[10px] uppercase tracking-[0.15em] text-[#8d99be] 2xl:inline">
              ID: {userId}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
