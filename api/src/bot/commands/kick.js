const { logAction } = require('../moderation.logs');
const { executeModerationAction } = require('../services/actionExecution');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('kick', target, {
    execution: {
      requireTargetMember: true,
      requireTargetKickable: true,
    },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || target;
  const reason = cleanArgs.join(' ') || 'Yok';
  let caseId = null;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'kick_command',
    mutationKey: `moderation:${message.guild.id}:${authoritativeTarget.id}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      await authoritativeTarget.kick(reason);
    },
    sideEffects: [
      {
        label: 'log kaydı',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, authoritativeTarget.id, message.author.id, 'kick', reason, 'Yok');
        },
      },
    ],
    successContext: () => ({
      target: targetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }),
    successOptions: {
      iconUser: authoritativeTarget.user,
    },
    operationNotAllowedContext: { target: targetMention },
    operationNotAllowedOptions: { iconUser: authoritativeTarget.user },
    systemErrorContext: { target: targetMention },
    systemErrorOptions: { iconUser: authoritativeTarget.user },
    warningPrefix: `${targetMention} sunucudan çıkarıldı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'kick',
    targetUserOrMember: authoritativeTarget.user || authoritativeTarget,
    reason,
  });
}

module.exports = { run };


