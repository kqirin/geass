import { useMemo, useState } from 'react';
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

const DASHBOARD_SECTIONS = Object.freeze([
  {
    id: 'overview',
    label: 'Genel Bakış',
    hint: 'Kullanıcı, sunucu, paket ve sistem özeti',
  },
  {
    id: 'preferences',
    label: 'Panel Tercihleri',
    hint: 'Görünüm ve kişisel panel ayarları',
  },
  {
    id: 'status',
    label: 'Durum Komutu',
    hint: 'Durum komutu sunum biçimi',
  },
  {
    id: 'premium',
    label: 'Paket / Premium',
    hint: 'Plan durumu ve premium özellikler',
  },
]);

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
  if (normalizedStatus === 'resolved') return 'Hazır';
  if (normalizedStatus === 'unresolved') return 'Belirsiz';
  return normalizedStatus;
}

function formatPlanSource(rawSource) {
  const normalizedSource = String(rawSource || '').trim().toLowerCase();
  if (!normalizedSource) return 'Belirsiz';
  if (normalizedSource === 'repository') return 'Depo';
  if (normalizedSource === 'manual_override') return 'Manuel';
  if (normalizedSource === 'default') return 'Varsayılan';
  if (normalizedSource === 'unresolved') return 'Belirsiz';
  return normalizedSource;
}

function formatDefaultViewLabel(entry = '') {
  return DEFAULT_VIEW_OPTION_LABELS[entry] || entry;
}

function toPlanTone(rawTier = '') {
  const normalizedTier = String(rawTier || '').trim().toLowerCase();
  if (normalizedTier === 'pro' || normalizedTier === 'enterprise') {
    return {
      badgeClass:
        'border-cyan-400/35 bg-cyan-500/20 text-cyan-100',
      borderClass: 'border-cyan-400/20',
    };
  }
  if (normalizedTier === 'free') {
    return {
      badgeClass:
        'border-amber-400/35 bg-amber-500/15 text-amber-100',
      borderClass: 'border-amber-400/20',
    };
  }
  return {
    badgeClass:
      'border-white/20 bg-white/10 text-white/80',
    borderClass: 'border-white/10',
  };
}

