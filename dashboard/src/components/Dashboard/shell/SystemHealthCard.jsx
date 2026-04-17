function HealthBadge({ label, status = 'ok' }) {
  const styleByStatus = {
    ok: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100',
    warn: 'border-amber-400/35 bg-amber-500/15 text-amber-100',
    err: 'border-rose-400/35 bg-rose-500/15 text-rose-100',
  };
  const dotByStatus = {
    ok: 'bg-emerald-300',
    warn: 'bg-amber-300',
    err: 'bg-rose-300',
  };
  const textByStatus = {
    ok: 'OK',
    warn: 'Bekliyor',
    err: 'Hata',
  };

  const resolvedStatus = statusByName(status);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${styleByStatus[resolvedStatus]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotByStatus[resolvedStatus]}`} />
      {label}: {textByStatus[resolvedStatus]}
    </span>
  );
}

function statusByName(rawStatus = '') {
  if (rawStatus === 'warn') return 'warn';
  if (rawStatus === 'err') return 'err';
  return 'ok';
}

function resolveSettingsSaveStatus({
  preferencesSaveState = 'idle',
  statusCommandSaveState = 'idle',
} = {}) {
  if (preferencesSaveState === 'error' || statusCommandSaveState === 'error') return 'err';
  if (preferencesSaveState === 'saving' || statusCommandSaveState === 'saving') return 'warn';
  return 'ok';
}

export default function SystemHealthCard({
  overview,
  viewState,
  preferencesSaveState = 'idle',
  statusCommandSaveState = 'idle',
}) {
  const runtime =
    overview?.runtime && typeof overview.runtime === 'object' ? overview.runtime : null;
  const capabilities =
    overview?.capabilities && typeof overview.capabilities === 'object'
      ? overview.capabilities
      : null;

  const gatewayReady = Boolean(runtime?.discordGatewayReady);
  const authEnabled = Boolean(runtime?.controlPlaneAuthEnabled);
  const authConfigured = Boolean(runtime?.controlPlaneAuthConfigured);
  const mutableRoutesEnabled = Boolean(capabilities?.mutableRoutesEnabled);
  const startupPhase = String(runtime?.startupPhase || 'unknown_phase');
  const settingsSaveStatus = resolveSettingsSaveStatus({
    preferencesSaveState,
    statusCommandSaveState,
  });

  return (
    <section className="geass-glass-panel geass-health-shell mt-6 rounded-[1.5rem] border px-4 py-4 shadow-2xl sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9cadcf]">
          Sistem Sağlığı
        </span>
        <span className="geass-chip geass-chip-muted">Başlangıç: {startupPhase}</span>
        <HealthBadge label="Gateway" status={gatewayReady ? 'ok' : 'err'} />
        <HealthBadge
          label="Yetkilendirme"
          status={authEnabled && authConfigured ? 'ok' : 'err'}
        />
        <HealthBadge
          label="Ayar Kaydetme"
          status={mutableRoutesEnabled ? settingsSaveStatus : 'err'}
        />
        {runtime ? null : (
          <span className="geass-chip geass-chip-muted">
            Durum: {viewState === 'loading' ? 'Yükleniyor' : 'Veri yok'}
          </span>
        )}
      </div>
    </section>
  );
}
