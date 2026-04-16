import { useNavigate } from 'react-router-dom';

import DashboardHeader from '../components/Dashboard/shell/DashboardHeader';
import SystemHealthCard from '../components/Dashboard/shell/SystemHealthCard';
import DashboardToast from '../components/Dashboard/shell/DashboardToast';
import { DASHBOARD_VIEW_STATES, useDashboardData } from '../hooks/useDashboardData';

const DEFAULT_VIEW_OPTIONS = [
  'overview',
  'guild',
  'features',
  'resources',
  'protected_overview',
];

const DEFAULT_VIEW_OPTION_LABELS = Object.freeze({
  overview: 'Genel Bakış',
  guild: 'Sunucu',
  features: 'Özellikler',
  resources: 'Kaynaklar',
  protected_overview: 'Korumalı Genel Bakış',
});

function formatPlanTier(rawTier) {
  const normalizedTier = String(rawTier || '').trim().toLowerCase();
  if (!normalizedTier) return 'Belirsiz Paket';
  if (normalizedTier === 'free') return 'Ücretsiz Paket';
  if (normalizedTier === 'pro') return 'Pro Paket';
  if (normalizedTier === 'enterprise') return 'Kurumsal Paket';
  if (normalizedTier === 'unresolved') return 'Belirsiz Paket';
  return `${normalizedTier.toUpperCase()} Paket`;
}

function formatPlanStatus(rawStatus) {
  const normalizedStatus = String(rawStatus || '').trim().toLowerCase();
  if (!normalizedStatus) return 'Belirsiz';
  if (normalizedStatus === 'resolved') return 'Hazir';
  if (normalizedStatus === 'unresolved') return 'Belirsiz';
  return normalizedStatus;
}

function formatPlanSource(rawSource) {
  const normalizedSource = String(rawSource || '').trim().toLowerCase();
  if (!normalizedSource) return 'Belirsiz';
  if (normalizedSource === 'repository') return 'Depo';
  if (normalizedSource === 'manual_override') return 'Manuel';
  if (normalizedSource === 'default') return 'Varsayilan';
  if (normalizedSource === 'unresolved') return 'Belirsiz';
  return normalizedSource;
}

function formatDefaultViewLabel(entry = '') {
  return DEFAULT_VIEW_OPTION_LABELS[entry] || entry;
}

