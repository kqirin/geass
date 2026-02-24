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
  { name: 'clear', label: 'Clear' },
  { name: 'vcmute', label: 'VC Mute' },
  { name: 'vcunmute', label: 'VC Unmute' },
];

const TEMPLATE_KEY_META = {
  success: { label: 'Basarili', description: 'Islem basariyla tamamlandiginda.' },
  permissionDenied: { label: 'Yetki Yok', description: 'Komut kullanma yetkisi olmadiginda.' },
  roleInsufficient: { label: 'Yetersiz Rol', description: 'Kullanicinin rolu yetersiz oldugunda.' },
  roleNotConfigured: { label: 'Rol Ayari Yok', description: 'Gerekli rol ayari yapilmamis oldugunda.' },
  targetRoleHigher: { label: 'Hedef Rolu Yuksek', description: 'Hedefin rolu komutu kullanan kisiden yuksek oldugunda.' },
  limitReached: { label: 'Limit Doldu', description: 'Komut limiti doldugunda.' },
  userNotFound: { label: 'Kullanici Bulunamadi', description: 'Hedef kullanici bulunamadiginda.' },
  invalidUsage: { label: 'Hatali Kullanim', description: 'Komut eksik veya hatali kullanildiginda.' },
  systemError: { label: 'Sistem Hatasi', description: 'Beklenmeyen hata olustugunda.' },
  abuseLock: { label: 'Yetki Askisi', description: 'Asiri limit ihlalinde yetki kaldirildiginda.' },
  alreadyApplied: { label: 'Zaten Uygulandi', description: 'Ayni ceza/islem zaten aktif oldugunda.' },
  notApplied: { label: 'Zaten Aktif Degil', description: 'Geri alinacak ceza/islem zaten yoksa.' },
  notInVoice: { label: 'Seste Degil', description: 'Hedef ses kanalinda degilse.' },
  operationNotAllowed: { label: 'Islem Uygulanamadi', description: 'Discord hiyerarsi/izin nedeni ile islem yapilamadiginda.' },
};

const GENERIC_TEMPLATE_KEYS = [
  'success',
  'permissionDenied',
  'roleInsufficient',
  'roleNotConfigured',
  'targetRoleHigher',
  'limitReached',
  'userNotFound',
  'invalidUsage',
  'systemError',
  'abuseLock',
];

const COMMAND_EXTRA_TEMPLATE_KEYS = {
  warn: [],
  mute: ['alreadyApplied'],
  unmute: ['notApplied'],
  kick: ['operationNotAllowed'],
  jail: ['alreadyApplied'],
  unjail: ['notApplied'],
  ban: ['alreadyApplied'],
  unban: ['notApplied'],
  clear: [],
  vcmute: ['alreadyApplied', 'notInVoice'],
  vcunmute: ['notApplied', 'notInVoice'],
};

const BASE_TEMPLATE_DEFAULTS = {
  success: {
    mode: 'embed',
    content: 'Islem basariyla tamamlandi.',
    embedTitle: 'ISLEM BASARILI',
    color: '#BD37FB',
    withIcon: true,
  },
  permissionDenied: {
    mode: 'embed',
    content: 'Bu komutu kullanamazsin, yetkin yok.',
    embedTitle: 'YETKI YOK',
    color: '#F97316',
    withIcon: true,
  },
  roleInsufficient: {
    mode: 'embed',
    content: 'Bu komut icin rolu yetmiyor.',
    embedTitle: 'YETERSIZ ROL',
    color: '#F97316',
    withIcon: true,
  },
  roleNotConfigured: {
    mode: 'embed',
    content: 'Bu komut icin gerekli rol ayari yapilmamis.',
    embedTitle: 'ROL AYARI GEREKLI',
    color: '#F59E0B',
    withIcon: true,
  },
  targetRoleHigher: {
    mode: 'embed',
    content: 'Hedef kullanicinin rolu senden yuksek.',
    embedTitle: 'HIYERARSI ENGELI',
    color: '#EF4444',
    withIcon: true,
  },
  limitReached: {
    mode: 'embed',
    content: 'Limit doldu. Saatlik limit: {limit}.',
    embedTitle: 'LIMIT DOLDU',
    color: '#F59E0B',
    withIcon: true,
  },
  userNotFound: {
    mode: 'embed',
    content: 'Kullanici bulunamadi.',
    embedTitle: 'KULLANICI YOK',
    color: '#EF4444',
    withIcon: true,
  },
  invalidUsage: {
    mode: 'embed',
    content: 'Hatali kullanim. Komutu dogru sekilde tekrar dene.',
    embedTitle: 'HATALI KULLANIM',
    color: '#F59E0B',
    withIcon: true,
  },
  systemError: {
    mode: 'embed',
    content: 'Beklenmeyen bir hata olustu.',
    embedTitle: 'SISTEM HATASI',
    color: '#EF4444',
    withIcon: true,
  },
  abuseLock: {
    mode: 'embed',
    content: 'Asiri limit ihlali nedeniyle yetkin gecici olarak kaldirildi.',
    embedTitle: 'YETKI ASKISI',
    color: '#EF4444',
    withIcon: true,
  },
  alreadyApplied: {
    mode: 'embed',
    content: 'Bu islem zaten aktif.',
    embedTitle: 'ZATEN UYGULANMIS',
    color: '#A855F7',
    withIcon: true,
  },
  notApplied: {
    mode: 'embed',
    content: 'Bu islem zaten aktif degil.',
    embedTitle: 'ISLEM BULUNAMADI',
    color: '#A855F7',
    withIcon: true,
  },
  notInVoice: {
    mode: 'embed',
    content: 'Hedef kullanici ses kanalinda degil.',
    embedTitle: 'SESTE DEGIL',
    color: '#06B6D4',
    withIcon: true,
  },
  operationNotAllowed: {
    mode: 'embed',
    content: 'Bu islem hedef kullaniciya uygulanamadi.',
    embedTitle: 'ISLEM BASARISIZ',
    color: '#EF4444',
    withIcon: true,
  },
};

