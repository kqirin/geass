const { logAction } = require('../moderation.logs');
const { logError } = require('../../logger');
const { executeModerationAction } = require('../services/actionExecution');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');
const {
  hasActiveCommunicationTimeout,
  verifyTimeoutClearedAuthoritatively,
  clearCommunicationTimeout,
} = require('../services/nativeTimeoutService');

function createCommandError(code, extra = {}) {
  const err = new Error(String(code || 'unmute_command_failed').toLowerCase());
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function fetchTargetMember(guild, targetId) {
  if (!guild?.members?.fetch || !targetId) return null;
  return guild.members.fetch(targetId).catch(() => null);
}

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, argsSummary } = ctx;
  const resolvedTargetId = String(target?.id || '').trim();
  const hasRawTargetInput = Boolean(String(argsSummary || '').trim());

  if (!resolvedTargetId) {
    if (hasRawTargetInput) {
      return sendTemplate('userNotFound', {}, { iconUser: message.client.user });
    }
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const targetMember = target?.roles ? target : await fetchTargetMember(message.guild, resolvedTargetId);
  if (!targetMember?.id || !targetMember.roles) {
    return sendTemplate('userNotFound', {}, { iconUser: message.client.user });
  }

  const iconUser = targetMember.user || message.client.user;
  const check = await verifyPermission('unmute', targetMember, {
    execution: {
      requireTargetMember: true,
      requiredBotPermissions: ['ModerateMembers'],
      requireTargetModeratable: true,
    },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || targetMember;
  const authoritativeIconUser = authoritativeTarget.user || iconUser;

  if (!hasActiveCommunicationTimeout(authoritativeTarget)) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: authoritativeIconUser });
  }

  const reason = cleanArgs.join(' ') || 'Yok';
  let caseId = null;
  let confirmedTarget = authoritativeTarget;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'unmute_command',
    mutationKey: `moderation:${message.guild.id}:${resolvedTargetId}`,
    beforePrimaryAction: async () => {
      const preflightTarget = await fetchTargetMember(message.guild, resolvedTargetId);
      if (!preflightTarget?.id || !preflightTarget.roles) {
        await sendTemplate('userNotFound', {}, { iconUser: message.client.user });
        return false;
      }

      if (!hasActiveCommunicationTimeout(preflightTarget)) {
        await sendTemplate('notApplied', { target: targetMention }, { iconUser: preflightTarget.user || iconUser });
        return false;
      }

      return check.consumeLimit();
    },
    primaryAction: async () => {
      const freshTarget = await fetchTargetMember(message.guild, resolvedTargetId);
      if (!freshTarget?.id || !freshTarget.roles) {
        throw createCommandError('TARGET_NOT_FOUND');
      }

      if (!freshTarget.moderatable) {
        throw createCommandError('TARGET_NOT_MODERATABLE');
      }

      if (!hasActiveCommunicationTimeout(freshTarget)) {
        throw createCommandError('TIMEOUT_NOT_APPLIED');
      }

      await clearCommunicationTimeout(freshTarget, reason);

      const verifyResult = await verifyTimeoutClearedAuthoritatively({
        guild: message.guild,
        targetId: resolvedTargetId,
      });
      if (!verifyResult.ok) {
        throw createCommandError('UNMUTE_VERIFY_FAILED', {
          verifyResult,
        });
      }

      confirmedTarget = verifyResult.member || freshTarget;
    },
    primaryErrorHandler: async (err) => {
      const errorCode = String(err?.code || '');

      if (errorCode === 'TARGET_NOT_FOUND') {
        await sendTemplate('userNotFound', {}, { iconUser: message.client.user });
        return true;
      }

      if (errorCode === 'TIMEOUT_NOT_APPLIED') {
        await sendTemplate('notApplied', { target: targetMention }, { iconUser });
        return true;
      }

      if (errorCode === 'TARGET_NOT_MODERATABLE') {
        await sendTemplate('operationNotAllowed', { target: targetMention }, { iconUser: message.client.user });
        return true;
      }

      if (errorCode === 'UNMUTE_VERIFY_FAILED') {
        logError('unmute_command_verify_failed', err, {
          guildId: message.guild.id,
          actorId: message.author.id,
          targetId: resolvedTargetId,
          verifyReason: err.verifyReason || err.verifyResult?.reason || null,
          actualUntilMs: err.verifyResult?.actualUntilMs || null,
        });
        await sendTemplate('systemError', { target: targetMention }, { iconUser });
        return true;
      }

      return false;
    },
    sideEffects: [
      {
        label: 'log kaydi',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, resolvedTargetId, message.author.id, 'unmute', reason, 'Yok');
        },
      },
    ],
    successContext: () => ({
      target: targetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }),
    successOptions: () => ({
      iconUser: confirmedTarget?.user || iconUser,
    }),
    operationNotAllowedContext: { target: targetMention },
    operationNotAllowedOptions: { iconUser: message.client.user },
    systemErrorContext: { target: targetMention },
    systemErrorOptions: { iconUser },
    warningPrefix: `${targetMention} susturması kaldırıldı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'unmute',
    targetUserOrMember: confirmedTarget,
    reason,
  });
}

module.exports = { run };
