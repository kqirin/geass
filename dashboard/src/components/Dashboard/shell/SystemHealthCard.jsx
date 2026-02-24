export default function SystemHealthCard({ health }) {
  const dbOk = Boolean(health?.checks?.db);
  const discordOk = Boolean(health?.checks?.discord);
  const overall = Boolean(health?.ok);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Sistem Durumu</span>
      <span
        className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
          overall ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
        }`}
      >
        {overall ? 'Genel: Saglikli' : 'Genel: Sorunlu'}
      </span>
      <span
        className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
          dbOk ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
        }`}
      >
        DB: {dbOk ? 'OK' : 'HATA'}
      </span>
      <span
        className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
          discordOk ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
        }`}
      >
        Gateway: {discordOk ? 'OK' : 'HATA'}
      </span>
    </div>
  );
}
