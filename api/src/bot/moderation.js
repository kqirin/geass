const cache = require('../utils/cache');
const { actionNames, resolveTarget } = require('./moderation.utils');
const { config } = require('../config');
const { createPermissionService } = require('./services/permissionService');
const { createTemplateSender } = require('../application/messages/templateService');

const logCommand = require('./commands/log');
const warnCommand = require('./commands/warn');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const kickCommand = require('./commands/kick');
const jailCommand = require('./commands/jail');
const unjailCommand = require('./commands/unjail');
const banCommand = require('./commands/ban');
const unbanCommand = require('./commands/unban');
const clearCommand = require('./commands/clear');
const vcmuteCommand = require('./commands/vcmute');
const vcunmuteCommand = require('./commands/vcunmute');

const protectedCommands = new Set([
  'log',
  'warn',
  'mute',
  'unmute',
  'kick',
  'jail',
  'unjail',
  'ban',
  'unban',
  'clear',
  'vcmute',
  'vcunmute',
]);

const permissionKeyMap = {
  unmute: 'mute',
  unjail: 'jail',
  unban: 'ban',
  vcunmute: 'vcmute',
};

const permissionService = createPermissionService({ config });
const templateSender = createTemplateSender({ cache });
const DEFAULT_SETTINGS = {
  prefix: '.',
  custom_messages: {},
  log_enabled: true,
  log_role: null,
  log_safe_list: '',
  log_limit: 25,
  warn_enabled: true,
  warn_role: null,
  warn_safe_list: '',
  warn_limit: 0,
  mute_enabled: true,
  mute_role: null,
  mute_penalty_role: null,
  mute_safe_list: '',
  mute_limit: 25,
  kick_enabled: true,
  kick_role: null,
  kick_safe_list: '',
  kick_limit: 5,
  jail_enabled: true,
  jail_role: null,
  jail_penalty_role: null,
  jail_safe_list: '',
  jail_limit: 5,
  ban_enabled: true,
  ban_role: null,
  ban_safe_list: '',
  ban_limit: 5,
  clear_enabled: true,
  clear_role: null,
  clear_safe_list: '',
  clear_limit: 25,
  tag_enabled: false,
  tag_role: null,
  vcmute_enabled: true,
  vcmute_role: null,
  vcmute_safe_list: '',
  vcmute_limit: 25,
};
let weeklyStaffTracker = null;

function setWeeklyStaffTracker(tracker) {
  weeklyStaffTracker = tracker || null;
}

function normalizeSettings(rawSettings) {
  const merged = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
  if (typeof merged.custom_messages === 'string') {
    try {
      merged.custom_messages = JSON.parse(merged.custom_messages || '{}');
    } catch {
      merged.custom_messages = {};
    }
  } else if (!merged.custom_messages || typeof merged.custom_messages !== 'object') {
    merged.custom_messages = {};
  }
  return merged;
}

async function trackSuccessfulCommand(guildId, userId, command) {
  if (!weeklyStaffTracker?.trackEvent) return;
  await weeklyStaffTracker.trackEvent({
    guildId,
    userId,
    eventType: 'command',
    commandName: command,
    occurredAt: Date.now(),
    metadata: { source: 'prefix' },
  });
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
  clear: clearCommand,
  vcmute: vcmuteCommand,
  vcunmute: vcunmuteCommand,
};

async function handlePrefix(client, message) {
  if (message.author.bot) return;
  if (!message.guild) return;

  const s = normalizeSettings(cache.getSettings(message.guild.id));

  permissionService.maybePruneModerationCaches();

  const prefix = s.prefix || '.';
  const cleaned = message.content
    .replace(/^(?:\s|<@!?\d+>|<@&\d+>)+/g, '')
    .trimStart();

  if (!cleaned.startsWith(prefix)) return;

  const rawArgs = cleaned.slice(prefix.length).trim().split(/ +/);
  const command = (rawArgs.shift() || '').toLowerCase();
  const argsSummary = rawArgs.join(' ').trim().slice(0, 220);
  const commandDisplay = `${prefix}${command}`;
  const permCommand = permissionKeyMap[command] || command;

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
    });
  };

  const sendLogStaticTemplate = (templateKey, context = {}) => {
    const textMap = {
      permissionDenied: 'bu komutu kullanamazsin, yetkin yok..',
      roleInsufficient: 'bu komutu kullanamazsin, yetkin yok..',
      roleNotConfigured: 'bu komut icin yetkili rolu secilmemis..',
      targetRoleHigher: 'bu kisinin yetkisi senden yuksek.',
      limitReached: 'hakkin doldu (limit: {limit}/saat)',
      abuseLock: 'sansini zorladigin icin yetkin elinden alindi..',
      invalidUsage: 'ID veya reply/mention lazim..',
      systemError: 'islem basarisiz.',
    };
    const template = textMap[templateKey] || textMap.systemError;
    const rendered = String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
      if (!Object.prototype.hasOwnProperty.call(context, key)) return full;
      const value = context[key];
      return value === null || value === undefined ? '' : String(value);
    });

    return message.reply({
      content: rendered,
      allowedMentions: { parse: [] },
    });
  };

  const sendPermissionTemplate = command === 'log' ? sendLogStaticTemplate : sendTemplate;

  if (protectedCommands.has(command)) {
    let denial = null;
    if (!s[`${permCommand}_enabled`]) denial = 'permissionDenied';
    else if (!s[`${permCommand}_role`]) denial = 'roleNotConfigured';
    else if (!message.member.roles.cache.has(s[`${permCommand}_role`])) denial = 'roleInsufficient';

    if (denial) {
      const { shouldReply } = permissionService.registerUnauthorizedAttempt(message.guild.id, message.author.id, permCommand);
      if (shouldReply) {
        await sendPermissionTemplate(denial, { target: `<@${message.author.id}>` }, { iconUser: message.author });
      }
      return;
    }
  }

  let targetData;
  if (command === 'clear') {
    targetData = { target: null, targetId: rawArgs[0], cleanArgs: rawArgs, displayUsername: message.author.username };
  } else {
    targetData = await resolveTarget(client, message, rawArgs);
  }

  const { target, targetId, cleanArgs, displayUsername } = targetData;
  const targetMention = target?.id ? `@${displayUsername}` : `@${message.author.username}`;

  const sendTemplateWithTarget = (templateKey, context = {}, options = {}) =>
    sendPermissionTemplate(
      templateKey,
      {
        target: targetMention,
        ...context,
      },
      options
    );

  const verifyPermission = async (cmdType, targetMember) => {
    return permissionService.verifyPermission({
      message,
      targetMember,
      settings: s,
      cmdType,
      sendTemplate: sendTemplateWithTarget,
      contextBase: { target: targetMention },
    });
  };

  let commandSucceeded = false;
  const incrementLimitOriginal = cache.incrementLimit?.bind(cache);
  const trackedCache = {
    ...cache,
    incrementLimit: (...args) => {
      commandSucceeded = true;
      return incrementLimitOriginal ? incrementLimitOriginal(...args) : undefined;
    },
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
    cache: trackedCache,
    actionNames,
    prefix,
    commandName: command,
    argsSummary,
  };

  const handler = commandHandlers[command];
  if (!handler?.run) return;
  await handler.run(ctx);
  if (commandSucceeded) {
    await trackSuccessfulCommand(message.guild.id, message.author.id, command);
  }
}

module.exports = { handlePrefix, setWeeklyStaffTracker };

