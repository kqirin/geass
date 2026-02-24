export default function VCToast({ toast }) {
  if (!toast) return null;

  return (
    <div
      className={`mt-6 px-6 py-4 rounded-2xl border text-xs font-black uppercase tracking-widest ${
        toast.type === 'ok'
          ? 'bg-green-500/10 border-green-500/20 text-green-300'
          : 'bg-red-500/10 border-red-500/20 text-red-300'
      }`}
    >
      {toast.text}
    </div>
  );
}

