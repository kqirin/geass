const TEMPLATE_SCOPE_GLOBAL = 'global';
const TEMPLATE_SCOPE_COMMAND = 'command';

const TEMPLATE_MODES = new Set(['normal', 'embed']);

const MESSAGE_COMMANDS = [
  { name: 'warn', label: 'Warn' },
  { name: 'mute', label: 'Mute' },
  { name: 'unmute', label: 'Unmute' },
  { name: 'kick', label: 'Kick' },
  { name: 'jail', label: 'Jail' },
  { name: 'unjail', label: 'Unjail' },
  { name: 'ban', label: 'Ban' },
  { name: 'unban', label: 'Unban' },
  { name: 'vcmute', label: 'VC Mute' },
  { name: 'vcunmute', label: 'VC Unmute' },
];

const TEMPLATE_KEY_META = {
  success: { label: 'Başarılı', description: 'İşlem başarıyla tamamlandığında.' },
  permissionDenied: { label: 'Yetki Yok', description: 'Komut kullanma yetkisi olmadığında.' },
  roleInsufficient: { label: 'Yetersiz Rol', description: 'Kullanıcının rolü yetersiz olduğunda.' },
  roleNotConfigured: { label: 'Rol Ayarı Yok', description: 'Gerekli rol ayarı yapılmamış olduğunda.' },
  targetRoleHigher: { label: 'Hedef Rolü Yüksek', description: 'Hedefin rolü komutu kullanan kişiden yüksek olduğunda.' },
  limitReached: { label: 'Limit Doldu', description: 'Komut limiti dolduğunda.' },
  userNotFound: { label: 'Kullanıcı Bulunamadı', description: 'Hedef kullanıcı bulunamadığında.' },
  invalidUsage: { label: 'Hatalı Kullanım', description: 'Komut eksik veya hatalı kullanıldığında.' },
  systemError: { label: 'Sistem Hatası', description: 'Beklenmeyen hata oluştuğunda.' },
  abuseLock: { label: 'Yetki Askısı', description: 'Aşırı limit ihlalinde yetki kaldırıldığında.' },
  alreadyApplied: { label: 'Zaten Uygulandı', description: 'Aynı ceza/işlem zaten aktif olduğunda.' },
  notApplied: { label: 'Zaten Aktif Değil', description: 'Geri alınacak ceza/işlem zaten yoksa.' },
  notInVoice: { label: 'Seste Değil', description: 'Hedef ses kanalında değilse.' },
  operationNotAllowed: { label: 'İşlem Uygulanamadı', description: 'Discord hiyerarşi/izin nedeni ile işlem yapılamadığında.' },
  durationRequired: { label: 'Süre Zorunlu', description: 'Timeout tabanlı mute için süre girilmediğinde.' },
  invalidDuration: { label: 'Geçersiz Süre', description: 'Süre formatı geçersiz olduğunda.' },
  durationTooLong: { label: 'Süre Çok Uzun', description: 'Timeout süresi Discord sınırını aştığında.' },
  timeoutProtectedTarget: { label: 'Timeout Koruma', description: 'Owner veya administrator hedef timeout alamadığında.' },
  voiceDisconnectPermissionRequired: {
    label: 'MoveMembers Gerekli',
    description: 'Hedef seste iken botun MoveMembers izni olmadığında.',
  },
  voiceDisconnectFailed: {
    label: 'Ses Ayırma Başarısız',
    description: 'Timeout sonrası hedef sesten düşürülemediğinde.',
  },
};

const GENERIC_TEMPLATE_KEYS = [
  'success',
  'permissionDenied',
  'roleInsufficient',
  'roleNotConfigured',
  'targetRoleHigher',
  'operationNotAllowed',
  'limitReached',
  'userNotFound',
  'invalidUsage',
  'systemError',
  'abuseLock',
];

