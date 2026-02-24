function ts(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  return new Date(n).toLocaleString('tr-TR');
}

export default function WeeklyStaff({
  roles,
  channels,
  weeklySettings,
  setWeeklySettings,
  leaderboard,
  history,
  onSave,
  onRefresh,
  onManualRun,
  onToggleEnabled,
}) {
  const eligibleRoles = Array.isArray(weeklySettings?.eligibleRoles) ? weeklySettings.eligibleRoles : [];
  const excludedRoles = Array.isArray(weeklySettings?.excludedRoles) ? weeklySettings.excludedRoles : [];
  const selectableRoles = (roles || []).filter((role) => role.id !== '0');
  const selectedAwardRole = selectableRoles.find((role) => role.id === weeklySettings.awardRoleId) || null;
  const selectedChannel = (channels || []).find((ch) => ch.id === weeklySettings.announcementChannelId) || null;

  function toggleRole(key, roleId) {
    setWeeklySettings((prev) => {
      const current = Array.isArray(prev?.[key]) ? prev[key] : [];
      const has = current.includes(roleId);
      const next = has ? current.filter((x) => x !== roleId) : [...current, roleId];
      return { ...prev, [key]: next };
    });
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-black tracking-widest uppercase text-cyan-200">Haftanin Yetkilisi Ayarlari</h3>
          <div className="flex gap-2">
            <button
              onClick={onToggleEnabled}
              className={`px-3 py-2 rounded-xl text-xs font-bold ${
                weeklySettings.enabled
                  ? 'bg-red-500/20 hover:bg-red-500/30 text-red-200'
                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200'
              }`}
            >
              {weeklySettings.enabled ? 'KAPAT' : 'AC'}
            </button>
            <button onClick={onRefresh} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold">
              YENILE
            </button>
            <button onClick={onManualRun} className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-xs font-bold text-amber-200">
              MANUEL CALISTIR
            </button>
            <button onClick={onSave} className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-xs font-bold text-cyan-200">
              KAYDET
            </button>
          </div>
        </div>

        <div
          className={`rounded-xl border px-4 py-3 mb-4 text-xs ${
            weeklySettings.enabled
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
              : 'border-red-400/40 bg-red-500/10 text-red-200'
          }`}
        >
          {weeklySettings.enabled
            ? 'Sistem aktif: Komut ve moderasyon puanlari toplaniyor.'
            : 'Sistem pasif: Puan toplanmaz, haftalik secim yapilmaz.'}
        </div>
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 mb-4 text-xs text-amber-100">
          Manuel Calistir: Haftalik kazanan hesaplamasini hemen dener. Normalde sistem bunu otomatik yapar.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Durum</span>
            <div className="text-sm font-bold">{weeklySettings.enabled ? 'AKTIF' : 'PASIF'}</div>
          </label>

          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Minimum Puan</span>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
              type="number"
              value={weeklySettings.minimumPoints ?? 20}
              onChange={(e) => setWeeklySettings((p) => ({ ...p, minimumPoints: Number(e.target.value || 0) }))}
            />
          </label>

          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Hafta Baslangic Gunu (0-6)</span>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
              type="number"
              min="0"
              max="6"
              value={weeklySettings.weekStartDow ?? 1}
              onChange={(e) => setWeeklySettings((p) => ({ ...p, weekStartDow: Number(e.target.value || 1) }))}
            />
          </label>

          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Timezone</span>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
              value={weeklySettings.timezone || 'Europe/Istanbul'}
              onChange={(e) => setWeeklySettings((p) => ({ ...p, timezone: e.target.value }))}
            />
          </label>

          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="block text-xs text-gray-400">Odul Rolu</span>
              <span className="text-[11px] text-cyan-200 truncate max-w-[180px]">{selectedAwardRole?.name || 'Secilmedi'}</span>
            </div>
            <div className="max-h-28 overflow-auto space-y-1 pr-1">
              <button
                onClick={() => setWeeklySettings((p) => ({ ...p, awardRoleId: null }))}
                className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                  !weeklySettings.awardRoleId
                    ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                Secilmesin
              </button>
              {selectableRoles.map((role) => (
                <button
                  key={`award-${role.id}`}
                  onClick={() => setWeeklySettings((p) => ({ ...p, awardRoleId: role.id }))}
                  className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                    weeklySettings.awardRoleId === role.id
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {role.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="block text-xs text-gray-400">Duyuru Kanali</span>
              <span className="text-[11px] text-cyan-200 truncate max-w-[180px]">{selectedChannel?.name || 'Secilmedi'}</span>
            </div>
            <div className="max-h-28 overflow-auto space-y-1 pr-1">
              <button
                onClick={() => setWeeklySettings((p) => ({ ...p, announcementChannelId: null }))}
                className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                  !weeklySettings.announcementChannelId
                    ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                Secilmesin
              </button>
              {(channels || []).map((ch) => (
                <button
                  key={`channel-${ch.id}`}
                  onClick={() => setWeeklySettings((p) => ({ ...p, announcementChannelId: ch.id }))}
                  className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                    weeklySettings.announcementChannelId === ch.id
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  #{ch.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Esitlik Kurali (Tie Break)</span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setWeeklySettings((p) => ({ ...p, tieBreakMode: 'moderation_first' }))}
                className={`rounded-lg px-2 py-2 text-xs border ${
                  weeklySettings.tieBreakMode === 'moderation_first'
                    ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
                    : 'bg-white/5 border-white/10 text-gray-300'
                }`}
              >
                MOD ONCELIK
              </button>
              <button
                onClick={() => setWeeklySettings((p) => ({ ...p, tieBreakMode: 'random' }))}
                className={`rounded-lg px-2 py-2 text-xs border ${
                  weeklySettings.tieBreakMode === 'random'
                    ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
                    : 'bg-white/5 border-white/10 text-gray-300'
                }`}
              >
                RASTGELE
              </button>
              <button
                onClick={() => setWeeklySettings((p) => ({ ...p, tieBreakMode: 'multi' }))}
                className={`rounded-lg px-2 py-2 text-xs border ${
                  weeklySettings.tieBreakMode === 'multi'
                    ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
                    : 'bg-white/5 border-white/10 text-gray-300'
                }`}
              >
                COKLU
              </button>
            </div>
            <div className="text-[11px] text-gray-400 mt-2">Esit puanda kazananin nasil secilecegi.</div>
          </div>

          <label className="bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-400 mb-2">Komut Cooldown (sn)</span>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
              type="number"
              value={weeklySettings?.spamGuard?.commandCooldownSec ?? 6}
              onChange={(e) =>
                setWeeklySettings((p) => ({
                  ...p,
                  spamGuard: { ...(p.spamGuard || {}), commandCooldownSec: Number(e.target.value || 1) },
                }))
              }
            />
          </label>

          <div className="md:col-span-2 bg-black/20 rounded-xl p-3 border border-white/10">
            <span className="block text-xs text-gray-300 mb-2">Duyuru Mesaji</span>
            <textarea
              className="w-full min-h-[92px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400/40"
              value={weeklySettings.announcementMessage || ''}
              onChange={(e) => setWeeklySettings((p) => ({ ...p, announcementMessage: e.target.value }))}
              placeholder={'Ornek:\nHaftanin Yetkilisi: {winner}\nPuan: {points}\nTum kazananlar:\n{winners}'}
            />
            <div className="text-[11px] text-gray-400 mt-2">
              Kullanilabilir degiskenler: {'{winner}'} {'{points}'} {'{winners}'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="block text-xs text-gray-300">Aday Roller</span>
              <span className="text-[11px] text-cyan-200">{eligibleRoles.length} secili</span>
            </div>
            <div className="text-[11px] text-gray-400 mb-2">Sadece bu rollere sahip uyeler puan alir.</div>
            <div className="max-h-36 overflow-auto space-y-1 pr-1">
              {selectableRoles.map((role) => {
                const active = eligibleRoles.includes(role.id);
                return (
                  <button
                    key={`eligible-${role.id}`}
                    onClick={() => toggleRole('eligibleRoles', role.id)}
                    className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                      active
                        ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-100'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-black/20 rounded-xl p-3 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="block text-xs text-gray-300">Haric Tutulan Roller</span>
              <span className="text-[11px] text-rose-200">{excludedRoles.length} secili</span>
            </div>
            <div className="text-[11px] text-gray-400 mb-2">Bu rollerdekiler aday olsa bile puan alamaz.</div>
            <div className="max-h-36 overflow-auto space-y-1 pr-1">
              {selectableRoles.map((role) => {
                const active = excludedRoles.includes(role.id);
                return (
                  <button
                    key={`excluded-${role.id}`}
                    onClick={() => toggleRole('excludedRoles', role.id)}
                    className={`w-full text-left rounded-lg px-2 py-2 text-xs border ${
                      active
                        ? 'bg-rose-500/20 border-rose-400/40 text-rose-100'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h3 className="text-sm font-black tracking-widest uppercase text-emerald-200 mb-4">Bu Hafta Liderlik</h3>
        <div className="space-y-2 max-h-[320px] overflow-auto">
          {leaderboard.length === 0 && <div className="text-xs text-gray-400">Kayit yok</div>}
          {leaderboard.map((item, idx) => (
            <div key={`${item.userId}-${idx}`} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
              <div className="font-bold">#{idx + 1} {item.userId}</div>
              <div className="text-gray-300">Puan: {item.points} | Mod: {item.moderationActions} | Komut: {item.commandCount}</div>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-black tracking-widest uppercase text-pink-200 mt-6 mb-4">Kazanan Gecmisi</h3>
        <div className="space-y-2 max-h-[260px] overflow-auto">
          {history.length === 0 && <div className="text-xs text-gray-400">Kayit yok</div>}
          {history.map((item, idx) => (
            <div key={`${item.winnerUserId}-${item.weekStart}-${idx}`} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
              <div className="font-bold">{item.winnerUserId}</div>
              <div className="text-gray-300">Puan: {item.points} | Mod: {item.moderationActions}</div>
              <div className="text-gray-400">Odul: {ts(item.awardedAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
