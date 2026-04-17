import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DashboardHeader from '../components/Dashboard/shell/DashboardHeader';
import SystemHealthCard from '../components/Dashboard/shell/SystemHealthCard';
import DashboardToast from '../components/Dashboard/shell/DashboardToast';
import { DASHBOARD_VIEW_STATES, useDashboardData } from '../hooks/useDashboardData';
import {
  DEFAULT_LOGS_UNAVAILABLE_MESSAGE,
  getUnavailableLogsMessage,
  resolveLogsCategoryState,
} from '../lib/logsViewModel.js';
import {
  getSetupReadinessIssueCategory,
  getSetupReadinessStatusLabel,
  resolveSetupReadinessSectionState,
} from '../lib/setupReadinessViewModel.js';

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
  { id: 'setup-readiness', label: 'Kurulum Durumu', subtitle: 'Salt-okunur kurulum denetimi' },
  { id: 'log-system', label: 'Log Sistemi', subtitle: 'Kayıt ve denetim akışları' },
  { id: 'command-settings', label: 'Komut Ayarları', subtitle: 'Komut görünüm ayarları' },
  { id: 'moderation', label: 'Moderasyon', subtitle: 'Moderasyon kontrol merkezi' },
  { id: 'auto-moderation', label: 'Oto Moderasyon', subtitle: 'Otomatik güvenlik kuralları' },
  { id: 'private-rooms', label: 'Özel Oda Sistemi', subtitle: 'Özel oda yönetimi' },
  { id: 'role-reactions', label: 'Rol / Tepki Rolleri', subtitle: 'Rol ve tepki akışları' },
  { id: 'premium', label: 'Premium', subtitle: 'Paket ve kilitli özellikler' },
  { id: 'server-settings', label: 'Sunucu Ayarları', subtitle: 'Panel tercihleri' },
]);
const LOG_SYSTEM_TABS = Object.freeze([
  { id: 'moderation', label: 'Moderasyon Logları' },
  { id: 'commands', label: 'Komut Logları' },
  { id: 'system', label: 'Sistem Olayları' },
]);
const STATUS_META = Object.freeze({
  active: { label: 'Aktif', className: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100' },
  off: { label: 'Kapalı', className: 'border-rose-400/35 bg-rose-500/15 text-rose-100' },
  soon: { label: 'Yakında', className: 'border-amber-400/35 bg-amber-500/15 text-amber-100' },
  pro: { label: 'Pro', className: 'border-cyan-400/35 bg-cyan-500/15 text-cyan-100' },
});
const SETUP_READINESS_STATUS_META = Object.freeze({
  ready: {
    label: 'Hazır',
    className: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100',
  },
  warning: {
    label: 'Uyarı Var',
    className: 'border-amber-400/35 bg-amber-500/15 text-amber-100',
  },
  incomplete: {
    label: 'Eksik Kurulum',
    className: 'border-rose-400/35 bg-rose-500/15 text-rose-100',
  },
});
const SETUP_READINESS_ISSUE_META = Object.freeze({
  error: 'border-rose-400/35 bg-rose-500/10 text-rose-100',
  warning: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  info: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
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
function toSetupReadinessBadge(status = 'warning') {
  return SETUP_READINESS_STATUS_META[status] || SETUP_READINESS_STATUS_META.warning;
}
function toSetupIssueTone(severity = 'warning') {
  return SETUP_READINESS_ISSUE_META[severity] || SETUP_READINESS_ISSUE_META.warning;
}
function formatLogDate(value = null) {
  const parsedMs = Date.parse(String(value || ''));
  if (!Number.isFinite(parsedMs)) return '-';
  return new Date(parsedMs).toLocaleString('tr-TR');
}
function toLogHeadline(item = {}) {
  return (
    String(item?.action || '').trim() ||
    String(item?.commandName || '').trim() ||
    String(item?.eventType || '').trim() ||
    'Kayıt'
  );
}
function toLogSubtext(item = {}) {
  const targetUserId = String(item?.targetUserId || '').trim();
  const moderatorUserId = String(item?.moderatorUserId || '').trim();
  const actorUserId = String(item?.actorUserId || '').trim();
  const reason = String(item?.reason || '').trim();
  const reasonCode = String(item?.reasonCode || '').trim();
  const status = String(item?.status || '').trim();

  if (targetUserId && moderatorUserId) {
    return `Hedef: ${targetUserId} | Yetkili: ${moderatorUserId}`;
  }
  if (actorUserId) {
    return `Aktör: ${actorUserId}`;
  }
  if (reason) {
    return `Sebep: ${reason}`;
  }
  if (reasonCode) {
    return `Teknik kod: ${reasonCode}`;
  }
  if (status) {
    return `Durum: ${status}`;
  }
  return 'Detay kaydi bulunmuyor.';
}

function StatusBadge({ status = 'soon' }) {
  const meta = STATUS_META[status] || STATUS_META.soon;
  return (
    <span
      className={`geass-status-badge rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
function StateCard({ title, description, actionLabel, onAction, secondaryActionLabel, onSecondaryAction, detail = null }) {
  return (
    <div className="geass-glass-panel geass-glow-border rounded-[2rem] border p-7 shadow-2xl sm:p-8">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8fa4da]">Durum</div>
      <div className="mt-2 text-2xl font-black tracking-tight text-[#eef3ff]">{title}</div>
      <div className="mt-3 text-sm leading-relaxed text-[#bcc7e8]">{description}</div>
      {detail ? (
        <div className="geass-subpanel mt-4 rounded-2xl border px-4 py-3 text-xs text-[#c1cae9]">
          {detail}
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {actionLabel && onAction ? (
          <button onClick={onAction} className="geass-btn geass-btn-primary">
            {actionLabel}
          </button>
        ) : null}
        {secondaryActionLabel && onSecondaryAction ? (
          <button onClick={onSecondaryAction} className="geass-btn geass-btn-secondary">
            {secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
function Card({ title, subtitle = '', children }) {
  return (
    <section className="geass-glass-panel rounded-[1.6rem] border p-6 shadow-2xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9eabd0]">{title}</div>
      {subtitle ? <div className="mt-1.5 text-xs text-[#aeb9dc]">{subtitle}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
function DeveloperNote({ children }) {
  return (
    <div className="geass-subpanel rounded-xl border px-3 py-2 text-[11px] text-[#98a7ce]">{children}</div>
  );
}
function SaveFeedback({ saveState = 'idle', message = '', idleText = '' }) {
  const text = String(message || '').trim() || (saveState === 'saving' ? 'Kaydediliyor...' : idleText);
  return (
    <div className={`geass-subpanel rounded-xl border px-3 py-2 text-xs ${toSaveFeedbackTone(saveState)}`}>
      {text}
    </div>
  );
}
function EmptyState({ title, description }) {
  return (
    <div className="geass-subpanel rounded-2xl border px-4 py-5">
      <div className="text-sm font-semibold text-[#eef3ff]">{title}</div>
      <div className="mt-1 text-xs text-[#a8b5d8]">{description}</div>
    </div>
  );
}
function PlaceholderItem({ title, desc, status = 'soon', placeholder = 'Bu ayar yakında aktif olacak.' }) {
  return (
    <div className="geass-subpanel rounded-xl border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[#eef3ff]">{title}</div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-1 text-xs text-[#abb8db]">{desc}</div>
      <div className="geass-subpanel mt-3 rounded-lg border px-3 py-2 text-xs text-[#97a6cd]">
        {placeholder}
      </div>
    </div>
  );
}
function Sidebar({ activeSection, setActiveSection, planLabel }) {
  return (
    <aside className="geass-sidebar fixed left-0 top-0 z-30 hidden h-screen w-[280px] flex-col border-r lg:flex">
      <div className="geass-sidebar-brand">
        <div className="geass-sidebar-logo">G</div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#90a3d5]">Control Hub</div>
          <div className="text-xl font-black tracking-tight text-[#eef3ff]">GEASS</div>
        </div>
      </div>

      <div className="geass-subpanel mx-4 rounded-xl border px-3 py-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#8ea1d2]">Aktif Paket</div>
        <div className="mt-1 text-sm font-semibold text-[#eef3ff]">{planLabel}</div>
      </div>

      <nav className="mt-4 flex-1 space-y-1.5 px-3 pb-6">
        {DASHBOARD_SECTIONS.map((s) => {
          const active = s.id === activeSection;
          return (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              aria-current={active ? 'page' : undefined}
              className={`geass-sidebar-item w-full rounded-xl border px-3 py-3 text-left transition-all ${active ? 'is-active' : ''}`}
            >
              <div className={`text-sm font-semibold ${active ? 'text-[#ddc5ff]' : 'text-[#e8edff]'}`}>
                {s.label}
              </div>
              <div className={`mt-1 text-[11px] ${active ? 'text-[#c6a6f8]' : 'text-[#8c9ac2]'}`}>
                {s.subtitle}
              </div>
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
  const [activeLogTab, setActiveLogTab] = useState('moderation');
  const {
    viewState, isAuthLoading, isProtectedLoading, authStatus, authError, protectedError, toast,
    login, logout, refreshAuth, refreshProtectedData, guilds, guildId, setGuildId, canSelectGuild, singleGuildMode,
    activeGuildName, authenticatedUserSummary, session, effectivePlan, capabilities, capabilitySummary,
    advancedPreferencesCapability, overview, preferencesDraft, setPreferencesDraft, dismissedNoticeIdsInput,
    setDismissedNoticeIdsInput, preferencesSaveState, preferencesSaveMessage, savePreferences,
    setupReadiness, setupReadinessLoadError, logSystem,
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
  const setupReadinessState = resolveSetupReadinessSectionState({
    setupReadiness,
    isLoading: isProtectedLoading,
    error: setupReadinessLoadError,
  });
  const setupReadinessSummary = setupReadiness?.summary || {
    status: 'warning',
    score: 0,
    totalChecks: 0,
    passedChecks: 0,
    warningChecks: 0,
    failedChecks: 0,
  };
  const setupReadinessStatusLabel = getSetupReadinessStatusLabel(setupReadinessSummary.status);
  const setupReadinessBadgeMeta = toSetupReadinessBadge(setupReadinessSummary.status);
  const setupReadinessScore = Math.max(
    0,
    Math.min(100, Number(setupReadinessSummary.score || 0))
  );
  const setupReadinessSections = Array.isArray(setupReadiness?.sections)
    ? setupReadiness.sections
    : [];
  const setupReadinessIssues = Array.isArray(setupReadiness?.issues)
    ? setupReadiness.issues
    : [];
  const logCategories = useMemo(
    () => ({
      moderation: logSystem?.moderation || { payload: null, error: null },
      commands: logSystem?.commands || { payload: null, error: null },
      system: logSystem?.system || { payload: null, error: null },
    }),
    [logSystem]
  );
  const activeLogCategory = logCategories[activeLogTab] || logCategories.moderation;
  const activeLogState = resolveLogsCategoryState({
    payload: activeLogCategory?.payload || null,
    error: activeLogCategory?.error || null,
    isLoading: isProtectedLoading,
  });
  const activeLogItems = Array.isArray(activeLogCategory?.payload?.items)
    ? activeLogCategory.payload.items
    : [];
  const activeLogUnavailableMessage = getUnavailableLogsMessage(
    activeLogCategory?.payload || null
  );
  const isReadyView = viewState === DASHBOARD_VIEW_STATES.READY;
  const activeSectionMeta =
    DASHBOARD_SECTIONS.find((section) => section.id === activeSection) || DASHBOARD_SECTIONS[0];

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
    if (activeSection === 'log-system') {
      return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card title="Log Sistemi" subtitle="Salt-okunur log ve denetim kayıtları">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {LOG_SYSTEM_TABS.map((tab) => {
                    const isActive = tab.id === activeLogTab;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveLogTab(tab.id)}
                        className={`geass-log-tab rounded-xl border px-3 py-2 text-xs font-semibold tracking-wide transition-all ${
                          isActive ? 'is-active border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : ''
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {activeLogState === 'loading' ? (
                  <EmptyState
                    title="Log kayıtları yükleniyor"
                    description="Bu kategori için son kayıtlar getiriliyor."
                  />
                ) : null}

                {activeLogState === 'error' ? (
                  <EmptyState
                    title="Log kayıtları okunamadı"
                    description={
                      activeLogCategory?.error?.message ||
                      'Log verisi geçici olarak okunamadı.'
                    }
                  />
                ) : null}

                {activeLogState === 'unavailable' ? (
                  <EmptyState
                    title="Kaynak aktif değil"
                    description={
                      activeLogUnavailableMessage || DEFAULT_LOGS_UNAVAILABLE_MESSAGE
                    }
                  />
                ) : null}

                {activeLogState === 'empty' ? (
                  <EmptyState
                    title="Kayıt bulunmuyor"
                    description={'Bu sunucuda henüz kayıt bulunmuyor.'}
                  />
                ) : null}

                {activeLogState === 'ready' ? (
                  <div className="space-y-3">
                    {activeLogItems.map((item, index) => (
                      <div
                        key={`${String(item?.id || 'log')}-${index}`}
                        className="geass-subpanel rounded-xl border px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-[#eef3ff]">
                            {toLogHeadline(item)}
                          </div>
                          <div className="text-[11px] text-[#a5b2d5]">
                            {formatLogDate(item?.createdAt)}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-[#bec9e8]">{toLogSubtext(item)}</div>
                        <div className="mt-2 text-[11px] text-[#8d9ac0]">
                          Kayıt ID: {String(item?.id || '-')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Log Durumu">
              <div className="space-y-2 text-xs text-[#c1cae8]">
                <div>Aktif kategori: {activeLogTab}</div>
                <div>Durum: {activeLogState}</div>
                <div>Kayıt sayısı: {activeLogItems.length}</div>
              </div>
              <div className="mt-4">
                <button
                  onClick={refreshProtectedData}
                  className="geass-btn geass-btn-secondary"
                >
                  Yenile
                </button>
              </div>
            </Card>
            <DeveloperNote>
              Geliştirici: GET /api/dashboard/protected/logs/moderation
            </DeveloperNote>
            <DeveloperNote>
              Geliştirici: GET /api/dashboard/protected/logs/commands
            </DeveloperNote>
            <DeveloperNote>
              Geliştirici: GET /api/dashboard/protected/logs/system
            </DeveloperNote>
          </div>
        </div>
      );
    }
    if (activeSection === 'setup-readiness') {
      if (setupReadinessState === 'loading') {
        return (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Kurulum Durumu">
              <EmptyState
                title="Kurulum denetimi yükleniyor"
                description="Sunucu kurulum kontrolleri güvenli modda getiriliyor."
              />
            </Card>
            <Card title="Bilgi">
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                Bu ekran şimdilik sadece kurulum durumunu gösterir. Ayarları değiştirme özelliği sonraki aşamada eklenecek.
              </div>
            </Card>
          </div>
        );
      }
      if (setupReadinessState === 'error') {
        return (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Kurulum Durumu">
              <EmptyState
                title="Kurulum denetimi okunamadı"
                description={setupReadinessLoadError?.message || 'Kurulum verisi geçici olarak okunamadı.'}
              />
            </Card>
            <Card title="Bilgi">
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                Bu ekran şimdilik sadece kurulum durumunu gösterir. Ayarları değiştirme özelliği sonraki aşamada eklenecek.
              </div>
              <div className="mt-3">
                <button onClick={refreshProtectedData} className="geass-btn geass-btn-secondary">Yenile</button>
              </div>
            </Card>
          </div>
        );
      }

      return (
        <div className="space-y-5">
          <Card title="Kurulum Durumu" subtitle="Salt-okunur kurulum özeti">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-2xl font-black tracking-tight text-[#eef3ff]">{setupReadinessStatusLabel}</div>
              <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] ${setupReadinessBadgeMeta.className}`}>
                {setupReadinessBadgeMeta.label}
              </span>
            </div>
            <div className="geass-subpanel mt-4 rounded-2xl border p-4">
              <div className="flex items-center justify-between text-xs text-[#bec8e7]">
                <span>Skor</span>
                <span className="font-semibold text-[#edf2ff]">{Math.round(setupReadinessScore)}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-cyan-400/80 transition-all"
                  style={{ width: `${setupReadinessScore}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-[#bec8e7] md:grid-cols-4">
                <div>Kontrol: {setupReadinessSummary.totalChecks}</div>
                <div>Hazır: {setupReadinessSummary.passedChecks}</div>
                <div>Uyarı: {setupReadinessSummary.warningChecks}</div>
                <div>Eksik: {setupReadinessSummary.failedChecks}</div>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
              Bu ekran şimdilik sadece kurulum durumunu gösterir. Ayarları değiştirme özelliği sonraki aşamada eklenecek.
            </div>
          </Card>

          <Card title="Kurulum Kartları" subtitle="Alan bazlı denetim sonucu">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {setupReadinessSections.map((section) => {
                const sectionBadge = toSetupReadinessBadge(section?.status);
                const checkCount = Array.isArray(section?.checks) ? section.checks.length : 0;
                return (
                  <div key={section?.id || section?.title} className="geass-subpanel rounded-xl border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#edf2ff]">{section?.title || section?.id}</div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${sectionBadge.className}`}>
                        {getSetupReadinessStatusLabel(section?.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-[#a8b4d7]">Kontrol sayısı: {checkCount}</div>
                    {checkCount > 0 ? (
                      <div className="mt-3 space-y-1">
                        {section.checks.slice(0, 3).map((check) => (
                          <div key={check?.id || check?.title} className="text-xs text-[#c2ccea]">
                            {check?.title || 'Kontrol'}: {getSetupReadinessStatusLabel(check?.status)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-[#a8b4d7]">Kontrol detayı bulunamadı.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Sorun Listesi" subtitle="Tespit edilen eksik veya uyarı kalemleri">
            {setupReadinessIssues.length === 0 ? (
              <EmptyState
                title="Sorun bulunamadı"
                description="Kurulum kontrollerinde kritik bir eksik görünmüyor."
              />
            ) : (
              <div className="space-y-3">
                {setupReadinessIssues.map((issue, index) => (
                  <div key={`${issue?.reasonCode || 'issue'}-${index}`} className={`rounded-xl border px-3 py-3 text-xs ${toSetupIssueTone(issue?.severity)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">{issue?.title || 'Kurulum uyarısı'}</div>
                      <div className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
                        {getSetupReadinessIssueCategory(issue)}
                      </div>
                    </div>
                    <div className="mt-2 text-[11px]">{issue?.description || 'Detay bulunamadı.'}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <DeveloperNote>Geliştirici: GET /api/dashboard/protected/setup-readiness</DeveloperNote>
        </div>
      );
    }
    if (activeSection === 'command-settings') {
      return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card title="Komut Ayarları" subtitle="Gerçek komut kontrol merkezi">
              <div className="space-y-5">
                <div className="geass-subpanel rounded-2xl border px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#edf2ff]">.durum komutu</div>
                      <div className="mt-1 text-xs text-[#aab7db]">
                        Sunucu durum komutunu aç/kapat ve görünüm modunu belirle.
                      </div>
                    </div>
                    <StatusBadge status={statusEnabled ? 'active' : 'off'} />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block text-xs font-semibold tracking-wide text-[#c4ceeb]">
                      Komut Durumu
                      <select
                        value={statusCommandEnabledDraft ? 'enabled' : 'disabled'}
                        onChange={(e) => setStatusCommandEnabledDraft(e.target.value === 'enabled')}
                        className="geass-select geass-input mt-2 w-full"
                      >
                        <option value="enabled">Açık</option>
                        <option value="disabled">Kapalı</option>
                      </select>
                    </label>
                    <label className="block text-xs font-semibold tracking-wide text-[#c4ceeb]">
                      Detay Modu
                      <select
                        value={statusCommandDetailModeDraft}
                        onChange={(e) =>
                          setStatusCommandDetailModeDraft(
                            e.target.value === 'compact' ? 'compact' : 'legacy'
                          )
                        }
                        className="geass-select geass-input mt-2 w-full"
                      >
                        <option value="legacy">Klasik</option>
                        <option value="compact">Kompakt</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 space-y-1 text-xs text-[#c2ccea]">
                    <div>Etkin mod: {statusModeLabel}</div>
                    <div>Komut durumu: {statusEnabled ? 'Açık' : 'Kapalı'}</div>
                    <div>Güncellenme zamanı: {statusCommandSettings?.updatedAt || '-'}</div>
                  </div>
                </div>
                <div className="geass-subpanel rounded-xl border px-3 py-2 text-xs text-[#97a6cc]">
                  Yakında: diğer komutlar için ayarlar bu alana eklenecek.
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button onClick={saveStatusCommandSettings} disabled={!canSaveSettings || statusCommandSaveState === 'saving'} className="geass-btn geass-btn-primary disabled:opacity-60">{statusCommandSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}</button>
                  <button onClick={refreshProtectedData} className="geass-btn geass-btn-secondary">Yenile</button>
                </div>
              </div>
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Kaydetme Durumu">
              <SaveFeedback saveState={statusCommandSaveState} message={statusCommandSaveMessage} idleText="Durum komutu ayarları buradan kaydedilir." />
            </Card>
            <DeveloperNote>Geliştirici: GET/PUT /api/dashboard/protected/bot-settings/commands</DeveloperNote>
          </div>
        </div>
      );
    }
    if (activeSection === 'premium') {
      return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="Paketler" subtitle="Mevcut plan görünümü">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className={`rounded-xl border p-4 ${isProPlan ? 'geass-subpanel border-white/10 bg-white/5' : 'border-amber-400/25 bg-amber-500/10'}`}>
                <div className="text-sm font-semibold text-[#eef3ff]">Ücretsiz Paket</div>
                <div className="mt-2 text-xs text-[#bfcae8]">Temel panel özellikleri ve standart yönetim akışı.</div>
                <div className="mt-3"><StatusBadge status={isProPlan ? 'off' : 'active'} /></div>
              </div>
              <div className={`rounded-xl border p-4 ${isProPlan ? 'border-cyan-400/25 bg-cyan-500/10' : 'geass-subpanel border-white/10 bg-white/5'}`}>
                <div className="text-sm font-semibold text-[#eef3ff]">Pro Paket</div>
                <div className="mt-2 text-xs text-[#bfcae8]">Gelişmiş otomasyon, premium görünüm ve kilitli özellikler.</div>
                <div className="mt-3"><StatusBadge status={isProPlan ? 'active' : 'pro'} /></div>
              </div>
            </div>
            <div className="mt-4 text-xs text-[#c2cceb]">Aktif plan: <span className="font-semibold text-[#eef3ff]">{planLabel}</span></div>
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
                <label className="block text-xs font-semibold tracking-wide text-[#c2ccea]">
                  Varsayılan Sekme
                  <select value={preferencesDraft.defaultView} onChange={(e) => setPreferencesDraft((p) => ({ ...p, defaultView: e.target.value }))} className="geass-select geass-input mt-2 w-full">
                    {DEFAULT_VIEW_OPTIONS.map((entry) => <option key={entry} value={entry}>{formatDefaultViewLabel(entry)}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-3 text-xs font-semibold tracking-wide text-[#c2ccea]">
                  <input type="checkbox" checked={Boolean(preferencesDraft.compactMode)} onChange={(e) => setPreferencesDraft((p) => ({ ...p, compactMode: e.target.checked }))} />
                  Kompakt Mod
                </label>
                <label className="block text-xs font-semibold tracking-wide text-[#c2ccea]">
                  Kapatılan Bildirim Kimlikleri (virgülle ayırın)
                  <input value={dismissedNoticeIdsInput} onChange={(e) => setDismissedNoticeIdsInput(e.target.value)} className="geass-input mt-2 w-full" placeholder="notice-a, notice-b" />
                </label>
                <label className="block text-xs font-semibold tracking-wide text-[#c2ccea]">
                  Gelişmiş Yerleşim Modu
                  <select value={preferencesDraft.advancedLayoutMode || ''} onChange={(e) => setPreferencesDraft((p) => ({ ...p, advancedLayoutMode: e.target.value || null }))} disabled={!advancedPreferencesCapability.available} className="geass-select geass-input mt-2 w-full disabled:opacity-60">
                    <option value="">Kapalı</option>
                    <option value="focus">Odak</option>
                    <option value="split">Bölünmüş</option>
                  </select>
                </label>
                {!advancedPreferencesCapability.available ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Bu özellik Pro pakette kullanılabilir.</div> : null}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button onClick={savePreferences} disabled={!canSaveSettings || preferencesSaveState === 'saving'} className="geass-btn geass-btn-primary disabled:opacity-60">{preferencesSaveState === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}</button>
                  <button onClick={refreshProtectedData} className="geass-btn geass-btn-secondary">Yenile</button>
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
    <div className="geass-dashboard-shell min-h-screen text-[#e6edff]">
      <div className="geass-dashboard-backdrop" aria-hidden />
      {isReadyView ? (
        <Sidebar
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          planLabel={planLabel}
        />
      ) : null}

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
        userAvatarUrl={authenticatedUserSummary?.avatarUrl || null}
        planLabel={planLabel}
        withSidebar={isReadyView}
      />

      <div className={`relative z-10 px-4 pb-16 pt-[142px] sm:px-6 lg:px-8 ${isReadyView ? 'lg:pl-[304px]' : ''}`}>
        <div className="mx-auto max-w-[1380px]">
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
              <section className="space-y-5">
                <div className="geass-glass-panel geass-glow-border rounded-[1.7rem] border px-6 py-5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#93a6d7]">
                    Premium Dashboard Shell
                  </div>
                  <div className="mt-2 text-3xl font-black tracking-tight text-[#edf2ff]">
                    {activeSectionMeta.label}
                  </div>
                  <div className="mt-2 max-w-3xl text-sm text-[#b5c2e4]">
                    {activeSectionMeta.subtitle}. Sunucunu tek panelden yönet: moderasyon, komutlar, premium özellikler ve gelecekteki kontroller tek noktada.
                  </div>
                </div>

                <div className="geass-mobile-tabs geass-glass-panel rounded-2xl border p-3 lg:hidden">
                  <div className="flex flex-wrap gap-2">
                    {DASHBOARD_SECTIONS.map((section) => {
                      const active = section.id === activeSection;
                      return (
                        <button
                          key={`mobile-${section.id}`}
                          onClick={() => setActiveSection(section.id)}
                          className={`geass-chip ${active ? 'geass-chip-primary' : 'geass-chip-muted'}`}
                        >
                          {section.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <main className="space-y-5">{renderReady()}</main>
              </section>
            ) : null}
          </div>
        </div>
      </div>
      <DashboardToast toast={toast} />
    </div>
  );
}
