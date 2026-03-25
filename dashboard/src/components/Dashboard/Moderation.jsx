import { Bot, Hash, Shield, ShieldAlert, Tag } from 'lucide-react';

import { MODERATION_COMMANDS } from './moderation/constants';
import { normalizeIdList } from './moderation/helpers';

const PRESENCE_TYPE_LABELS = {
  CUSTOM: 'Ozel Durum',
  PLAYING: 'Oynuyor',
  LISTENING: 'Dinliyor',
  WATCHING: 'Izliyor',
  COMPETING: 'Yarisiyor',
};

function SourceBadge({ meta, scopeLabel = null }) {
  const source = String(meta?.source || 'config').toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] text-cyan-100">
      <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1">
        Read Only
      </span>
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300">
        Source: {source}
      </span>
      {scopeLabel ? (
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300">
          Scope: {scopeLabel}
        </span>
      ) : null}
    </div>
  );
}

function StatusBadge({ enabled }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] ${
        enabled
          ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
          : 'border-rose-400/20 bg-rose-500/10 text-rose-100'
      }`}
    >
      {enabled ? 'Aktif' : 'Kapali'}
    </span>
  );
}

function SnapshotRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/6 bg-[#0d0d17] px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">{label}</div>
      <div className="mt-2 text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function IdChipList({ ids, resolveLabel, emptyLabel = 'Kayit yok' }) {
  if (!ids.length) {
    return (
      <div className="rounded-2xl border border-white/6 bg-[#0d0d17] px-4 py-4 text-xs text-gray-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id, index) => (
        <div
          key={`${id}-${index}`}
          className="rounded-xl border border-white/8 bg-[#0d0d17] px-3 py-2 text-[11px] font-bold text-white"
        >
          {resolveLabel(id, index)}
        </div>
      ))}
    </div>
  );
}

function formatRoleLabel(roleId, roleNameMap) {
  const normalizedRoleId = String(roleId || '').trim();
  if (!normalizedRoleId) return 'Atanmamis';

  const roleName = roleNameMap.get(normalizedRoleId);
  return roleName ? roleName : `${normalizedRoleId} (sunucuda yok)`;
}

function formatSafeListValue(ids) {
  if (!ids.length) return 'Bos';
  return `${ids.length} uye`;
}

function formatLimitValue(limit) {
  const normalized = Number(limit || 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return 'Kapali';
  return `${normalized} / saat`;
}

export default function Moderation({
  roles,
  modSettings,
  settingsMeta,
  botPresenceSettings,
  botPresenceMeta,
  botPresenceLoadState,
}) {
  const roleNameMap = new Map(
    (Array.isArray(roles) ? roles : [])
      .filter((role) => String(role?.id || '').trim() !== '0')
      .map((role) => [String(role.id), role.name])
  );
  const staticCommands = MODERATION_COMMANDS.filter((command) => !command.messageOnly);
  const hierarchyRoleIds = normalizeIdList(modSettings.staff_hierarchy_roles);
  const hardProtectedRoleIds = normalizeIdList(modSettings.hard_protected_roles);
  const hardProtectedUserIds = normalizeIdList(modSettings.hard_protected_users);
  const tagEnabled = Boolean(modSettings.tag_enabled);
  const botPresenceEnabled = Boolean(botPresenceSettings?.enabled);
  const presenceType = String(botPresenceSettings?.type || 'CUSTOM');
  const presenceText = String(botPresenceSettings?.text || '').trim();
  const presenceStatusText =
    botPresenceLoadState?.status === 'loading'
      ? 'Global bot presence yukleniyor.'
      : botPresenceLoadState?.status === 'error'
        ? botPresenceLoadState?.error || 'Global bot presence okunamadi.'
        : 'Global bot presence config snapshot olarak gosteriliyor.';

  return (
    <div className="space-y-8 pb-20">
      <div className="rounded-[2.5rem] border border-cyan-400/10 bg-[#16162a]/80 p-10 shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-[780px] space-y-3">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300">
                <Shield size={20} />
              </div>
              <div className="font-black italic text-2xl uppercase tracking-tight text-white">
                Policy Snapshot
              </div>
            </div>
            <div className="text-sm leading-relaxed text-gray-300">
              Dashboard artik static moderation, hierarchy, safe list, prefix, tag ve bot presence
              ayarlarinin write authority katmani degil. Bu sekme yalnizca config-authoritative
              policy snapshot gosterir.
            </div>
          </div>

          <SourceBadge meta={settingsMeta} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-white/6 bg-[#16162a]/80 p-8 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-white/5 p-3 text-purple-200">
              <Hash size={18} />
            </div>
            <div>
              <div className="font-black italic text-xl uppercase tracking-tight text-white">Prefix</div>
              <div className="mt-1 text-xs text-gray-400">
                Bot komut on eki config dosyasindan okunur.
              </div>
            </div>
          </div>
          <div className="mt-6 rounded-[2rem] border border-white/6 bg-[#0d0d17] px-6 py-5 text-3xl font-black text-white">
            {String(modSettings.prefix || '.')}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/6 bg-[#16162a]/80 p-8 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-white/5 p-3 text-amber-200">
                <Tag size={18} />
              </div>
              <div>
                <div className="font-black italic text-xl uppercase tracking-tight text-white">
                  Tag Auto Rol
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  Static feature toggle ve bagli rol buradan degistirilemez.
                </div>
              </div>
            </div>

            <StatusBadge enabled={tagEnabled} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <SnapshotRow label="Rol" value={formatRoleLabel(modSettings.tag_role, roleNameMap)} />
            <SnapshotRow label="Tag Metni" value={String(modSettings.tag_text || 'Atanmamis')} />
          </div>
        </div>
      </div>

      <div className="rounded-[2.5rem] border border-white/6 bg-[#16162a]/80 p-10 shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-white/5 p-3 text-cyan-200">
                <Bot size={18} />
              </div>
              <div className="font-black italic text-xl uppercase tracking-tight text-white">
                Global Bot Presence
              </div>
            </div>
            <div className="text-xs text-gray-400">{presenceStatusText}</div>
          </div>

          <SourceBadge meta={botPresenceMeta} scopeLabel={botPresenceMeta?.scope || 'global'} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SnapshotRow label="Durum" value={botPresenceEnabled ? 'Aktif' : 'Kapali'} />
          <SnapshotRow
            label="Tur"
            value={PRESENCE_TYPE_LABELS[presenceType] || presenceType || 'Atanmamis'}
          />
          <SnapshotRow label="Metin" value={presenceText || 'Bos'} />
        </div>
      </div>

      <div className="rounded-[2.5rem] border border-white/6 bg-[#16162a]/80 p-10 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-white/5 p-3 text-cyan-200">
            <ShieldAlert size={18} />
          </div>
          <div>
            <div className="font-black italic text-xl uppercase tracking-tight text-white">
              Static Moderation Policies
            </div>
            <div className="mt-1 text-xs text-gray-400">
              Moderation rol, penalty rol, safe list, static toggle ve limit ayarlari config
              snapshot olarak gosterilir.
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          {staticCommands.map((command) => {
            const Icon = command.Icon;
            const enabled = Boolean(modSettings[`${command.id}_enabled`]);
            const safeIds = normalizeIdList(modSettings[`${command.id}_safe_list`]);

            return (
              <div
                key={command.id}
                className="rounded-[2rem] border border-white/6 bg-[#0d0d17] p-6"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl bg-white/5 p-3">
                      <Icon size={18} className={command.iconClass} />
                    </div>
                    <div>
                      <div className="font-black italic text-lg uppercase tracking-tight text-white">
                        {command.name}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-gray-500">
                        Config-backed policy
                      </div>
                    </div>
                  </div>

                  <StatusBadge enabled={enabled} />
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SnapshotRow
                    label="Yetkili Rol"
                    value={formatRoleLabel(modSettings[`${command.id}_role`], roleNameMap)}
                  />
                  <SnapshotRow
                    label="Safe List"
                    value={formatSafeListValue(safeIds)}
                  />
                  <SnapshotRow
                    label="Saatlik Limit"
                    value={formatLimitValue(modSettings[`${command.id}_limit`])}
                  />
                  {command.penalty ? (
                    <SnapshotRow
                      label="Penalty Rol"
                      value={formatRoleLabel(modSettings[`${command.id}_penalty_role`], roleNameMap)}
                    />
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">
                    Safe List Detayi
                  </div>
                  <IdChipList
                    ids={safeIds}
                    emptyLabel="Safe list bos."
                    resolveLabel={(id) => id}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-[2.5rem] border border-white/6 bg-[#16162a]/80 p-10 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-white/5 p-3 text-cyan-200">
            <Shield size={18} />
          </div>
          <div>
            <div className="font-black italic text-xl uppercase tracking-tight text-white">
              Hierarchy ve Hard Protected
            </div>
            <div className="mt-1 text-xs text-gray-400">
              Staff hierarchy, hard protected role listesi ve kullanici listesi dashboard uzerinden
              degistirilemez.
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-3">
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">
              Staff Hierarchy
            </div>
            <IdChipList
              ids={hierarchyRoleIds}
              emptyLabel="Hierarchy tanimsiz."
              resolveLabel={(id, index) => `#${index + 1} ${formatRoleLabel(id, roleNameMap)}`}
            />
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">
              Hard Protected Roller
            </div>
            <IdChipList
              ids={hardProtectedRoleIds}
              emptyLabel="Hard protected rol yok."
              resolveLabel={(id) => formatRoleLabel(id, roleNameMap)}
            />
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">
              Hard Protected Kullanici ID
            </div>
            <IdChipList
              ids={hardProtectedUserIds}
              emptyLabel="Hard protected kullanici yok."
              resolveLabel={(id) => id}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