function toSaveFeedbackTone(saveState = 'idle') {
  if (saveState === 'success') {
    return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100';
  }
  if (saveState === 'error') {
    return 'border-rose-400/35 bg-rose-500/10 text-rose-100';
  }
  if (saveState === 'saving') {
    return 'border-amber-400/35 bg-amber-500/10 text-amber-100';
  }
  return 'border-white/10 bg-white/5 text-white/70';
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

function GlassCard({ title, children, subtitle = '' }) {
  return (
    <section className="rounded-[1.8rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-400">
        {title}
      </div>
      {subtitle ? <div className="mt-2 text-xs text-gray-400">{subtitle}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SectionNavigation({ activeSection, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {DASHBOARD_SECTIONS.map((section) => {
        const active = activeSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => onChange(section.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${
              active
                ? 'border-cyan-400/35 bg-cyan-500/15'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <div
              className={`text-sm font-semibold tracking-wide ${
                active ? 'text-cyan-100' : 'text-white'
              }`}
            >
              {section.label}
            </div>
            <div className={`mt-1 text-xs ${active ? 'text-cyan-200/80' : 'text-gray-400'}`}>
              {section.hint}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SaveFeedback({ saveState = 'idle', message = '', idleText = '' }) {
  const resolvedMessage =
    String(message || '').trim() ||
    (saveState === 'saving' ? 'Kaydediliyor...' : idleText);
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs ${toSaveFeedbackTone(saveState)}`}
    >
      {resolvedMessage}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('overview');
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
    ? 'Premium tercih özelliği kullanılabilir.'
    : 'Bu özellik Pro pakette kullanılabilir.';
  const statusCommandEffectiveMode = String(
    statusCommandSettings?.effective?.detailMode || 'legacy'
  ).toLowerCase();
  const statusCommandEffectiveLabel =
    statusCommandEffectiveMode === 'compact' ? 'Kompakt' : 'Klasik';
  const planTone = toPlanTone(effectivePlan?.tier);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => String(guild?.id || '') === String(guildId || '')) || null,
    [guildId, guilds]
  );

  const canSaveSettings = Boolean(selectedGuild?.id || guildId);

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
          userDisplayName={authenticatedUserSummary?.displayName || 'Misafir'}
          userHandle={
            authenticatedUserSummary?.username
              ? `@${authenticatedUserSummary.username}`
              : '@misafir'
          }
          userId={authenticatedUserSummary?.id || null}
        />

        <SystemHealthCard
          overview={overview}
          viewState={viewState}
          preferencesSaveState={preferencesSaveState}
          statusCommandSaveState={statusCommandSaveState}
        />

        <div className="mt-8 space-y-7">
          {viewState === DASHBOARD_VIEW_STATES.LOADING ? (
            <StateCard
              title="Panel Hazırlanıyor"
              description="Oturum ve panel verileri güvenli olarak yükleniyor."
              actionLabel="Yenile"
              onAction={refreshAuth}
              detail={
                isAuthLoading
                  ? 'Kimlik doğrulama durumu kontrol ediliyor.'
                  : isProtectedLoading
                    ? 'Korumalı panel verileri getiriliyor.'
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
              title="Sunucu Erişimi Yok"
              description="Bu sunucu için panel erişimi şu an kullanılamıyor."
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
              description="Veriler güvenli modda tutuldu. Tekrar deneyebilirsin."
              actionLabel="Oturumu Yenile"
              onAction={refreshAuth}
              secondaryActionLabel="Veriyi Yenile"
              onSecondaryAction={refreshProtectedData}
              detail={authError?.message || protectedError?.message || 'unknown_error'}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.READY ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="text-3xl font-black tracking-tight text-white">
                  Geass Yönetim Paneli
                </div>
                <div className="text-sm text-white/65">
                  Sunucu ayarlarını tek merkezden güvenli şekilde yönet. Güncel durum,
                  tercihler ve premium yetenekler bu panelde.
                </div>
              </div>

              <SectionNavigation
                activeSection={activeSection}
                onChange={setActiveSection}
              />

              {activeSection === 'overview' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-white/70">
                      Seçili bölüm: <span className="font-semibold text-white">Genel Bakış</span>
                    </div>
                    <button
                      onClick={refreshProtectedData}
                      className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold tracking-wide text-white/90 transition-all hover:bg-white/10"
                    >
                      Yenile
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <GlassCard title="Kullanıcı" subtitle="Kimlik ve oturum özeti">
                      <div className="text-xl font-black text-white">
                        {authenticatedUserSummary?.displayName || 'Bilinmiyor'}
                      </div>
                      <div className="mt-1 text-sm text-gray-400">
                        @{authenticatedUserSummary?.username || 'bilinmiyor'}
                      </div>
                      <div className="mt-4 space-y-1 text-xs text-gray-300">
                        <div>ID: {authenticatedUserSummary?.id || '-'}</div>
                        <div>Sunucu sayısı: {authenticatedUserSummary?.guildCount || 0}</div>
                        <div>
                          Operatör sunucu: {authenticatedUserSummary?.operatorGuildCount || 0}
                        </div>
                        <div>Oturum: {session?.id ? 'Açık' : 'Bilinmiyor'}</div>
                      </div>
                    </GlassCard>

                    <GlassCard title="Sunucu" subtitle="Aktif hedef sunucu">
                      <div className="text-xl font-black text-white">
                        {selectedGuild?.name || activeGuildName || 'Sunucu bulunamadı'}
                      </div>
                      <div className="mt-4 space-y-1 text-xs text-gray-300">
                        <div>ID: {selectedGuild?.id || guildId || '-'}</div>
                        <div>Operatör yetkisi: {selectedGuild?.isOperator ? 'Evet' : 'Hayır'}</div>
                        <div>Çoklu seçim: {canSelectGuild ? 'Açık' : 'Kapalı'}</div>
                        <div>Mod: {singleGuildMode ? 'Tek sunucu' : 'Çoklu sunucu'}</div>
                      </div>
                    </GlassCard>

                    <GlassCard title="Paket" subtitle="Plan ve erişim bilgisi">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${planTone.badgeClass}`}
                        >
                          {formatPlanTier(effectivePlan?.tier)}
                        </span>
                        <span className="text-xs text-gray-300">
                          Durum: {formatPlanStatus(effectivePlan?.status)}
                        </span>
                      </div>
                      <div className="mt-4 space-y-1 text-xs text-gray-300">
                        <div>Kaynak: {formatPlanSource(effectivePlan?.source)}</div>
                        <div>Teknik kod: {effectivePlan?.reasonCode || '-'}</div>
                      </div>
                    </GlassCard>

                    <GlassCard title="Özellikler" subtitle="Kapasite özeti">
                      <div className="space-y-1 text-xs text-gray-300">
                        <div>
                          Kullanılabilir: {capabilitySummary.allowedCapabilities} /{' '}
                          {capabilitySummary.totalCapabilities}
                        </div>
                        <div>Kısıtlı: {capabilitySummary.deniedCapabilities}</div>
                        <div>Aktif: {capabilitySummary.activeCapabilities}</div>
                      </div>
                      <div
                        className={`mt-4 rounded-xl border px-3 py-2 text-xs ${
                          advancedPreferencesCapability.available
                            ? 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100'
                            : 'border-amber-400/25 bg-amber-500/10 text-amber-100'
                        }`}
                      >
                        {advancedCapabilityText}
                      </div>
                      <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-gray-500">
                        Geliştirici: {Object.keys(capabilities || {}).join(', ') || 'kayıt yok'}
                      </div>
                    </GlassCard>
                  </div>
                </div>
              ) : null}

              {activeSection === 'preferences' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <GlassCard title="Panel Tercihleri" subtitle="Görünüm ve kişisel ayarlar">
                      <div className="space-y-4">
                        <label className="block text-xs font-semibold tracking-wide text-gray-300">
                          Varsayılan Sekme
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
                            <option value="">Kapalı</option>
                            <option value="focus">Odak</option>
                            <option value="split">Bölünmüş</option>
                          </select>
                        </label>
                        {!advancedPreferencesCapability.available ? (
                          <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                            Bu özellik Pro pakette kullanılabilir.
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <button
                            onClick={savePreferences}
                            disabled={!canSaveSettings || preferencesSaveState === 'saving'}
                            className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:opacity-60"
                          >
                            {preferencesSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                          </button>
                          <button
                            onClick={refreshProtectedData}
                            className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-semibold tracking-wide text-white/90 transition-all hover:bg-white/10"
                          >
                            Yenile
                          </button>
                        </div>
                      </div>
                    </GlassCard>
                  </div>

                  <div className="space-y-4">
                    <GlassCard title="Kaydetme Durumu">
                      <SaveFeedback
                        saveState={preferencesSaveState}
                        message={preferencesSaveMessage}
                        idleText="Tercih değiştirip kaydedebilirsin."
                      />
                    </GlassCard>
                    <GlassCard title="Geliştirici Notu">
                      <div className="text-[11px] text-gray-500">
                        GET/PUT /api/dashboard/protected/preferences
                      </div>
                    </GlassCard>
                  </div>
                </div>
              ) : null}

              {activeSection === 'status' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <GlassCard title="Durum Komutu" subtitle="Komut cevap biçimi ayarları">
                      <div className="space-y-4">
                        <label className="block text-xs font-semibold tracking-wide text-gray-300">
                          Detay Modu
                          <select
                            value={statusCommandDetailModeDraft}
                            onChange={(event) =>
                              setStatusCommandDetailModeDraft(
                                event.target.value === 'compact' ? 'compact' : 'legacy'
                              )
                            }
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none"
                          >
                            <option value="legacy">Klasik</option>
                            <option value="compact">Kompakt</option>
                          </select>
                        </label>

                        <div className="space-y-1 text-xs text-gray-300">
                          <div>Etkin mod: {statusCommandEffectiveLabel}</div>
                          <div>Güncellenme zamanı: {statusCommandSettings?.updatedAt || '-'}</div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <button
                            onClick={saveStatusCommandSettings}
                            disabled={!canSaveSettings || statusCommandSaveState === 'saving'}
                            className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:opacity-60"
                          >
                            {statusCommandSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                          </button>
                          <button
                            onClick={refreshProtectedData}
                            className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-semibold tracking-wide text-white/90 transition-all hover:bg-white/10"
                          >
                            Yenile
                          </button>
                        </div>
                      </div>
                    </GlassCard>
                  </div>

                  <div className="space-y-4">
                    <GlassCard title="Kaydetme Durumu">
                      <SaveFeedback
                        saveState={statusCommandSaveState}
                        message={statusCommandSaveMessage}
                        idleText="Durum komutu ayarları burada kaydedilir."
                      />
                    </GlassCard>
                    <GlassCard title="Geliştirici Notu">
                      <div className="text-[11px] text-gray-500">
                        GET/PUT /api/dashboard/protected/bot-settings/status-command
                      </div>
                    </GlassCard>
                  </div>
                </div>
              ) : null}

              {activeSection === 'premium' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <GlassCard title="Paket Durumu" subtitle="Aktif plan özeti">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${planTone.badgeClass}`}
                      >
                        {formatPlanTier(effectivePlan?.tier)}
                      </span>
                      <span className="text-xs text-gray-300">
                        Durum: {formatPlanStatus(effectivePlan?.status)}
                      </span>
                    </div>
                    <div className="mt-4 space-y-1 text-xs text-gray-300">
                      <div>Kaynak: {formatPlanSource(effectivePlan?.source)}</div>
                      <div>Teknik kod: {effectivePlan?.reasonCode || '-'}</div>
                    </div>
                  </GlassCard>

                  <GlassCard title="Premium Özellikler" subtitle="Plan bazlı erişim">
                    <div className="space-y-3">
                      <div
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          advancedPreferencesCapability.available
                            ? 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100'
                            : 'border-amber-400/25 bg-amber-500/10 text-amber-100'
                        }`}
                      >
                        {advancedCapabilityText}
                      </div>
                      <div className="text-xs text-gray-300">
                        Gerekli paket: {formatPlanTier(advancedPreferencesCapability.requiredPlan)}
                      </div>
                      <button
                        onClick={refreshProtectedData}
                        className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold tracking-wide text-white/90 transition-all hover:bg-white/10"
                      >
                        Yenile
                      </button>
                    </div>
                  </GlassCard>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <DashboardToast toast={toast} />
    </div>
  );
}