const COMMAND_EXTRA_TEMPLATE_KEYS = {
  warn: [],
  mute: [
    'alreadyApplied',
    'durationRequired',
    'invalidDuration',
    'durationTooLong',
    'timeoutProtectedTarget',
    'voiceDisconnectPermissionRequired',
    'voiceDisconnectFailed',
  ],
  unmute: ['notApplied'],
  kick: ['operationNotAllowed'],
  jail: ['alreadyApplied'],
  unjail: ['notApplied'],
  ban: ['alreadyApplied'],
  unban: ['notApplied'],
  vcmute: ['alreadyApplied', 'notInVoice'],
  vcunmute: ['notApplied', 'notInVoice'],
};

const BASE_TEMPLATE_DEFAULTS = {
  success: {
    mode: 'embed',
    content: 'İşlem tamamlandı. ⋆˚࿔',
    embedTitle: '',
    color: '#BD37FB',
    withIcon: true,
  },
  permissionDenied: {
    mode: 'embed',
    content: 'Bu komutu kullanmak için yetkiniz yok. ୭ ˚. !!',
    embedTitle: '',
    color: '#F97316',
    withIcon: true,
  },
  roleInsufficient: {
    mode: 'embed',
    content: 'Bu komut için rolünüz yeterli değil. ୭ ˚. !!',
    embedTitle: '',
    color: '#F97316',
    withIcon: true,
  },
  roleNotConfigured: {
    mode: 'embed',
    content: 'Bu komut için gerekli rol ayarı yapılmamış. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  targetRoleHigher: {
    mode: 'embed',
    content: 'Bu kullanıcının rolü sizden yüksek. ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
  limitReached: {
    mode: 'embed',
    content: 'Saatlik işlem sınırına ulaşıldı. Limit: {limit}. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  userNotFound: {
    mode: 'embed',
    content: 'Kullanıcı bulunamadı. ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
  invalidUsage: {
    mode: 'embed',
    content: 'Hatalı kullanım. Komutu doğru biçimde tekrar deneyin. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  systemError: {
    mode: 'embed',
    content: 'Beklenmeyen bir hata oluştu. ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
  abuseLock: {
    mode: 'embed',
    content: 'Aşırı limit ihlali nedeniyle yetkiniz geçici olarak kaldırıldı. ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
  alreadyApplied: {
    mode: 'embed',
    content: 'Bu işlem zaten aktif. ୭ ˚. !!',
    embedTitle: '',
    color: '#A855F7',
    withIcon: true,
  },
  notApplied: {
    mode: 'embed',
    content: 'Bu işlem zaten aktif değil. ୭ ˚. !!',
    embedTitle: '',
    color: '#A855F7',
    withIcon: true,
  },
  notInVoice: {
    mode: 'embed',
    content: 'Bu kullanıcı ses kanalında değil. ୭ ˚. !!',
    embedTitle: '',
    color: '#06B6D4',
    withIcon: true,
  },
  operationNotAllowed: {
    mode: 'embed',
    content: 'Bu işlem kullanıcıya uygulanamadı. ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
  durationRequired: {
    mode: 'embed',
    content: 'Susturma işlemi için süre belirtmelisiniz. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  invalidDuration: {
    mode: 'embed',
    content: 'Geçersiz süre girdiniz. Örnek: 10m, 1h, 7d. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  durationTooLong: {
    mode: 'embed',
    content: 'Susturma süresi {maxDuration} sınırını aşamaz. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  timeoutProtectedTarget: {
    mode: 'embed',
    content: 'Bu kullanıcı yönetici olduğu için susturulamaz. ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
  voiceDisconnectPermissionRequired: {
    mode: 'embed',
    content: 'Hedef seste olduğu için botta Üyeleri Taşı izni olmadan susturma uygulanamaz. ୭ ˚. !!',
    embedTitle: '',
    color: '#F59E0B',
    withIcon: true,
  },
  voiceDisconnectFailed: {
    mode: 'embed',
    content: 'Hedef sesten ayrılamadığı için susturma tamamlanamadı. {rollbackStatus} ୭ ˚. !!',
    embedTitle: '',
    color: '#EF4444',
    withIcon: true,
  },
};

const COMMAND_TEMPLATE_DEFAULTS = {
  warn: {
    success: { embedTitle: '(sebep: {reason}) ({caseId})', content: '{target} uyarıldı. ⋆˚࿔' },
  },
  mute: {
    success: { embedTitle: '(süre: {time}, sebep: {reason}) ({caseId})', content: '{target} susturuldu. ⋆˚࿔' },
    alreadyApplied: { content: '{target} zaten aktif olarak susturulmuş. ୭ ˚. !!' },
    durationRequired: { content: 'Susturma işlemi için süre belirtmelisiniz. ୭ ˚. !!' },
    invalidDuration: { content: 'Geçersiz süre girdiniz. Örnek: 10m, 1h, 7d. ୭ ˚. !!' },
    durationTooLong: { content: 'Susturma süresi {maxDuration} sınırını aşamaz. ୭ ˚. !!' },
    timeoutProtectedTarget: { content: '{target} yönetici olduğu için susturulamaz. ୭ ˚. !!' },
    voiceDisconnectPermissionRequired: {
      content: '{target} seste olduğu için botta Üyeleri Taşı izni olmadan susturma uygulanamaz. ୭ ˚. !!',
    },
    voiceDisconnectFailed: {
      content: '{target} sesten ayrılamadığı için susturma tamamlanamadı. {rollbackStatus} ୭ ˚. !!',
    },
  },
  unmute: {
    success: { embedTitle: '(sebep: {reason}) ({caseId})', content: '{target} susturması kaldırıldı. ⋆˚࿔' },
    notApplied: { content: '{target} zaten aktif olarak susturulmuş değil. ୭ ˚. !!' },
  },
  kick: {
    success: { embedTitle: '(sebep: {reason}) ({caseId})', content: '{target} sunucudan çıkarıldı. ⋆˚࿔' },
    operationNotAllowed: { content: '{target} sunucudan çıkarılamıyor. ୭ ˚. !!' },
  },
  jail: {
    success: { embedTitle: '(süre: {time}, sebep: {reason}) ({caseId})', content: '{target} Underworld\'e gönderildi. ⋆˚࿔' },
    alreadyApplied: { content: '{target} zaten Underworld\'de. ୭ ˚. !!' },
  },
  unjail: {
    success: { embedTitle: '', content: '{target} Underworld\'den çıkarıldı. ⋆˚࿔' },
    notApplied: { content: '{target} zaten Underworld\'de değil. ୭ ˚. !!' },
  },
  ban: {
    success: { embedTitle: '(sebep: {reason}) ({caseId})', content: '{target} yasaklandı. ⋆˚࿔' },
    alreadyApplied: { content: '{target} zaten yasaklı. ୭ ˚. !!' },
  },
  unban: {
    success: { embedTitle: '', content: '{target} yasağı kaldırıldı. ⋆˚࿔' },
    notApplied: { content: '{target} zaten yasaklı değil. ୭ ˚. !!' },
  },
  vcmute: {
    success: { embedTitle: '(süre: {time}, sebep: {reason}) ({caseId})', content: '{target} sesli kanallarda susturuldu. ⋆˚࿔' },
    alreadyApplied: { content: '{target} zaten sesli kanallarda susturulmuş. ୭ ˚. !!' },
    notInVoice: { content: '{target} ses kanalında değil. ୭ ˚. !!' },
  },
  vcunmute: {
    success: { embedTitle: '', content: '{target} sesli kanal susturması kaldırıldı. ⋆˚࿔' },
    notApplied: { content: '{target} zaten sesli kanallarda susturulmuş değil. ୭ ˚. !!' },
    notInVoice: { content: '{target} ses kanalında değil. ୭ ˚. !!' },
  },
};

const TEMPLATE_VARIABLES = [
  { key: 'target', preview: '@User' },
  { key: 'reason', preview: 'Sebep' },
  { key: 'caseId', preview: '#1' },
  { key: 'time', preview: '10m' },
  { key: 'limit', preview: '3' },
  { key: 'maxDuration', preview: '28d' },
  { key: 'rollbackStatus', preview: 'Susturma geri alındı.' },
  { key: 'user', preview: '@Moderator' },
  { key: 'guild', preview: 'SunucuAdi' },
  { key: 'channel', preview: '#general' },
  { key: 'command', preview: '/warn' },
  { key: 'prefix', preview: '.' },
  { key: 'args', preview: 'ornek arguman ozeti' },
];

function normalizeCommandName(commandName) {
  return String(commandName || '').trim().toLowerCase();
}

function isSupportedMessageCommand(commandName) {
  const c = normalizeCommandName(commandName);
  return MESSAGE_COMMANDS.some((item) => item.name === c);
}

function getCommandTemplateKeys(commandName) {
  const c = normalizeCommandName(commandName);
  if (!isSupportedMessageCommand(c)) return [];
  return [...new Set([...GENERIC_TEMPLATE_KEYS, ...(COMMAND_EXTRA_TEMPLATE_KEYS[c] || [])])];
}

function getTemplateKeyMeta(key) {
  const meta = TEMPLATE_KEY_META[key] || {};
  return {
    key,
    label: meta.label || key,
    description: meta.description || '',
  };
}

function getTemplateKeyMetaForCommand(commandName) {
  return getCommandTemplateKeys(commandName).map(getTemplateKeyMeta);
}

function getTemplateKeyMetaForGlobal() {
  const allKeys = [...new Set(MESSAGE_COMMANDS.flatMap((command) => getCommandTemplateKeys(command.name)))];
  return allKeys.map(getTemplateKeyMeta);
}

function getSystemDefaultTemplate(commandName, templateKey) {
  const base = BASE_TEMPLATE_DEFAULTS[templateKey] || BASE_TEMPLATE_DEFAULTS.systemError;
  const c = normalizeCommandName(commandName);
  const commandOverride = COMMAND_TEMPLATE_DEFAULTS[c]?.[templateKey] || {};
  return {
    mode: commandOverride.mode || base.mode || 'embed',
    content: commandOverride.content || base.content || '',
    embedTitle: Object.prototype.hasOwnProperty.call(commandOverride, 'embedTitle')
      ? commandOverride.embedTitle
      : base.embedTitle || '',
    color: commandOverride.color || base.color || '#BD37FB',
    withIcon: Object.prototype.hasOwnProperty.call(commandOverride, 'withIcon')
      ? Boolean(commandOverride.withIcon)
      : Boolean(base.withIcon),
  };
}

function buildSystemDefaultTemplates(commandName) {
  const out = {};
  for (const key of getCommandTemplateKeys(commandName)) {
    out[key] = getSystemDefaultTemplate(commandName, key);
  }
  return out;
}

function getMessageCommandCatalog() {
  return MESSAGE_COMMANDS.map((command) => ({
    name: command.name,
    label: command.label,
    templateKeys: getTemplateKeyMetaForCommand(command.name),
  }));
}

module.exports = {
  TEMPLATE_SCOPE_GLOBAL,
  TEMPLATE_SCOPE_COMMAND,
  TEMPLATE_MODES,
  TEMPLATE_VARIABLES,
  MESSAGE_COMMANDS,
  normalizeCommandName,
  isSupportedMessageCommand,
  getCommandTemplateKeys,
  getTemplateKeyMeta,
  getTemplateKeyMetaForCommand,
  getTemplateKeyMetaForGlobal,
  getSystemDefaultTemplate,
  buildSystemDefaultTemplates,
  getMessageCommandCatalog,
};
