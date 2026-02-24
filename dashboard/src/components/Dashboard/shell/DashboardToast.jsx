export default function DashboardToast({ toast }) {
  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <div
        className={`min-w-[240px] max-w-[420px] px-5 py-4 rounded-2xl border backdrop-blur-md shadow-2xl text-xs font-black uppercase tracking-widest transition-all ${
          toast.type === 'ok'
            ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
            : 'bg-rose-500/10 border-rose-400/30 text-rose-200'
        }`}
      >
        {toast.text}
      </div>
    </div>
  );
}

