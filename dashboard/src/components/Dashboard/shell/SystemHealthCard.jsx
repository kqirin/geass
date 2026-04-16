function HealthBadge({ label, ok }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
        ok
          ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
          : 'border-rose-400/35 bg-rose-500/15 text-rose-100'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-300' : 'bg-rose-300'}`} />
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
    <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[1.4rem] border border-white/10 bg-[#121221]/90 px-4 py-3 shadow-xl shadow-black/20">
      <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/65">
        Sistem Sağlığı
      </span>
      <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">
        STARTUP: {startupPhase}
      </span>
      <HealthBadge label="GATEWAY" ok={gatewayReady} />
      <HealthBadge label="AUTH" ok={authEnabled && authConfigured} />
      <HealthBadge label="MUTABLE ROUTES" ok={mutableRoutesEnabled} />
      {runtime ? null : (
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-300">
          DURUM: {viewState === 'loading' ? 'YUKLENIYOR' : 'VERI YOK'}
        </span>
      )}
    </div>
  );
}
