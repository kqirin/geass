const cache = require('../utils/cache');
const { actionNames, resolveTarget } = require('./moderation.utils');
const { config } = require('../config');
const { DEFAULT_STATIC_SETTINGS } = require('../config/static');
const { createPermissionService } = require('./services/permissionService');
const { createTemplateSender } = require('../application/messages/templateService');
const { logSystem } = require('../logger');
const perfMonitor = require('../utils/perfMonitor');

const logCommand = require('./commands/log');
const warnCommand = require('./commands/warn');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const kickCommand = require('./commands/kick');
const jailCommand = require('./commands/jail');
const unjailCommand = require('./commands/unjail');
const banCommand = require('./commands/ban');
const unbanCommand = require('./commands/unban');
const vcmuteCommand = require('./commands/vcmute');
const vcunmuteCommand = require('./commands/vcunmute');
const yardimCommand = require('./commands/yardim');
const embedCommand = require('./commands/embed');
const lockCommand = require('./commands/lock');
const unlockCommand = require('./commands/unlock');
const durumCommand = require('./commands/durum');

const permissionService = createPermissionService({
  config,
  auditLogger: (event) => {
    const level = event?.allowed === true ? 'INFO' : 'WARN';
    logSystem(
      {
        event: 'moderation_guard_event',
        ...event,
      },
      level
    );
  },
});
const templateSender = createTemplateSender();

const DEFAULT_SETTINGS = DEFAULT_STATIC_SETTINGS;

const DEFAULT_SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));

function hasAllDefaultOwnKeys(rawSettings) {
  for (const key of DEFAULT_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rawSettings, key)) {
      return false;
    }
  }
  return true;
}

function normalizeSettings(rawSettings) {
  if (!rawSettings) return DEFAULT_SETTINGS;
  if (hasAllDefaultOwnKeys(rawSettings)) return rawSettings;
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
  };
}

const commandHandlers = {
  log: logCommand,
  warn: warnCommand,
  mute: muteCommand,
  unmute: unmuteCommand,
  kick: kickCommand,
  jail: jailCommand,
  unjail: unjailCommand,
  ban: banCommand,
  unban: unbanCommand,
  vcmute: vcmuteCommand,
  vcunmute: vcunmuteCommand,
  yardim: yardimCommand,
  'yard\u0131m': yardimCommand,
  embed: embedCommand,
  lock: lockCommand,
  unlock: unlockCommand,
  durum: durumCommand,
};

const MODERATION_TARGET_COMMANDS = new Set([
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
]);
function resolveTargetOptionsForCommand(command) {
  if (!MODERATION_TARGET_COMMANDS.has(command)) return null;
  return {
    allowNumericId: true,
    allowUserMention: true,
    allowReplyTarget: false,
    allowMemberSearch: false,
    allowUnresolvedTarget: command !== 'ban',
  };
}

function buildTargetMention(message, target, targetId, displayUsername) {
  if (target?.user?.username) {
    return `@${displayUsername || target.user.username}`;
  }
  if (targetId) {
    return `<@${targetId}>`;
  }
  return `@${message.author.username}`;
}

async function handlePrefix(client, message) {
  if (message.author.bot) return false;
  if (!message.guild) return false;

  const s = normalizeSettings(cache.getSettings(message.guild.id));

  permissionService.maybePruneModerationCaches();

  const configuredPrefix = typeof s.prefix === 'string' ? s.prefix.trim() : '';
  const prefix = configuredPrefix || '.';
  const cleaned = message.content
    .replace(/^(?:\s|<@!?\d+>|<@&\d+>)+/g, '')
    .trimStart();

  if (!cleaned.startsWith(prefix)) return false;

  const rawArgs = cleaned.slice(prefix.length).trim().split(/ +/);
  const command = (rawArgs.shift() || '').toLowerCase();
  const argsSummary = rawArgs.join(' ').trim().slice(0, 220);
  const commandDisplay = `${prefix}${command}`;

  const baseTemplateContext = {
    user: `@${message.member?.displayName || message.author.username}`,
    guild: message.guild.name || 'Sunucu',
    channel: message.channel?.toString?.() || '#kanal',
    command: commandDisplay,
    prefix,
    args: argsSummary,
  };

  const sendTemplate = (templateKey, context = {}, options = {}) => {
    return templateSender.sendTemplate({
      message,
      guildId: message.guild.id,
      commandName: command,
      templateKey,
      context: { ...baseTemplateContext, ...(context || {}) },
      iconUser: options.iconUser || null,
      targetUserOrId: Object.prototype.hasOwnProperty.call(options, 'targetUserOrId')
        ? options.targetUserOrId
        : null,
      asReply: options.asReply !== false,
      deleteAfterMs: options.deleteAfterMs || 0,
      allowReplyFallback: options.allowReplyFallback === true,
    });
  };

  // Use the same standard template path for all commands, including log.
  const sendPermissionTemplate = sendTemplate;
  const handler = commandHandlers[command];
  if (!handler?.run) return false;

  perfMonitor.incCounter('commandsExecuted');

  const targetResolutionOptions = resolveTargetOptionsForCommand(command);
  const targetData = targetResolutionOptions
    ? await resolveTarget(client, message, rawArgs, targetResolutionOptions)
    : await resolveTarget(client, message, rawArgs);

  const { target, targetId, cleanArgs, displayUsername } = targetData;
  const targetMention = buildTargetMention(message, target, targetId, displayUsername);
  const defaultTargetUserOrId = target?.user || targetId || target || null;

  const sendTemplateWithTarget = (templateKey, context = {}, options = {}) => {
    const mergedOptions = {
      ...options,
      targetUserOrId: Object.prototype.hasOwnProperty.call(options, 'targetUserOrId')
        ? options.targetUserOrId
        : defaultTargetUserOrId,
    };

    return sendPermissionTemplate(
      templateKey,
      {
        target: targetMention,
        ...context,
      },
      mergedOptions
    );
  };

  const verifyPermission = async (cmdType, targetMember, options = {}) => {
    const safeCmd = String(cmdType || '').trim().toLowerCase();
    const result = await permissionService.verifyPermission({
      message,
      targetMember,
      targetId: Object.prototype.hasOwnProperty.call(options, 'targetId')
        ? options.targetId
        : (targetMember?.id || targetId || null),
      settings: s,
      cmdType: safeCmd,
      actionCommand: String(options.actionCommand || command || safeCmd).trim().toLowerCase(),
      sendTemplate: sendTemplateWithTarget,
      contextBase: { target: targetMention },
      execution: options.execution || null,
      safeListBypassesRoleRestriction: options.safeListBypassesRoleRestriction === true,
      authoritativeActorRoleCheck: options.authoritativeActorRoleCheck === true,
    });
    return result;
  };

  const ctx = {
    client,
    message,
    target,
    targetId,
    cleanArgs,
    displayUsername,
    targetMention,
    settings: s,
    sendTemplate: sendTemplateWithTarget,
    verifyPermission,
    cache,
    actionNames,
    prefix,
    commandName: command,
    argsSummary,
    targetResolution: targetData,
  };

  await handler.run(ctx);
  return true;
}

module.exports = {
  handlePrefix,
};
