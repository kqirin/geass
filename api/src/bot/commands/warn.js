const { logAction } = require('../moderation.logs');
const { executeModerationAction } = require('../services/actionExecution');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('warn', target, {
    execution: {
      requireTargetMember: true,
    },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || target;
  const reason = cleanArgs.join(' ') || 'Yok';
  let caseId = null;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'warn_command',
    mutationKey: `moderation:${message.guild.id}:${authoritativeTarget.id}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      caseId = await logAction(message.guild.id, authoritativeTarget.id, message.author.id, 'warn', reason, 'Yok');
    },
    successContext: () => ({
      target: targetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }),
    successOptions: {
      iconUser: authoritativeTarget.user || authoritativeTarget,
    },
    operationNotAllowedContext: { target: targetMention },
    operationNotAllowedOptions: { iconUser: message.client.user },
    systemErrorContext: { target: targetMention },
    systemErrorOptions: { iconUser: target.user || target },
    warningPrefix: `${targetMention} uyarıldı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'warn',
    targetUserOrMember: authoritativeTarget,
    reason,
  });
}

module.exports = { run };


