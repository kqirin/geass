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
    <div className="rounded-[2.5rem] border border-white/10 bg-[#16162a]/80 p-10 shadow-2xl">
      <div className="font-black italic text-2xl uppercase tracking-tight text-white">{title}</div>
      <div className="mt-3 text-sm text-gray-300">{description}</div>
      {detail ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-xs text-gray-300">
          {detail}
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="px-5 py-3 rounded-2xl bg-purple-600/30 border border-purple-500/30 hover:bg-purple-600/40 transition-all text-xs font-black uppercase tracking-widest"
          >
            {actionLabel}
          </button>
        ) : null}
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            onClick={onSecondaryAction}
            className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-xs font-black uppercase tracking-widest"
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
    authStatus?.auth?.reasonCode || authError?.reasonCode || protectedError?.reasonCode || 'auth_not_configured';
  const noAccessDetail =
    protectedError?.reasonCode || authError?.reasonCode || 'guild_scope_unresolved';
  const advancedCapabilityText = advancedPreferencesCapability.available
    ? 'Available'
    : `Unavailable${advancedPreferencesCapability.reasonCode ? ` (${advancedPreferencesCapability.reasonCode})` : ''}`;
  const statusCommandEffectiveMode = String(
    statusCommandSettings?.effective?.detailMode || 'legacy'
  ).toLowerCase();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0b14] via-[#0b0b14] to-[#07070f] text-white">
      <div className="max-w-[1200px] mx-auto px-6 pt-10 pb-20">
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

        <div className="mt-8 space-y-8">
          {viewState === DASHBOARD_VIEW_STATES.LOADING ? (
            <StateCard
              title="Loading"
              description="Control-plane auth ve dashboard context yukleniyor."
              actionLabel="YENILE"
              onAction={refreshAuth}
              detail={
                isAuthLoading
                  ? 'Auth status kontrolu devam ediyor.'
                  : isProtectedLoading
                    ? 'Korumali overview/preferences/settings verisi yukleniyor.'
                    : 'Bekleniyor...'
              }
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.UNAUTHENTICATED ? (
            <StateCard
              title="Unauthenticated"
              description="Dashboard protected endpointleri icin oturum bulunamadi."
              actionLabel="DISCORD LOGIN"
              onAction={login}
              secondaryActionLabel="YENILE"
              onSecondaryAction={refreshAuth}
              detail="Bu ekrandan login route tetiklenir: GET /api/auth/login"
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.AUTH_UNAVAILABLE ? (
            <StateCard
              title="Auth Unavailable"
              description="Control-plane auth local/dev ortaminda su an hazir degil."
              actionLabel="YENILE"
              onAction={refreshAuth}
              detail={`Reason: ${authUnavailableDetail}`}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.NO_ACCESS ? (
            <StateCard
              title="No Guild Access"
              description="Oturum acik ama hedef guild icin protected dashboard yetkisi yok."
              actionLabel="YENILE"
              onAction={refreshProtectedData}
              secondaryActionLabel="AUTH YENILE"
              onSecondaryAction={refreshAuth}
              detail={`Reason: ${noAccessDetail}`}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.ERROR ? (
            <StateCard
              title="Dashboard Error"
              description="Beklenmeyen bir hata olustu. Veriler guvenli sekilde fail-closed durumda."
              actionLabel="AUTH YENILE"
              onAction={refreshAuth}
              secondaryActionLabel="VERI YENILE"
              onSecondaryAction={refreshProtectedData}
              detail={authError?.message || protectedError?.message || 'unknown_error'}
            />
          ) : null}

          {viewState === DASHBOARD_VIEW_STATES.READY ? (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-[2rem] border border-white/10 bg-[#16162a]/80 p-6 shadow-2xl">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                    Authenticated User
                  </div>
                  <div className="mt-3 font-black text-xl text-white">
                    {authenticatedUserSummary?.displayName || '-'}
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    @{authenticatedUserSummary?.username || 'unknown'}
                  </div>
                  <div className="mt-2 text-xs text-gray-400">ID: {authenticatedUserSummary?.id || '-'}</div>
                  <div className="mt-3 text-xs text-gray-300">
                    Guilds: {authenticatedUserSummary?.guildCount || 0} | Operator:{' '}
                    {authenticatedUserSummary?.operatorGuildCount || 0}
                  </div>
                  <div className="mt-3 text-xs text-gray-300">
                    Session: {session?.id ? 'Active' : 'Unknown'}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/10 bg-[#16162a]/80 p-6 shadow-2xl">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                    Plan
                  </div>
                  <div className="mt-3 font-black text-xl uppercase text-white">
                    {effectivePlan?.tier || 'unresolved'}
                  </div>
                  <div className="mt-2 text-xs text-gray-300">
                    Status: {effectivePlan?.status || 'unresolved'}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Source: {effectivePlan?.source || 'unresolved'}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Reason: {effectivePlan?.reasonCode || '-'}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/10 bg-[#16162a]/80 p-6 shadow-2xl">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                    Capability Summary
                  </div>
                  <div className="mt-3 text-xs text-gray-300">
                    Allowed: {capabilitySummary.allowedCapabilities} / {capabilitySummary.totalCapabilities}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Denied: {capabilitySummary.deniedCapabilities}
                  </div>
                  <div className="mt-1 text-xs text-gray-300">
                    Active: {capabilitySummary.activeCapabilities}
                  </div>
                  <div className="mt-3 text-xs text-gray-200">
                    Advanced Preferences: {advancedCapabilityText}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    Required Plan: {advancedPreferencesCapability.requiredPlan}
                  </div>
                  <div className="mt-3 text-[11px] text-gray-400 break-all">
                    Context keys: {Object.keys(capabilities || {}).join(', ') || 'none'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-[2rem] border border-white/10 bg-[#16162a]/80 p-6 shadow-2xl">
                  <div className="font-black italic text-lg uppercase tracking-tight text-white">
                    Dashboard Preferences
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    GET/PUT /api/dashboard/protected/preferences
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="block text-xs font-black uppercase tracking-wider text-gray-300">
                      Default View
                      <select
                        value={preferencesDraft.defaultView}
                        onChange={(event) =>
                          setPreferencesDraft((previous) => ({
                            ...previous,
                            defaultView: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-xs outline-none"
                      >
                        {DEFAULT_VIEW_OPTIONS.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-3 text-xs font-black uppercase tracking-wider text-gray-300">
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
                      Compact Mode
                    </label>

                    <label className="block text-xs font-black uppercase tracking-wider text-gray-300">
                      Dismissed Notices (comma separated)
                      <input
                        value={dismissedNoticeIdsInput}
                        onChange={(event) => setDismissedNoticeIdsInput(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-xs outline-none"
                        placeholder="notice-a, notice-b"
                      />
                    </label>

                    <label className="block text-xs font-black uppercase tracking-wider text-gray-300">
                      Advanced Layout Mode
                      <select
                        value={preferencesDraft.advancedLayoutMode || ''}
                        onChange={(event) =>
                          setPreferencesDraft((previous) => ({
                            ...previous,
                            advancedLayoutMode: event.target.value || null,
                          }))
                        }
                        disabled={!advancedPreferencesCapability.available}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-xs outline-none disabled:opacity-60"
                      >
                        <option value="">none</option>
                        <option value="focus">focus</option>
                        <option value="split">split</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-5 flex items-center gap-3">
                    <button
                      onClick={savePreferences}
                      disabled={preferencesSaveState === 'saving'}
                      className="px-5 py-3 rounded-2xl bg-purple-600/30 border border-purple-500/30 hover:bg-purple-600/40 transition-all text-xs font-black uppercase tracking-widest disabled:opacity-60"
                    >
                      {preferencesSaveState === 'saving' ? 'KAYDEDILIYOR' : 'PREFERENCES SAVE'}
                    </button>
                    <div className="text-xs text-gray-300">
                      {preferencesSaveMessage || ' '}
                    </div>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/10 bg-[#16162a]/80 p-6 shadow-2xl">
                  <div className="font-black italic text-lg uppercase tracking-tight text-white">
                    Status Command Setting
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    GET/PUT /api/dashboard/protected/bot-settings/status-command
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="block text-xs font-black uppercase tracking-wider text-gray-300">
                      Detail Mode
                      <select
                        value={statusCommandDetailModeDraft}
                        onChange={(event) =>
                          setStatusCommandDetailModeDraft(event.target.value === 'compact' ? 'compact' : 'legacy')
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d0d17] px-4 py-3 text-xs outline-none"
                      >
                        <option value="legacy">legacy</option>
                        <option value="compact">compact</option>
                      </select>
                    </label>
                    <div className="text-xs text-gray-300">
                      Effective: {statusCommandEffectiveMode}
                    </div>
                    <div className="text-xs text-gray-400">
                      Updated At: {statusCommandSettings?.updatedAt || '-'}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center gap-3">
                    <button
                      onClick={saveStatusCommandSettings}
                      disabled={statusCommandSaveState === 'saving'}
                      className="px-5 py-3 rounded-2xl bg-purple-600/30 border border-purple-500/30 hover:bg-purple-600/40 transition-all text-xs font-black uppercase tracking-widest disabled:opacity-60"
                    >
                      {statusCommandSaveState === 'saving'
                        ? 'KAYDEDILIYOR'
                        : 'STATUS COMMAND SAVE'}
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
