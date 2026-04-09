const { logAction } = require('../moderation.logs');
const { executeModerationAction, getDiscordErrorCode } = require('../services/actionExecution');
const {
  UNKNOWN_GUILD_BAN_ERROR_CODE,
  fetchAuthoritativeGuildBan,
  ensureGuildBanAbsent,
  evictGuildBanCache,
  acquireGuildBanMutationLock,
} = require('../services/guildBanState');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');
const logger = require('../../logger');

const logVerifyFailure =
  typeof logger.logStructuredError === 'function'
    ? logger.logStructuredError
    : (context, err, extra = {}) => {
        if (typeof logger.logError === 'function') {
          logger.logError(context, err, extra);
        }
      };

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

function isValidSnowflake(value) {
  return DISCORD_SNOWFLAKE_REGEX.test(String(value || '').trim());
}

async function run(ctx) {
  const { message, target, targetId, cleanArgs, targetMention, sendTemplate, verifyPermission, argsSummary } = ctx;

  const resolvedTargetId = String(target?.id || targetId || '').trim();
  const hasRawTargetInput = Boolean(String(argsSummary || '').trim());

  if (!resolvedTargetId) {
    if (hasRawTargetInput) {
      return sendTemplate('userNotFound', {}, { iconUser: message.client.user });
    }
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  if (!isValidSnowflake(resolvedTargetId)) {
    return sendTemplate('userNotFound', {}, { iconUser: message.client.user });
  }

  const resolvedTargetMention = target?.id ? targetMention : `<@${resolvedTargetId}>`;

  const check = await verifyPermission('ban', null, {
    targetId: resolvedTargetId,
    execution: {
      requiredBotPermissions: ['BanMembers'],
    },
  });
  if (!check.success) return;

  let banned = null;
  try {
    banned = await fetchAuthoritativeGuildBan(message.guild, resolvedTargetId);
  } catch {
    return sendTemplate('systemError', { target: resolvedTargetMention }, { iconUser: message.client.user });
  }

  const iconUser = target?.user || banned?.user || message.client.user;
  if (!banned) {
    return sendTemplate('notApplied', { target: resolvedTargetMention }, { iconUser });
  }

  const reason = cleanArgs.join(' ') || 'af';
  let caseId = null;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'unban_command',
    mutationKey: `moderation:${message.guild.id}:${resolvedTargetId}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      const releaseBanMutationLock = await acquireGuildBanMutationLock(message.guild.id, resolvedTargetId);
      try {
        const currentBan = await fetchAuthoritativeGuildBan(message.guild, resolvedTargetId);
        if (!currentBan) {
          const err = new Error('ban_not_applied');
          err.code = 'UNBAN_NOT_APPLIED';
          throw err;
        }
        await message.guild.bans.remove(resolvedTargetId, reason);
        evictGuildBanCache(message.guild, resolvedTargetId);
        try {
          await ensureGuildBanAbsent(message.guild, resolvedTargetId);
        } catch (err) {
          if (String(err?.code || '') === 'GUILD_BAN_STILL_PRESENT') throw err;
          logVerifyFailure('unban_command_post_action_verify_failed', err, {
            guildId: message.guild.id,
            targetId: resolvedTargetId,
          }, 'WARN');
        }
      } finally {
        releaseBanMutationLock();
      }
    },
    primaryErrorHandler: async (err) => {
      if (getDiscordErrorCode(err) === UNKNOWN_GUILD_BAN_ERROR_CODE || String(err?.code || '') === 'UNBAN_NOT_APPLIED') {
        await sendTemplate('notApplied', { target: resolvedTargetMention }, { iconUser });
        return true;
      }
      return false;
    },
    sideEffects: [
      {
        label: 'log kaydı',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, resolvedTargetId, message.author.id, 'unban', reason, 'Yok');
        },
      },
    ],
    successContext: () => ({
      target: resolvedTargetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }),
    successOptions: {
      iconUser,
    },
    operationNotAllowedContext: { target: resolvedTargetMention },
    operationNotAllowedOptions: { iconUser },
    systemErrorContext: { target: resolvedTargetMention },
    systemErrorOptions: { iconUser },
    warningPrefix: `${resolvedTargetMention} yasağı kaldırıldı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'unban',
    targetUserOrMember: banned?.user || target?.user || resolvedTargetId,
    targetId: resolvedTargetId,
  });
}

module.exports = { run };


