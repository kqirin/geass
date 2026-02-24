import { useMemo } from 'react';
import VCHeader from './vc/VCHeader';
import VCChannelControls from './vc/VCChannelControls';
import VCStatusCard from './vc/VCStatusCard';
import VCToast from './vc/VCToast';
import { useVcController } from './vc/useVcController';

export default function VC({ guildId, roles = [] }) {
  const {
    groups,
    selectedChannelId,
    setSelectedChannelId,
    status,
    privateConfig,
    setPrivateConfig,
    busy,
    savingConfig,
    toast,
    selectedName,
    load,
    connect,
    disconnect,
    savePrivateConfig,
  } = useVcController(guildId);

  const selectableRoles = useMemo(() => (roles || []).filter((r) => r.id !== '0'), [roles]);
  const voiceChannels = useMemo(() => {
    const list = [];
    for (const group of groups || []) {
      for (const channel of group.channels || []) list.push(channel);
    }
    return list;
  }, [groups]);
  const categoryOptions = useMemo(
    () =>
      (groups || [])
        .filter((g) => g.categoryId && g.categoryName)
        .map((g) => ({ id: g.categoryId, name: g.categoryName })),
    [groups]
  );

  return (
    <div className="space-y-10 pb-20">
      <VCHeader busy={busy} onRefresh={load} />

      <div className="bg-[#16162a]/80 p-10 rounded-[2.5rem] border border-white/5 shadow-2xl">
        <VCChannelControls
          groups={groups}
          selectedChannelId={selectedChannelId}
          setSelectedChannelId={setSelectedChannelId}
          busy={busy}
          onConnect={connect}
          onDisconnect={disconnect}
        />

        <VCStatusCard status={status} selectedName={selectedName} />
        <VCToast toast={toast} />
      </div>

      <div className="bg-[#16162a]/80 p-10 rounded-[2.5rem] border border-white/5 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-black italic uppercase tracking-tight text-white">
              Tikla Olustur Ozel Oda
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Hub kanala giren ve gerekli role sahip kullanicilar icin otomatik ozel oda acilir.
            </p>
          </div>
          <button
            onClick={() => setPrivateConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`w-14 h-7 rounded-full p-1 transition-all duration-300 ${
              privateConfig?.enabled ? 'bg-emerald-600 shadow-[0_0_15px_#10b981]' : 'bg-gray-800'
            }`}
          >
            <div
              className={`w-5 h-5 bg-white rounded-full transition-transform duration-300 ${
                privateConfig?.enabled ? 'translate-x-7' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="space-y-2">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">
              Hub Ses Kanali
            </span>
            <select
              value={privateConfig?.hubChannelId || ''}
              onChange={(e) =>
                setPrivateConfig((prev) => ({ ...prev, hubChannelId: e.target.value || null }))
              }
              className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-purple-500/40 text-white transition-all"
            >
              <option value="">Sec...</option>
              {voiceChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">
              Kalici Oda Izni Rolu
            </span>
            <select
              value={privateConfig?.requiredRoleId || ''}
              onChange={(e) =>
                setPrivateConfig((prev) => ({ ...prev, requiredRoleId: e.target.value || null }))
              }
              className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-purple-500/40 text-white transition-all"
            >
              <option value="">Sec...</option>
              {selectableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">
              Oda Kategorisi (Opsiyonel)
            </span>
            <select
              value={privateConfig?.categoryId || ''}
              onChange={(e) => setPrivateConfig((prev) => ({ ...prev, categoryId: e.target.value || null }))}
              className="w-full bg-[#0c0c16] border border-white/5 rounded-2xl p-4 text-xs font-bold outline-none focus:border-purple-500/40 text-white transition-all"
            >
              <option value="">Hub ile ayni kategori</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            Kilitli odalarda sadece owner + whitelist kalir. Yetkisiz uyeler (admin dahil) aninda sesten
            dusurulur.
          </p>
          <button
            onClick={savePrivateConfig}
            disabled={savingConfig}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest text-white disabled:opacity-50"
          >
            {savingConfig ? 'KAYDEDILIYOR...' : 'KAYDET'}
          </button>
        </div>
      </div>
    </div>
  );
}
