const penaltyScheduler = require('../penaltyScheduler');
const { executeModerationAction } = require('../services/actionExecution');
const { notifyModerationActionIfSuccessful } = require('../services/moderationDmService');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, settings } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('jail', target, {
    execution: {
      requireTargetMember: true,
      requiredBotPermissions: ['ManageRoles'],
      requireTargetManageable: true,
      managedRoleSettingKey: 'jail_penalty_role',
      managedRoleMissingTemplate: 'roleNotConfigured',
      requireBotRoleAboveManagedRole: true,
    },
  });
  if (!check.success) return;

  const authoritativeTarget = check.context?.targetMember || target;
  const jailRole = check.context?.managedRoleId || settings.jail_penalty_role;

  if (!authoritativeTarget.roles.cache.has(jailRole)) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: authoritativeTarget.user });
  }

  const reason = cleanArgs.join(' ') || 'manuel';

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'unjail_command',
    mutationKey: `moderation:${message.guild.id}:${authoritativeTarget.id}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      await penaltyScheduler.restoreJailRoles(message.client, {
        guildId: message.guild.id,
        userId: authoritativeTarget.id,
        jailRoleId: jailRole,
      });
    },
    sideEffects: [
      {
        label: 'ceza iptali',
        run: async () => {
          await penaltyScheduler.cancelPenalty(message.guild.id, authoritativeTarget.id, 'jail');
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
    systemErrorOptions: { iconUser: message.client.user },
    warningPrefix: `${targetMention} Underworld'den çıkarıldı ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'unjail',
    targetUserOrMember: authoritativeTarget,
  });
}

module.exports = { run };



