export default function DashboardToast({ toast }) {
  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <div
        className={`geass-glass-panel geass-glow-border max-w-[420px] min-w-[240px] rounded-2xl border px-5 py-4 text-sm font-semibold tracking-wide shadow-2xl backdrop-blur-xl transition-all ${
          toast.type === 'ok'
            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
            : 'border-rose-400/30 bg-rose-500/10 text-rose-100'
        }`}
      >
        {toast.text}
      </div>
    </div>
  );
}
