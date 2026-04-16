import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DashboardHeader from '../components/Dashboard/shell/DashboardHeader';
import SystemHealthCard from '../components/Dashboard/shell/SystemHealthCard';
import DashboardToast from '../components/Dashboard/shell/DashboardToast';
import { DASHBOARD_VIEW_STATES, useDashboardData } from '../hooks/useDashboardData';

const DEFAULT_VIEW_OPTIONS = ['overview', 'guild', 'features', 'resources', 'protected_overview'];
const DEFAULT_VIEW_OPTION_LABELS = Object.freeze({
  overview: 'Genel Bakış',
  guild: 'Sunucu',
  features: 'Özellikler',
  resources: 'Kaynaklar',
  protected_overview: 'Korumalı Genel Bakış',
});
const DASHBOARD_SECTIONS = Object.freeze([
  { id: 'overview', label: 'Genel Bakış', subtitle: 'Temel durum ve özet bilgiler' },
  { id: 'moderation', label: 'Moderasyon', subtitle: 'Moderasyon kontrol merkezi' },
  { id: 'auto-moderation', label: 'Oto Moderasyon', subtitle: 'Otomatik güvenlik kuralları' },
  { id: 'log-system', label: 'Log Sistemi', subtitle: 'Kayıt ve denetim akışları' },
  { id: 'private-rooms', label: 'Özel Oda Sistemi', subtitle: 'Özel oda yönetimi' },
  { id: 'role-reactions', label: 'Rol / Tepki Rolleri', subtitle: 'Rol ve tepki akışları' },
  { id: 'command-settings', label: 'Komut Ayarları', subtitle: 'Komut görünüm ayarları' },
  { id: 'premium', label: 'Premium', subtitle: 'Paket ve kilitli özellikler' },
  { id: 'server-settings', label: 'Sunucu Ayarları', subtitle: 'Panel tercihleri' },
]);
const STATUS_META = Object.freeze({
  active: { label: 'Aktif', className: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100' },
  off: { label: 'Kapalı', className: 'border-rose-400/35 bg-rose-500/15 text-rose-100' },
  soon: { label: 'Yakında', className: 'border-amber-400/35 bg-amber-500/15 text-amber-100' },
  pro: { label: 'Pro', className: 'border-cyan-400/35 bg-cyan-500/15 text-cyan-100' },
});
const PLACEHOLDER_SECTIONS = Object.freeze({
  moderation: {
    title: 'Moderasyon',
    subtitle: 'Temel moderasyon kontrolleri',
    items: [
      {
        title: 'Moderasyon sistemi',
        desc: 'Ban, kick, mute ve benzeri komut akışları.',
        status: 'active',
        placeholder: 'Mevcut moderasyon akışı çalışıyor. Gelişmiş panel yönetimi yakında.',
      },
      { title: 'Log kanalı', desc: 'Moderasyon log kanalını belirleme.', status: 'soon' },
      { title: 'Yetkili rol', desc: 'Moderasyon yetki rolünü belirleme.', status: 'soon' },
      { title: 'Mute rolü', desc: 'Susturma rolü yönetimi.', status: 'soon' },
      { title: 'Ban/Kick kayıtları', desc: 'Ceza geçmişi görünümü.', status: 'soon' },
    ],
  },
  'auto-moderation': {
    title: 'Oto Moderasyon',
    subtitle: 'Otomatik koruma kuralları',
    items: [
      { title: 'Spam koruması', desc: 'Tekrarlayan mesaj algısı.', status: 'soon' },
      { title: 'Küfür filtresi', desc: 'Kelime bazlı filtreleme.', status: 'pro' },
      { title: 'Bağlantı engeli', desc: 'Şüpheli link tespiti.', status: 'pro' },
    ],
  },
  'log-system': {
    title: 'Log Sistemi',
    subtitle: 'Kayıt ve raporlama görünümü',
    items: [
      { title: 'Moderasyon logları', desc: 'Ceza ve aksiyon kayıtları.', status: 'soon' },
      { title: 'Komut logları', desc: 'Komut kullanım geçmişi.', status: 'soon' },
      { title: 'Sistem olayları', desc: 'Sunucu olay değişimleri.', status: 'soon' },
    ],
  },
  'private-rooms': {
    title: 'Özel Oda Sistemi',
    subtitle: 'Özel oda yönetim ayarları',
    items: [
      { title: 'Sistem durumu', desc: 'Özel oda altyapısı aktifliği.', status: 'soon' },
      { title: 'Oda limiti', desc: 'Sunucu başına oda limiti.', status: 'soon' },
      { title: 'Sahip transferi', desc: 'Oda sahipliği devri.', status: 'soon' },
      { title: 'İzin verilen roller', desc: 'Özel oda erişim rolleri.', status: 'soon' },
    ],
  },
  'role-reactions': {
    title: 'Rol / Tepki Rolleri',
    subtitle: 'Rol dağıtım akışları',
    items: [
      { title: 'Tepki rol sistemi', desc: 'Mesaj tepkisine göre rol verme.', status: 'soon' },
      { title: 'Kendi rolünü seç', desc: 'Üye bazlı rol seçimi.', status: 'pro' },
      { title: 'Rol eşleme', desc: 'Tepki-rol eşleşme yönetimi.', status: 'soon' },
    ],
  },
});

function formatPlanTier(rawTier) {
  const t = String(rawTier || '').trim().toLowerCase();
  if (!t) return 'Belirsiz Paket';
  if (t === 'free') return 'Ücretsiz Paket';
  if (t === 'pro') return 'Pro Paket';
  if (t === 'enterprise') return 'Kurumsal Paket';
  if (t === 'unresolved') return 'Belirsiz Paket';
  return `${t.toUpperCase()} Paket`;
}
function formatPlanStatus(rawStatus) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (!s) return 'Belirsiz';
  if (s === 'resolved') return 'Hazır';
  if (s === 'unresolved') return 'Belirsiz';
  return s;
}
function formatPlanSource(rawSource) {
  const s = String(rawSource || '').trim().toLowerCase();
  if (!s) return 'Belirsiz';
  if (s === 'repository') return 'Depo';
  if (s === 'manual_override') return 'Manuel';
  if (s === 'default') return 'Varsayılan';
  if (s === 'unresolved') return 'Belirsiz';
  return s;
}
function formatDefaultViewLabel(entry = '') {
  return DEFAULT_VIEW_OPTION_LABELS[entry] || entry;
}
function toPlanTone(rawTier = '') {
  const t = String(rawTier || '').trim().toLowerCase();
  if (t === 'pro' || t === 'enterprise') return 'border-cyan-400/35 bg-cyan-500/20 text-cyan-100';
  if (t === 'free') return 'border-amber-400/35 bg-amber-500/15 text-amber-100';
  return 'border-white/20 bg-white/10 text-white/80';
}
function toSaveFeedbackTone(state = 'idle') {
  if (state === 'success') return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100';
  if (state === 'error') return 'border-rose-400/35 bg-rose-500/10 text-rose-100';
  if (state === 'saving') return 'border-amber-400/35 bg-amber-500/10 text-amber-100';
  return 'border-white/10 bg-white/5 text-white/70';
}

