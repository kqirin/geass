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
      className={`geass-top-header fixed top-0 right-0 z-40 ${withSidebar ? 'left-0 lg:left-[272px]' : 'left-0'}`}
    >
      <div className="geass-top-header-inner">
        <div className="min-w-0 max-w-[32rem]">
          <div className="flex items-center gap-3">
            <div className="geass-brand-badge">G</div>
            <div>
              <div className="geass-header-kicker">Obsidian Kontrol Merkezi</div>
              <div className="geass-header-title">GEASS Command Suite</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a9b4d8]">
            <span>{activeGuildName || 'Sunucu'}</span>
            <span className={`geass-chip ${singleGuildMode ? 'geass-chip-primary' : 'geass-chip-muted'}`}>
              {singleGuildMode ? 'Tek Sunucu Modu' : 'Çoklu Sunucu'}
            </span>
            <span className="geass-chip geass-chip-muted">{planLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 sm:items-center sm:justify-end">
          <label className="hidden xl:flex xl:w-[240px] xl:items-center xl:gap-2">
            <span className="sr-only">Komut veya modül ara</span>
            <input
              type="text"
              readOnly
              value=""
              placeholder="Komut veya modül ara..."
              className="geass-input w-full text-sm placeholder:text-[#7f8eb8]"
            />
          </label>

          {canSelectGuild ? (
            <label className="block">
              <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-[#9ca9ce]">
                Sunucu Seçimi
              </div>
              <select
                value={guildId}
                onChange={(event) => onGuildChange(event.target.value)}
                className="geass-select geass-input w-full min-w-[210px] sm:w-[280px]"
              >
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <span className="geass-chip geass-chip-primary h-fit">{planLabel}</span>

          <div className="geass-user-card">
            <div className="geass-user-avatar">
              {userAvatarUrl ? (
                <img
                  src={userAvatarUrl}
                  alt={`${userDisplayName || 'Kullanıcı'} avatar`}
                  className="h-full w-full rounded-[11px] object-cover"
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#eef3ff]">
                {userDisplayName || 'Misafir'}
              </div>
              <div className="truncate text-xs text-[#a6b1d4]">{userHandle || '@misafir'}</div>
              <div className="mt-1 text-[10px] text-[#8d99be]">
                {userId ? `ID: ${userId}` : 'Oturum kimliği yok'}
              </div>
            </div>
          </div>

          <button
            onClick={actionHandler}
            className="geass-btn geass-btn-primary h-fit min-w-[116px]"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </header>
  );
}
