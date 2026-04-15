function HealthBadge({ label, ok }) {
  return (
    <span
      className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
        ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
      }`}
    >
      {label}: {ok ? 'OK' : 'HATA'}
    </span>
  );
}

export default function SystemHealthCard({ overview, viewState }) {
  const runtime = overview?.runtime && typeof overview.runtime === 'object' ? overview.runtime : null;
  const capabilities =
    overview?.capabilities && typeof overview.capabilities === 'object'
      ? overview.capabilities
      : null;

  const gatewayReady = Boolean(runtime?.discordGatewayReady);
  const authEnabled = Boolean(runtime?.controlPlaneAuthEnabled);
  const authConfigured = Boolean(runtime?.controlPlaneAuthConfigured);
  const mutableRoutesEnabled = Boolean(capabilities?.mutableRoutesEnabled);
  const startupPhase = String(runtime?.startupPhase || 'unknown_phase');

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
        Control Plane
      </span>
      <span className="rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-white/10 text-white/90">
        Startup: {startupPhase}
      </span>
      <HealthBadge label="Gateway" ok={gatewayReady} />
      <HealthBadge label="Auth" ok={authEnabled && authConfigured} />
      <HealthBadge label="Mutable Routes" ok={mutableRoutesEnabled} />
      {runtime ? null : (
        <span className="rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-white/10 text-gray-300">
          Durum: {viewState === 'loading' ? 'Yukleniyor' : 'Veri yok'}
        </span>
      )}
    </div>
  );
}