function StatusBadge({ status = 'soon' }) {
  const meta = STATUS_META[status] || STATUS_META.soon;
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.className}`}>
      {meta.label}
    </span>
  );
}
function StateCard({ title, description, actionLabel, onAction, secondaryActionLabel, onSecondaryAction, detail = null }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#141425]/90 p-8 shadow-2xl shadow-black/20">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">Durum</div>
      <div className="mt-2 text-2xl font-black tracking-tight text-white">{title}</div>
      <div className="mt-3 text-sm leading-relaxed text-gray-300">{description}</div>
      {detail ? <div className="mt-4 rounded-2xl border border-white/10 bg-[#0e0e19] px-4 py-3 text-xs text-gray-300">{detail}</div> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {actionLabel && onAction ? <button onClick={onAction} className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30">{actionLabel}</button> : null}
        {secondaryActionLabel && onSecondaryAction ? <button onClick={onSecondaryAction} className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-bold tracking-wide text-white/85 transition-all hover:bg-white/10">{secondaryActionLabel}</button> : null}
      </div>
    </div>
  );
}
function Card({ title, subtitle = '', children }) {
  return (
    <section className="rounded-[1.6rem] border border-white/10 bg-[#16162a]/85 p-6 shadow-2xl shadow-black/20">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">{title}</div>
      {subtitle ? <div className="mt-1.5 text-xs text-gray-400">{subtitle}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
function DeveloperNote({ children }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-500">{children}</div>;
}
function SaveFeedback({ saveState = 'idle', message = '', idleText = '' }) {
  const text = String(message || '').trim() || (saveState === 'saving' ? 'Kaydediliyor...' : idleText);
  return <div className={`rounded-xl border px-3 py-2 text-xs ${toSaveFeedbackTone(saveState)}`}>{text}</div>;
}
function EmptyState({ title, description }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#121221]/80 px-4 py-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs text-gray-400">{description}</div>
    </div>
  );
}
function PlaceholderItem({ title, desc, status = 'soon', placeholder = 'Bu ayar yakında aktif olacak.' }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0f0f1b]/70 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">{title}</div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-1 text-xs text-gray-400">{desc}</div>
      <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-500">{placeholder}</div>
    </div>
  );
}
function Sidebar({ activeSection, setActiveSection, planLabel }) {
  return (
    <aside className="rounded-[1.4rem] border border-white/10 bg-[#121221]/85 p-4 shadow-xl shadow-black/20">
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/55">Aktif Paket</div>
        <div className="mt-1 text-sm font-semibold text-white">{planLabel}</div>
      </div>
      <nav className="mt-4 space-y-2">
        {DASHBOARD_SECTIONS.map((s) => {
          const active = s.id === activeSection;
          return (
            <button key={s.id} onClick={() => setActiveSection(s.id)} className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all ${active ? 'border-cyan-400/35 bg-cyan-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
              <div className={`text-sm font-semibold ${active ? 'text-cyan-100' : 'text-white'}`}>{s.label}</div>
              <div className={`mt-1 text-[11px] ${active ? 'text-cyan-100/70' : 'text-gray-500'}`}>{s.subtitle}</div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('overview');
  const {
    viewState, isAuthLoading, isProtectedLoading, authStatus, authError, protectedError, toast,
    login, logout, refreshAuth, refreshProtectedData, guilds, guildId, setGuildId, canSelectGuild, singleGuildMode,
    activeGuildName, authenticatedUserSummary, session, effectivePlan, capabilities, capabilitySummary,
    advancedPreferencesCapability, overview, preferencesDraft, setPreferencesDraft, dismissedNoticeIdsInput,
    setDismissedNoticeIdsInput, preferencesSaveState, preferencesSaveMessage, savePreferences,
    statusCommandSettings, statusCommandEnabledDraft, setStatusCommandEnabledDraft,
    statusCommandDetailModeDraft, setStatusCommandDetailModeDraft,
    statusCommandSaveState, statusCommandSaveMessage, saveStatusCommandSettings,
  } = useDashboardData({ navigate });

  const isAuthenticated = Boolean(authenticatedUserSummary?.id);
  const authUnavailableDetail = authStatus?.auth?.reasonCode || authStatus?.reasonCode || authError?.reasonCode || protectedError?.reasonCode || 'auth_not_configured';
  const noAccessDetail = protectedError?.reasonCode || authError?.reasonCode || 'guild_scope_unresolved';
  const advancedText = advancedPreferencesCapability.available ? 'Premium tercih özelliği kullanılabilir.' : 'Bu özellik Pro pakette kullanılabilir.';
  const statusMode = String(
    statusCommandSettings?.effective?.durum?.detailMode ||
      statusCommandSettings?.effective?.detailMode ||
      'legacy'
  ).toLowerCase();
  const statusModeLabel = statusMode === 'compact' ? 'Kompakt' : 'Klasik';
  const statusEnabled =
    typeof statusCommandSettings?.effective?.durum?.enabled === 'boolean'
      ? statusCommandSettings.effective.durum.enabled
      : typeof statusCommandSettings?.effective?.enabled === 'boolean'
        ? statusCommandSettings.effective.enabled
        : Boolean(statusCommandEnabledDraft);
  const selectedGuild = useMemo(() => guilds.find((g) => String(g?.id || '') === String(guildId || '')) || null, [guildId, guilds]);
  const planLabel = formatPlanTier(effectivePlan?.tier);
  const planTone = toPlanTone(effectivePlan?.tier);
  const canSaveSettings = Boolean(String(guildId || '').trim());
  const isProPlan = ['pro', 'enterprise'].includes(String(effectivePlan?.tier || '').trim().toLowerCase());

  const renderPlaceholderSection = (sectionId) => {
    const section = PLACEHOLDER_SECTIONS[sectionId];
    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={section.title} subtitle={section.subtitle}>
          <div className="space-y-3">
            {section.items.map((item) => (
              <PlaceholderItem key={item.title} {...item} />
            ))}
          </div>
        </Card>
        <Card title="Durum">
          <EmptyState title="Bu ayarlar henüz panelden düzenlenemiyor" description="Bu ayar yakında aktif olacak." />
        </Card>
      </div>
    );
  };

  const renderReady = () => {
    if (PLACEHOLDER_SECTIONS[activeSection]) return renderPlaceholderSection(activeSection);
    if (activeSection === 'overview') {
      return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="Kullanıcı" subtitle="Kimlik ve oturum bilgisi">
            <div className="text-xl font-black text-white">{authenticatedUserSummary?.displayName || 'Bilinmiyor'}</div>
            <div className="mt-1 text-sm text-gray-400">@{authenticatedUserSummary?.username || 'bilinmiyor'}</div>
            <div className="mt-4 space-y-1 text-xs text-gray-300">
              <div>ID: {authenticatedUserSummary?.id || '-'}</div>
              <div>Sunucu sayısı: {authenticatedUserSummary?.guildCount || 0}</div>
              <div>Operatör sunucu: {authenticatedUserSummary?.operatorGuildCount || 0}</div>
              <div>Oturum: {session?.id ? 'Açık' : 'Bilinmiyor'}</div>
            </div>
          </Card>
          <Card title="Sunucu" subtitle="Seçili sunucu özeti">
            <div className="text-xl font-black text-white">{selectedGuild?.name || activeGuildName || 'Sunucu bulunamadı'}</div>
            <div className="mt-4 space-y-1 text-xs text-gray-300">
              <div>ID: {selectedGuild?.id || guildId || '-'}</div>
              <div>Operatör yetkisi: {selectedGuild?.isOperator ? 'Evet' : 'Hayır'}</div>
              <div>Seçim modu: {canSelectGuild ? 'Çoklu sunucu' : 'Tek sunucu'}</div>
            </div>
          </Card>
          <Card title="Paket" subtitle="Mevcut plan ve erişim seviyesi">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${planTone}`}>{planLabel}</span>
              <StatusBadge status={isProPlan ? 'pro' : 'active'} />
            </div>
            <div className="mt-4 space-y-1 text-xs text-gray-300">
              <div>Durum: {formatPlanStatus(effectivePlan?.status)}</div>
              <div>Kaynak: {formatPlanSource(effectivePlan?.source)}</div>
              <div>Teknik kod: {effectivePlan?.reasonCode || '-'}</div>
            </div>
          </Card>
          <Card title="Özellikler" subtitle="Yetki ve kapasite özeti">
            <div className="space-y-1 text-xs text-gray-300">
              <div>Kullanılabilir: {capabilitySummary.allowedCapabilities} / {capabilitySummary.totalCapabilities}</div>
              <div>Kısıtlı: {capabilitySummary.deniedCapabilities}</div>
              <div>Aktif: {capabilitySummary.activeCapabilities}</div>
            </div>
            <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${advancedPreferencesCapability.available ? 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100' : 'border-amber-400/25 bg-amber-500/10 text-amber-100'}`}>{advancedText}</div>
            <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-gray-500">Geliştirici: {Object.keys(capabilities || {}).join(', ') || 'kayıt yok'}</div>
          </Card>
        </div>
      );
    }
    if (activeSection === 'command-settings') {
      return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card title="Komut Ayarlari" subtitle="Gercek komut kontrol merkezi">
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-[#0f0f1b]/80 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">.durum komutu</div>
                      <div className="mt-1 text-xs text-gray-400">
                        Sunucu durum komutunu ac/kapat ve gorunum modunu belirle.
                      </div>
                    </div>
                    <StatusBadge status={statusEnabled ? 'active' : 'off'} />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block text-xs font-semibold tracking-wide text-gray-300">
                      Komut Durumu
                      <select
                        value={statusCommandEnabledDraft ? 'enabled' : 'disabled'}
                        onChange={(e) => setStatusCommandEnabledDraft(e.target.value === 'enabled')}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none"
                      >
                        <option value="enabled">Acik</option>
                        <option value="disabled">Kapali</option>
                      </select>
                    </label>
                    <label className="block text-xs font-semibold tracking-wide text-gray-300">
                      Detay Modu
                      <select
                        value={statusCommandDetailModeDraft}
                        onChange={(e) =>
                          setStatusCommandDetailModeDraft(
                            e.target.value === 'compact' ? 'compact' : 'legacy'
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none"
                      >
                        <option value="legacy">Klasik</option>
                        <option value="compact">Kompakt</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 space-y-1 text-xs text-gray-300">
                    <div>Etkin mod: {statusModeLabel}</div>
                    <div>Komut durumu: {statusEnabled ? 'Acik' : 'Kapali'}</div>
                    <div>Guncellenme zamani: {statusCommandSettings?.updatedAt || '-'}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-500">
                  Yakinda: diger komutlar icin ayarlar bu alana eklenecek.
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button onClick={saveStatusCommandSettings} disabled={!canSaveSettings || statusCommandSaveState === 'saving'} className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:opacity-60">{statusCommandSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}</button>
                  <button onClick={refreshProtectedData} className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-semibold tracking-wide text-white/90 transition-all hover:bg-white/10">Yenile</button>
                </div>
              </div>
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Kaydetme Durumu">
              <SaveFeedback saveState={statusCommandSaveState} message={statusCommandSaveMessage} idleText="Durum komutu ayarlari buradan kaydedilir." />
            </Card>
            <DeveloperNote>Gelistirici: GET/PUT /api/dashboard/protected/bot-settings/commands</DeveloperNote>
          </div>
        </div>
      );
    }
    if (activeSection === 'premium') {
      return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="Paketler" subtitle="Mevcut plan görünümü">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className={`rounded-xl border p-4 ${isProPlan ? 'border-white/10 bg-white/5' : 'border-amber-400/25 bg-amber-500/10'}`}>
                <div className="text-sm font-semibold text-white">Ücretsiz Paket</div>
                <div className="mt-2 text-xs text-gray-300">Temel panel özellikleri ve standart yönetim akışı.</div>
                <div className="mt-3"><StatusBadge status={isProPlan ? 'off' : 'active'} /></div>
              </div>
              <div className={`rounded-xl border p-4 ${isProPlan ? 'border-cyan-400/25 bg-cyan-500/10' : 'border-white/10 bg-white/5'}`}>
                <div className="text-sm font-semibold text-white">Pro Paket</div>
                <div className="mt-2 text-xs text-gray-300">Gelişmiş otomasyon, premium görünüm ve kilitli özellikler.</div>
                <div className="mt-3"><StatusBadge status={isProPlan ? 'active' : 'pro'} /></div>
              </div>
            </div>
            <div className="mt-4 text-xs text-gray-300">Aktif plan: <span className="font-semibold text-white">{planLabel}</span></div>
          </Card>
          <Card title="Kilitli Özellikler" subtitle="Pro gerektiren alanlar">
            <div className="space-y-3">
              <PlaceholderItem title="Gelişmiş panel tercihleri" desc="Alternatif yerleşim ve premium görünüm modları." status={isProPlan ? 'active' : 'pro'} placeholder={isProPlan ? 'Bu özellik paketinize açık.' : 'Bu özellik Pro pakette kullanılabilir.'} />
              <PlaceholderItem title="Akıllı oto moderasyon" desc="Pro seviyesinde güvenlik kuralları." status={isProPlan ? 'active' : 'pro'} placeholder={isProPlan ? 'Bu özellik paketinize açık.' : 'Bu özellik Pro pakette kullanılabilir.'} />
            </div>
          </Card>
        </div>
      );
    }
    if (activeSection === 'server-settings') {
      return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card title="Sunucu Ayarları" subtitle="Panel Tercihleri (aktif)">
              <div className="space-y-4">
                <label className="block text-xs font-semibold tracking-wide text-gray-300">
                  Varsayılan Sekme
                  <select value={preferencesDraft.defaultView} onChange={(e) => setPreferencesDraft((p) => ({ ...p, defaultView: e.target.value }))} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none">
                    {DEFAULT_VIEW_OPTIONS.map((entry) => <option key={entry} value={entry}>{formatDefaultViewLabel(entry)}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-3 text-xs font-semibold tracking-wide text-gray-300">
                  <input type="checkbox" checked={Boolean(preferencesDraft.compactMode)} onChange={(e) => setPreferencesDraft((p) => ({ ...p, compactMode: e.target.checked }))} />
                  Kompakt Mod
                </label>
                <label className="block text-xs font-semibold tracking-wide text-gray-300">
                  Kapatılan Bildirim Kimlikleri (virgülle ayırın)
                  <input value={dismissedNoticeIdsInput} onChange={(e) => setDismissedNoticeIdsInput(e.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none" placeholder="notice-a, notice-b" />
                </label>
                <label className="block text-xs font-semibold tracking-wide text-gray-300">
                  Gelişmiş Yerleşim Modu
                  <select value={preferencesDraft.advancedLayoutMode || ''} onChange={(e) => setPreferencesDraft((p) => ({ ...p, advancedLayoutMode: e.target.value || null }))} disabled={!advancedPreferencesCapability.available} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-sm outline-none disabled:opacity-60">
                    <option value="">Kapalı</option>
                    <option value="focus">Odak</option>
                    <option value="split">Bölünmüş</option>
                  </select>
                </label>
                {!advancedPreferencesCapability.available ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Bu özellik Pro pakette kullanılabilir.</div> : null}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button onClick={savePreferences} disabled={!canSaveSettings || preferencesSaveState === 'saving'} className="rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-5 py-3 text-xs font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:opacity-60">{preferencesSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}</button>
                  <button onClick={refreshProtectedData} className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-semibold tracking-wide text-white/90 transition-all hover:bg-white/10">Yenile</button>
                </div>
              </div>
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Kaydetme Durumu">
              <SaveFeedback saveState={preferencesSaveState} message={preferencesSaveMessage} idleText="Sunucu tercihleriniz burada kaydedilir." />
            </Card>
            <DeveloperNote>Geliştirici: GET/PUT /api/dashboard/protected/preferences</DeveloperNote>
            <EmptyState title="Ek sunucu ayarları" description="Bu ayar yakında aktif olacak." />
          </div>
        </div>
      );
    }
    return <EmptyState title="Bölüm yüklenemedi" description="Lütfen farklı bir bölüm seçin veya sayfayı yenileyin." />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0b14] via-[#0b0b14] to-[#07070f] text-white">
      <div className="mx-auto max-w-[1340px] px-6 pb-20 pt-10">
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
          userHandle={authenticatedUserSummary?.username ? `@${authenticatedUserSummary.username}` : '@misafir'}
          userId={authenticatedUserSummary?.id || null}
          planLabel={planLabel}
        />
        <SystemHealthCard overview={overview} viewState={viewState} preferencesSaveState={preferencesSaveState} statusCommandSaveState={statusCommandSaveState} />

        <div className="mt-8 space-y-7">
          {viewState === DASHBOARD_VIEW_STATES.LOADING ? (
            <StateCard
              title="Panel Hazırlanıyor"
              description="Oturum ve panel verileri güvenli olarak yükleniyor."
              actionLabel="Yenile"
              onAction={refreshAuth}
              detail={isAuthLoading ? 'Kimlik doğrulama durumu kontrol ediliyor.' : isProtectedLoading ? 'Korumalı panel verileri getiriliyor.' : 'Bekleniyor...'}
            />
          ) : null}
          {viewState === DASHBOARD_VIEW_STATES.UNAUTHENTICATED ? (
            <StateCard title="Oturum Bulunamadı" description="Paneli görmek için Discord hesabınla yeniden giriş yapmalısın." actionLabel="Discord ile Giriş" onAction={login} secondaryActionLabel="Yenile" onSecondaryAction={refreshAuth} detail="Teknik bilgi: GET /api/auth/login" />
          ) : null}
          {viewState === DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE ? (
            <StateCard title="Kimlik Doğrulama Kullanılamıyor" description="Kimlik doğrulama servisi şu anda hazır değil." actionLabel="Yenile" onAction={refreshAuth} detail={`Teknik kod: ${authUnavailableDetail}`} />
          ) : null}
          {viewState === DASHBOARD_VIEW_STATES.NO_ACCESS ? (
            <StateCard title="Sunucu Erişimi Yok" description="Bu sunucu için panel erişimi şu an kullanılamıyor." actionLabel="Veriyi Yenile" onAction={refreshProtectedData} secondaryActionLabel="Oturumu Yenile" onSecondaryAction={refreshAuth} detail={`Teknik kod: ${noAccessDetail}`} />
          ) : null}
          {viewState === DASHBOARD_VIEW_STATES.ERROR ? (
            <StateCard title="Panelde Beklenmeyen Hata" description="Veriler güvenli modda tutuldu. Tekrar deneyebilirsin." actionLabel="Oturumu Yenile" onAction={refreshAuth} secondaryActionLabel="Veriyi Yenile" onSecondaryAction={refreshProtectedData} detail={authError?.message || protectedError?.message || 'unknown_error'} />
          ) : null}
          {viewState === DASHBOARD_VIEW_STATES.READY ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="text-3xl font-black tracking-tight text-white">Geass Premium Yönetim Paneli</div>
                <div className="text-sm text-white/65">Sunucunu tek panelden yönet: moderasyon, komutlar, premium özellikler ve gelecek kontroller tek noktada.</div>
              </div>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]">
                <Sidebar activeSection={activeSection} setActiveSection={setActiveSection} planLabel={planLabel} />
                <main className="space-y-5">{renderReady()}</main>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <DashboardToast toast={toast} />
    </div>
  );
}


