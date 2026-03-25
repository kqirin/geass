const penaltyScheduler = require('../penaltyScheduler');
const { executeModerationAction } = require('../services/actionExecution');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission } = ctx;

  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('vcmute', target, {
    execution: {
      requireTargetMember: true,
      requireTargetInVoice: true,
      targetNotInVoiceTemplate: 'notInVoice',
      requiredBotPermissions: ['MuteMembers'],
      requireTargetManageable: true,
    },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || target;

  if (!authoritativeTarget.voice.serverMute) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: authoritativeTarget.user });
  }

  const reason = cleanArgs.join(' ') || 'manuel';

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'vcunmute_command',
    mutationKey: `moderation:${message.guild.id}:${authoritativeTarget.id}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      await authoritativeTarget.voice.setMute(false, reason);
    },
    sideEffects: [
      {
        label: 'ceza iptali',
        run: async () => {
          await penaltyScheduler.cancelPenalty(message.guild.id, authoritativeTarget.id, 'vcmute');
        },
      },
    ],
    successContext: {
      target: targetMention,
      reason,
    },
    successOptions: {
      iconUser: authoritativeTarget.user,
    },
    operationNotAllowedContext: { target: targetMention },
    operationNotAllowedOptions: { iconUser: message.client.user },
    systemErrorContext: { target: targetMention },
    systemErrorOptions: { iconUser: authoritativeTarget.user },
    warningPrefix: `${targetMention} sesli kanal susturması kaldırıldı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'vcunmute',
    targetUserOrMember: authoritativeTarget,
  });
}

module.exports = { run };


