const { logAction } = require('../moderation.logs');
const { executeModerationAction } = require('../services/actionExecution');
const {
  fetchAuthoritativeGuildBan,
  ensureGuildBanPresent,
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

  const targetMember =
    target?.roles ? target : await message.guild.members.fetch(resolvedTargetId).catch(() => null);

  const resolvedTargetMention = targetMention;
  const iconUser = targetMember?.user || message.client.user;

  const check = await verifyPermission('ban', targetMember || null, {
    targetId: resolvedTargetId,
    execution: targetMember
      ? { requireTargetMember: true, requireTargetBannable: true }
      : { requiredBotPermissions: ['BanMembers'] },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || targetMember;
  let already = null;
  try {
    already = await fetchAuthoritativeGuildBan(message.guild, resolvedTargetId);
  } catch {
    return sendTemplate('systemError', { target: resolvedTargetMention }, { iconUser });
  }
  if (already) {
    return sendTemplate('alreadyApplied', { target: resolvedTargetMention }, { iconUser: already.user || iconUser });
  }

  const reason = cleanArgs.join(' ') || 'Yok';
  let caseId = null;
  let confirmedBan = null;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'ban_command',
    mutationKey: `moderation:${message.guild.id}:${resolvedTargetId}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      const releaseBanMutationLock = await acquireGuildBanMutationLock(message.guild.id, resolvedTargetId);
      try {
        const freshTarget = await message.guild.members.fetch(resolvedTargetId).catch(() => null);
        if (freshTarget && !freshTarget.bannable) {
          const err = new Error('ban_target_state_changed');
          err.code = 'BAN_TARGET_STATE_CHANGED';
          throw err;
        }
        const currentBan = await fetchAuthoritativeGuildBan(message.guild, resolvedTargetId);
        if (currentBan) {
          const err = new Error('ban_already_applied');
          err.code = 'BAN_ALREADY_APPLIED';
          err.ban = currentBan;
          throw err;
        }
        await message.guild.members.ban(freshTarget?.id ?? resolvedTargetId, { reason });
        try {
          confirmedBan = await ensureGuildBanPresent(message.guild, freshTarget?.id ?? resolvedTargetId);
        } catch (err) {
          if (String(err?.code || '') === 'GUILD_BAN_NOT_PRESENT') throw err;
          logVerifyFailure('ban_command_post_action_verify_failed', err, {
            guildId: message.guild.id,
            targetId: freshTarget?.id || resolvedTargetId,
          }, 'WARN');
          confirmedBan = null;
        }
      } finally {
        releaseBanMutationLock();
      }
    },
    primaryErrorHandler: async (err) => {
      if (String(err?.code || '') === 'BAN_TARGET_STATE_CHANGED') {
        await sendTemplate('operationNotAllowed', { target: resolvedTargetMention }, { iconUser });
        return true;
      }
      if (String(err?.code || '') === 'BAN_ALREADY_APPLIED') {
        await sendTemplate('alreadyApplied', { target: resolvedTargetMention }, { iconUser: err?.ban?.user || iconUser });
        return true;
      }
      return false;
    },
    sideEffects: [
      {
        label: 'log kaydı',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, resolvedTargetId, message.author.id, 'ban', reason, 'Süresiz');
        },
      },
    ],
    successContext: () => ({
      target: resolvedTargetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }),
    successOptions: () => ({
      iconUser: confirmedBan?.user || iconUser,
    }),
    operationNotAllowedContext: { target: resolvedTargetMention },
    operationNotAllowedOptions: { iconUser },
    systemErrorContext: { target: resolvedTargetMention },
    systemErrorOptions: { iconUser },
    warningPrefix: `${resolvedTargetMention} yasaklandı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'ban',
    targetUserOrMember: confirmedBan?.user || authoritativeTarget.user || resolvedTargetId,
    targetId: resolvedTargetId,
    reason,
  });
}

module.exports = { run };