function StateCard({
  title,
  description,
  actionLabel = null,
  onAction = null,
  secondaryActionLabel = null,
  onSecondaryAction = null,
  detail = null,
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#141425]/90 p-8 shadow-2xl shadow-black/20">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
        Durum
      </div>
      <div className="mt-2 text-2xl font-black tracking-tight text-white">{title}</div>
      <div className="mt-3 text-sm leading-relaxed text-gray-300">{description}</div>
      {detail ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0e0e19] px-4 py-3 text-xs text-gray-300">
          {detail}
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30"
          >
            {actionLabel}
          </button>
        ) : null}
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            onClick={onSecondaryAction}
            className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-bold tracking-wide text-white/85 transition-all hover:bg-white/10"
          >
            {secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    viewState,
    isAuthLoading,
    isProtectedLoading,
    authStatus,
    authError,
    protectedError,
    toast,
    login,
    logout,
    refreshAuth,
    refreshProtectedData,
    guilds,
    guildId,
    setGuildId,
    canSelectGuild,
    singleGuildMode,
    activeGuildName,
    authenticatedUserSummary,
    session,
    effectivePlan,
    capabilities,
    capabilitySummary,
    advancedPreferencesCapability,
    overview,
    preferencesDraft,
    setPreferencesDraft,
    dismissedNoticeIdsInput,
    setDismissedNoticeIdsInput,
    preferencesSaveState,
    preferencesSaveMessage,
    savePreferences,
    statusCommandSettings,
    statusCommandDetailModeDraft,
    setStatusCommandDetailModeDraft,
    statusCommandSaveState,
    statusCommandSaveMessage,
    saveStatusCommandSettings,
  } = useDashboardData({ navigate });

  const isAuthenticated = Boolean(authenticatedUserSummary?.id);
  const authUnavailableDetail =
    authStatus?.auth?.reasonCode ||
    authStatus?.reasonCode ||
    authError?.reasonCode ||
    protectedError?.reasonCode ||
    'auth_not_configured';
  const noAccessDetail =
    protectedError?.reasonCode || authError?.reasonCode || 'guild_scope_unresolved';
  const advancedCapabilityText = advancedPreferencesCapability.available
    ? 'Kullanıma hazır'
    : 'Bu özellik Pro pakette kullanılabilir.';
  const advancedCapabilityReasonText = advancedPreferencesCapability.reasonCode
    ? `Teknik kod: ${advancedPreferencesCapability.reasonCode}`
    : null;
  const statusCommandEffectiveMode = String(
    statusCommandSettings?.effective?.detailMode || 'legacy'
  ).toLowerCase();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0b14] via-[#0b0b14] to-[#07070f] text-white">
      <div className="mx-auto max-w-[1240px] px-6 pb-20 pt-10">
        <DashboardHeader
          guilds={guilds}
          guildId={guildId}
          activeGuildName={activeGuildName}
          singleGuildMode={singleGuildMode}
          canSelectGuild={canSelectGuild}
          onGuildChange={setGuildId}
          onLogout={logout}
          onLogin={login}
          isAuthenticated={isAuthenticated}
        />

        <SystemHealthCard overview={overview} viewState={viewState} />

        <div className="mt-8 space-y-7">
          {viewState === DASHBOARD_VIEW_STATES.LOADING ? (
            <StateCard
              title="Panel Hazirlaniyor"
              description="Oturum ve panel verileri güvenli olarak yükleniyor."
              actionLabel="Yenile"
              onAction={refreshAuth}
              detail={
                isAuthLoading
                  ? 'Kimlik doğrulama durumu kontrol ediliyor.'
                  : isProtectedLoading
                    ? 'Korumali panel verileri getiriliyor.'
                    : 'Bekleniyor...'
              }
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.UNAUTHENTICATED ? (
            <StateCard
              title="Oturum Bulunamadı"
              description="Paneli görmek için Discord hesabınla yeniden giriş yapmalısın."
              actionLabel="Discord ile Giriş"
              onAction={login}
              secondaryActionLabel="Yenile"
              onSecondaryAction={refreshAuth}
              detail="Teknik bilgi: GET /api/auth/login"
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE ? (
            <StateCard
              title="Kimlik Doğrulama Kullanılamıyor"
              description="Kimlik doğrulama servisi şu anda hazır değil."
              actionLabel="Yenile"
              onAction={refreshAuth}
              detail={`Teknik kod: ${authUnavailableDetail}`}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.NO_ACCESS ? (
            <StateCard
              title="Sunucu Erisimi Yok"
              description="Bu sunucu icin panel erisimi su an kullanilamiyor."
              actionLabel="Veriyi Yenile"
              onAction={refreshProtectedData}
              secondaryActionLabel="Oturumu Yenile"
              onSecondaryAction={refreshAuth}
              detail={`Teknik kod: ${noAccessDetail}`}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.ERROR ? (
            <StateCard
              title="Panelde Beklenmeyen Hata"
              description="Veriler guvenli modda tutuldu. Tekrar deneyebilirsin."
              actionLabel="Oturumu Yenile"
              onAction={refreshAuth}
              secondaryActionLabel="Veriyi Yenile"
              onSecondaryAction={refreshProtectedData}
              detail={authError?.message || protectedError?.message || 'unknown_error'}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.READY ? (
            <div className="space-y-8">
              <div className="space-y-2">
                <div className="text-3xl font-black tracking-tight text-white">
                  Geass Yönetim Paneli
                </div>
                <div className="text-sm text-white/65">
                  Sunucu ayarlarini guvenli sekilde yonetin. Teknik bilgiler arka planda,
                  oncelik operasyon akisi.
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-[1.8rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-400">
                    Kullanıcı
                  </div>
                  <div className="mt-2 font-black text-xl text-white">
                    {authenticatedUserSummary?.displayName || '-'}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    @{authenticatedUserSummary?.username || 'bilinmiyor'}
                  </div>
                  <div className="mt-3 text-xs text-gray-400">ID: {authenticatedUserSummary?.id || '-'}</div>
                  <div className="mt-3 text-xs text-gray-300">
                    Sunucu: {authenticatedUserSummary?.guildCount || 0} | Yetkili:{' '}
                    {authenticatedUserSummary?.operatorGuildCount || 0}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Oturum: {session?.id ? 'Açık' : 'Bilinmiyor'}
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-400">
                    Paket
                  </div>
                  <div className="mt-2 font-black text-xl text-white">
                    {formatPlanTier(effectivePlan?.tier)}
                  </div>
                  <div className="mt-3 text-xs text-gray-300">
                    Durum: {formatPlanStatus(effectivePlan?.status)}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Kaynak: {formatPlanSource(effectivePlan?.source)}
                  </div>
                  {effectivePlan?.reasonCode ? (
                    <div className="mt-1 text-xs text-gray-400">
                      Teknik kod: {effectivePlan.reasonCode}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[1.8rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-400">
                    Özellikler
                  </div>
                  <div className="mt-3 text-xs text-gray-300">
                    Kullanilabilir: {capabilitySummary.allowedCapabilities} /{' '}
                    {capabilitySummary.totalCapabilities}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Kısıtlı: {capabilitySummary.deniedCapabilities}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Aktif: {capabilitySummary.activeCapabilities}
                  </div>
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-cyan-100">
                    {advancedCapabilityText}
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    Gerekli Paket: {formatPlanTier(advancedPreferencesCapability.requiredPlan)}
                  </div>
                  {advancedCapabilityReasonText ? (
                    <div className="mt-1 text-[11px] text-gray-500">
                      {advancedCapabilityReasonText}
                    </div>
                  ) : null}
                  <div className="mt-3 break-all text-[10px] uppercase tracking-[0.18em] text-gray-500">
                    Teknik anahtarlar: {Object.keys(capabilities || {}).join(', ') || 'yok'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-[1.8rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
                  <div className="text-lg font-black tracking-tight text-white">
                    Panel Tercihleri
                  </div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-gray-500">
                    Uc nokta: GET/PUT /api/dashboard/protected/preferences
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="block text-xs font-semibold tracking-wide text-gray-300">
                      Varsayilan Sekme
                      <select
                        value={preferencesDraft.defaultView}
                        onChange={(event) =>
                          setPreferencesDraft((previous) => ({
                            ...previous,
                            defaultView: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none"
                      >
                        {DEFAULT_VIEW_OPTIONS.map((entry) => (
                          <option key={entry} value={entry}>
                            {formatDefaultViewLabel(entry)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-3 text-xs font-semibold tracking-wide text-gray-300">
                      <input
                        type="checkbox"
                        checked={Boolean(preferencesDraft.compactMode)}
                        onChange={(event) =>
                          setPreferencesDraft((previous) => ({
                            ...previous,
                            compactMode: event.target.checked,
                          }))
                        }
                      />
                      Kompakt Mod
                    </label>

                    <label className="block text-xs font-semibold tracking-wide text-gray-300">
                      Kapatılan Bildirim Kimlikleri (virgülle ayırın)
                      <input
                        value={dismissedNoticeIdsInput}
                        onChange={(event) => setDismissedNoticeIdsInput(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none"
                        placeholder="notice-a, notice-b"
                      />
                    </label>

                    <label className="block text-xs font-semibold tracking-wide text-gray-300">
                      Gelişmiş Yerleşim Modu
                      <select
                        value={preferencesDraft.advancedLayoutMode || ''}
                        onChange={(event) =>
                          setPreferencesDraft((previous) => ({
                            ...previous,
                            advancedLayoutMode: event.target.value || null,
                          }))
                        }
                        disabled={!advancedPreferencesCapability.available}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none disabled:opacity-60"
                      >
                        <option value="">Kapali</option>
                        <option value="focus">Odak</option>
                        <option value="split">Bölünmüş</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      onClick={savePreferences}
                      disabled={preferencesSaveState === 'saving'}
                      className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:opacity-60"
                    >
                      {preferencesSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                    <div className="text-xs text-gray-300">
                      {preferencesSaveMessage || ' '}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
                  <div className="text-lg font-black tracking-tight text-white">
                    Durum Komutu Ayarı
                  </div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-gray-500">
                    Uc nokta: GET/PUT /api/dashboard/protected/bot-settings/status-command
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="block text-xs font-semibold tracking-wide text-gray-300">
                      Detay Modu
                      <select
                        value={statusCommandDetailModeDraft}
                        onChange={(event) =>
                          setStatusCommandDetailModeDraft(event.target.value === 'compact' ? 'compact' : 'legacy')
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none"
                      >
                        <option value="legacy">Klasik</option>
                        <option value="compact">Kompakt</option>
                      </select>
                    </label>
                    <div className="text-xs text-gray-300">
                      Etkin: {statusCommandEffectiveMode === 'compact' ? 'kompakt' : 'klasik'}
                    </div>
                    <div className="text-xs text-gray-400">
                      Güncellenme zamanı: {statusCommandSettings?.updatedAt || '-'}
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      onClick={saveStatusCommandSettings}
                      disabled={statusCommandSaveState === 'saving'}
                      className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:opacity-60"
                    >
                      {statusCommandSaveState === 'saving'
                        ? 'Kaydediliyor...'
                        : 'Kaydet'}
                    </button>
                    <div className="text-xs text-gray-300">
                      {statusCommandSaveMessage || ' '}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <DashboardToast toast={toast} />
    </div>
  );
}
