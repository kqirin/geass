const HELP_COMMAND_ALIASES = Object.freeze([
  'yardim',
  'yard\u0131m',
]);

const BUILTIN_COMMAND_NAMES = Object.freeze([
  'log',
  'warn',
  'mute',
  'unmute',
  'kick',
  'jail',
  'unjail',
  'ban',
  'unban',
  'vcmute',
  'vcunmute',
  'embed',
  'lock',
  'unlock',
  'durum',
  ...HELP_COMMAND_ALIASES,
]);

const BUILTIN_COMMAND_NAME_SET = new Set(BUILTIN_COMMAND_NAMES);

function isBuiltinCommandName(input) {
  return BUILTIN_COMMAND_NAME_SET.has(String(input || '').trim().toLowerCase());
}

module.exports = {
  HELP_COMMAND_ALIASES,
  BUILTIN_COMMAND_NAMES,
  BUILTIN_COMMAND_NAME_SET,
  isBuiltinCommandName,
};
