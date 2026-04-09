const { logAction } = require('../moderation.logs');
const { getMissingDiscordPermissions } = require('../../application/security/roleSafety');
const { logError } = require('../../logger');
const { executeModerationAction } = require('../services/actionExecution');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');
const {
  DEFAULT_NATIVE_TIMEOUT_TEXT,
  parseRequiredTimeoutDuration,
  hasActiveCommunicationTimeout,
  verifyTimeoutClearedAuthoritatively,
  verifyTimeoutAppliedAuthoritatively,
  isMemberInVoice,
  isAdministratorTarget,
  applyCommunicationTimeout,
  clearCommunicationTimeout,
  disconnectMemberFromVoice,
} = require('../services/nativeTimeoutService');

function createCommandError(code, extra = {}) {
  const err = new Error(String(code || 'mute_command_failed').toLowerCase());
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function fetchTargetMember(guild, targetId) {
  if (!guild?.members?.fetch || !targetId) return null;
  return guild.members.fetch(targetId).catch(() => null);
}

function buildRollbackStatus(rollbackResult) {
  if (!rollbackResult?.attempted) return 'Geri alma işlemi uygulanamadı.';
  if (rollbackResult.verified) return 'Susturma geri alındı.';
  if (rollbackResult.cleared) return 'Geri alma işlemi denendi ancak doğrulanamadı.';
  if (rollbackResult.errorCode) return 'Geri alma işlemi başarısız oldu.';
  return 'Geri alma işlemi doğrulanamadı.';
}

async function rollbackTimeout({ message, targetMember, reason }) {
  const result = {
    attempted: false,
    cleared: false,
    verified: false,
    errorCode: null,
    actualUntilMs: null,
  };

  if (!targetMember?.id) {
    result.errorCode = 'ROLLBACK_TARGET_UNAVAILABLE';
    return result;
  }

  result.attempted = true;

  try {
    await clearCommunicationTimeout(targetMember, reason);
    result.cleared = true;

    const verifyResult = await verifyTimeoutClearedAuthoritatively({
      guild: message.guild,
      targetId: targetMember.id,
    });
    result.verified = verifyResult.ok;
    result.actualUntilMs = verifyResult.actualUntilMs || null;
    return result;
  } catch (err) {
    result.errorCode = String(err?.code || err?.message || 'ROLLBACK_FAILED');
    return result;
  }
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
  const durationResult = parseRequiredTimeoutDuration(cleanArgs[0]);

  const check = await verifyPermission('mute', targetMember, {
    execution: {
      requireTargetMember: true,
      requiredBotPermissions: ['ModerateMembers'],
      requireTargetModeratable: true,
      targetModeratableDeniedReasonCode: 'target_timeout_protected',
      targetModeratableDeniedTemplate: 'timeoutProtectedTarget',
    },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || targetMember;
  const authoritativeIconUser = authoritativeTarget.user || iconUser;

  if (!durationResult.ok) {
    if (durationResult.error === 'duration_too_long') {
      return sendTemplate(
        'durationTooLong',
        {
          target: targetMention,
          maxDuration: durationResult.maxDurationText || DEFAULT_NATIVE_TIMEOUT_TEXT,
        },
        { iconUser: authoritativeIconUser }
      );
    }
    return sendTemplate('invalidDuration', { target: targetMention }, { iconUser: authoritativeIconUser });
  }

  if (hasActiveCommunicationTimeout(authoritativeTarget)) {
    return sendTemplate('alreadyApplied', { target: targetMention }, { iconUser: authoritativeIconUser });
  }

  const reasonStartIndex = durationResult.consumedDurationToken ? 1 : 0;
  const reason = cleanArgs.slice(reasonStartIndex).join(' ') || 'Yok';
  const durationMs = durationResult.durationMs;
  const durationText = durationResult.durationText;

  let caseId = null;
  let confirmedTarget = authoritativeTarget;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'mute_command',
    mutationKey: `moderation:${message.guild.id}:${resolvedTargetId}`,
    beforePrimaryAction: async () => {
      const preflightTarget = await fetchTargetMember(message.guild, resolvedTargetId);
      if (!preflightTarget?.id || !preflightTarget.roles) {
        await sendTemplate('userNotFound', {}, { iconUser: message.client.user });
        return false;
      }

      if (isAdministratorTarget(preflightTarget)) {
        await sendTemplate('timeoutProtectedTarget', { target: targetMention }, { iconUser: preflightTarget.user || iconUser });
        return false;
      }

      if (isMemberInVoice(preflightTarget)) {
        const missingMovePermissions = getMissingDiscordPermissions(check.context?.botMember, ['MoveMembers']);
        if (missingMovePermissions.length > 0) {
          await sendTemplate('voiceDisconnectPermissionRequired', { target: targetMention }, { iconUser: message.client.user });
          return false;
        }
      }

      return check.consumeLimit();
    },
    primaryAction: async () => {
      const freshTarget = await fetchTargetMember(message.guild, resolvedTargetId);
      if (!freshTarget?.id || !freshTarget.roles) {
        throw createCommandError('TARGET_NOT_FOUND');
      }

      if (isAdministratorTarget(freshTarget)) {
        throw createCommandError('TARGET_IS_ADMINISTRATOR');
      }

      if (!freshTarget.moderatable) {
        throw createCommandError('TARGET_NOT_MODERATABLE');
      }

      const targetStartedInVoice = isMemberInVoice(freshTarget);
      if (targetStartedInVoice) {
        const missingMovePermissions = getMissingDiscordPermissions(check.context?.botMember, ['MoveMembers']);
        if (missingMovePermissions.length > 0) {
          throw createCommandError('VOICE_MOVE_PERMISSION_REQUIRED');
        }
      }

      if (hasActiveCommunicationTimeout(freshTarget)) {
        throw createCommandError('TIMEOUT_ALREADY_APPLIED');
      }

      const expectedUntilMs = Date.now() + durationMs;
      await applyCommunicationTimeout(freshTarget, durationMs, reason);

      const verifyResult = await verifyTimeoutAppliedAuthoritatively({
        guild: message.guild,
        targetId: resolvedTargetId,
        expectedUntilMs,
      });
      if (!verifyResult.ok) {
        throw createCommandError('TIMEOUT_VERIFY_FAILED', {
          verifyResult,
        });
      }

      const postTimeoutTarget = verifyResult.member || freshTarget;
      confirmedTarget = postTimeoutTarget;

      if (!targetStartedInVoice || !isMemberInVoice(postTimeoutTarget)) {
        return;
      }

      try {
        await disconnectMemberFromVoice(postTimeoutTarget, reason);
      } catch (err) {
        const voiceStateTarget = await fetchTargetMember(message.guild, resolvedTargetId);
        if (!voiceStateTarget?.id || !isMemberInVoice(voiceStateTarget)) {
          confirmedTarget = voiceStateTarget || postTimeoutTarget;
          return;
        }

        const rollbackResult = await rollbackTimeout({
          message,
          targetMember: voiceStateTarget,
          reason: `Mute voice rollback: ${reason}`,
        });

        logError('mute_command_voice_disconnect_failed', err, {
          guildId: message.guild.id,
          actorId: message.author.id,
          targetId: resolvedTargetId,
          rollbackResult,
        });

        throw createCommandError('VOICE_DISCONNECT_FAILED_AFTER_TIMEOUT', {
          rollbackResult,
        });
      }

      const postDisconnectTarget = await fetchTargetMember(message.guild, resolvedTargetId);
      if (!postDisconnectTarget?.id || !isMemberInVoice(postDisconnectTarget)) {
        confirmedTarget = postDisconnectTarget || postTimeoutTarget;
        return;
      }

      const rollbackResult = await rollbackTimeout({
        message,
        targetMember: postDisconnectTarget,
        reason: `Mute voice rollback: ${reason}`,
      });

      const disconnectVerifyError = createCommandError('VOICE_DISCONNECT_VERIFY_FAILED');
      logError('mute_command_voice_disconnect_verify_failed', disconnectVerifyError, {
        guildId: message.guild.id,
        actorId: message.author.id,
        targetId: resolvedTargetId,
        rollbackResult,
      });

      throw createCommandError('VOICE_DISCONNECT_FAILED_AFTER_TIMEOUT', {
        rollbackResult,
      });
    },
    primaryErrorHandler: async (err) => {
      const errorCode = String(err?.code || '');

      if (errorCode === 'TARGET_NOT_FOUND') {
        await sendTemplate('userNotFound', {}, { iconUser: message.client.user });
        return true;
      }

      if (errorCode === 'TIMEOUT_ALREADY_APPLIED') {
        await sendTemplate('alreadyApplied', { target: targetMention }, { iconUser });
        return true;
      }

      if (errorCode === 'TARGET_IS_ADMINISTRATOR') {
        await sendTemplate('timeoutProtectedTarget', { target: targetMention }, { iconUser });
        return true;
      }

      if (errorCode === 'VOICE_MOVE_PERMISSION_REQUIRED') {
        await sendTemplate('voiceDisconnectPermissionRequired', { target: targetMention }, { iconUser: message.client.user });
        return true;
      }

      if (errorCode === 'TARGET_NOT_MODERATABLE') {
        await sendTemplate('operationNotAllowed', { target: targetMention }, { iconUser: message.client.user });
        return true;
      }

      if (errorCode === 'VOICE_DISCONNECT_FAILED_AFTER_TIMEOUT') {
        await sendTemplate(
          'voiceDisconnectFailed',
          {
            target: targetMention,
            rollbackStatus: buildRollbackStatus(err.rollbackResult),
          },
          { iconUser }
        );
        return true;
      }

      if (errorCode === 'TIMEOUT_VERIFY_FAILED') {
        logError('mute_command_timeout_verify_failed', err, {
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
        label: 'log kaydı',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, resolvedTargetId, message.author.id, 'mute', reason, durationText);
        },
      },
    ],
    successContext: () => ({
      target: targetMention,
      time: durationText,
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
    warningPrefix: `${targetMention} susturuldu ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'mute',
    targetUserOrMember: confirmedTarget,
    reason,
    durationText,
  });
}

module.exports = { run };
