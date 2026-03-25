const { logAction } = require('../moderation.logs');
const { parseTime, formatTime } = require('../moderation.utils');
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

  if (authoritativeTarget.voice.serverMute) {
    return sendTemplate('alreadyApplied', { target: targetMention }, { iconUser: authoritativeTarget.user });
  }

  const durationMs = parseTime(cleanArgs[0]);
  const durationText = durationMs ? formatTime(cleanArgs[0]) : 'Suresiz';
  let reason = durationMs ? cleanArgs.slice(1).join(' ') : cleanArgs.join(' ');
  reason = reason || 'Yok';
  let caseId = null;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'vcmute_command',
    mutationKey: `moderation:${message.guild.id}:${authoritativeTarget.id}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      await authoritativeTarget.voice.setMute(true, reason);
    },
    sideEffects: [
      {
        label: 'log kaydi',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, authoritativeTarget.id, message.author.id, 'vcmute', reason, durationText);
        },
      },
      ...(durationMs
        ? [
            {
              label: 'ceza zamanlayici',
              requiredForSuccess: true,
              run: async () => {
                await penaltyScheduler.schedulePenalty(message.client, {
                  guildId: message.guild.id,
                  userId: authoritativeTarget.id,
                  actionType: 'vcmute',
                  revokeAt: Date.now() + durationMs,
                  reason,
                });
              },
            },
          ]
        : []),
    ],
    successContext: () => ({
      target: targetMention,
      time: durationText,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }),
    successOptions: {
      iconUser: authoritativeTarget.user,
    },
    operationNotAllowedContext: { target: targetMention },
    operationNotAllowedOptions: { iconUser: message.client.user },
    systemErrorContext: { target: targetMention },
    systemErrorOptions: { iconUser: authoritativeTarget.user },
    warningPrefix: `${targetMention} sesli kanallarda susturuldu ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'vcmute',
    targetUserOrMember: authoritativeTarget,
    reason,
    durationText,
  });
}

module.exports = { run };