const COMMAND_TEMPLATE_DEFAULTS = {
  warn: {
    success: { embedTitle: 'WARN BASARILI', content: '{target} uyarildi. (sebep: {reason}) ({caseId})' },
  },
  mute: {
    success: { embedTitle: 'MUTE BASARILI', content: '{target} susturuldu. (sure: {time}, sebep: {reason}) ({caseId})' },
    alreadyApplied: { content: '{target} zaten susturulmus.' },
  },
  unmute: {
    success: { embedTitle: 'UNMUTE BASARILI', content: '{target} susturmasi kaldirildi. (sebep: {reason})' },
    notApplied: { content: '{target} zaten susturulmamis.' },
  },
  kick: {
    success: { embedTitle: 'KICK BASARILI', content: '{target} sunucudan atildi. (sebep: {reason}) ({caseId})' },
    operationNotAllowed: { content: '{target} hedefi kicklenemiyor.' },
  },
  jail: {
    success: { embedTitle: 'JAIL BASARILI', content: '{target} karantinaya alindi. (sure: {time}, sebep: {reason}) ({caseId})' },
    alreadyApplied: { content: '{target} zaten karantinada.' },
  },
  unjail: {
    success: { embedTitle: 'UNJAIL BASARILI', content: '{target} karantinadan cikarildi. (sebep: {reason})' },
    notApplied: { content: '{target} zaten karantinada degil.' },
  },
  ban: {
    success: { embedTitle: 'BAN BASARILI', content: '{target} banlandi. (sebep: {reason}) ({caseId})' },
    alreadyApplied: { content: '{target} zaten banli.' },
  },
  unban: {
    success: { embedTitle: 'UNBAN BASARILI', content: '{target} ban kaldirildi. (sebep: {reason})' },
    notApplied: { content: '{target} zaten banli degil.' },
  },
  clear: {
    success: { embedTitle: 'CLEAR BASARILI', content: '{amount} mesaj silindi.' },
  },
  vcmute: {
    success: { embedTitle: 'VC MUTE BASARILI', content: '{target} ses susturuldu. (sure: {time}, sebep: {reason}) ({caseId})' },
    alreadyApplied: { content: '{target} zaten ses susturulmus.' },
    notInVoice: { content: '{target} ses kanalinda degil.' },
  },
  vcunmute: {
    success: { embedTitle: 'VC UNMUTE BASARILI', content: '{target} ses susturmasi kaldirildi. (sebep: {reason})' },
    notApplied: { content: '{target} zaten ses susturulmamis.' },
    notInVoice: { content: '{target} ses kanalinda degil.' },
  },
};

const TEMPLATE_VARIABLES = [
  { key: 'target', preview: '@User' },
  { key: 'reason', preview: 'Sebep' },
  { key: 'caseId', preview: '#1' },
  { key: 'time', preview: '10m' },
  { key: 'limit', preview: '3' },
  { key: 'amount', preview: '2' },
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
