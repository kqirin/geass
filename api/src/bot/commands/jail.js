const { logAction } = require('../moderation.logs');
const { parseTime, formatTime } = require('../moderation.utils');
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

  if (authoritativeTarget.roles.cache.has(jailRole)) {
    return sendTemplate('alreadyApplied', { target: targetMention }, { iconUser: authoritativeTarget.user });
  }

  const durationMs = parseTime(cleanArgs[0]);
  const durationText = durationMs ? formatTime(cleanArgs[0]) : 'Süresiz';
  let reason = durationMs ? cleanArgs.slice(1).join(' ') : cleanArgs.join(' ');
  reason = reason || 'Yok';
  let caseId = null;

  const executionResult = await executeModerationAction({
    message,
    sendTemplate,
    logContext: 'jail_command',
    mutationKey: `moderation:${message.guild.id}:${authoritativeTarget.id}`,
    beforePrimaryAction: async () => check.consumeLimit(),
    primaryAction: async () => {
      const freshTarget = await message.guild.members.fetch(authoritativeTarget.id);
      const snapshotRoles = freshTarget.roles.cache
        .filter((r) => r.id !== message.guild.id && r.id !== jailRole)
        .map((r) => r.id);
      await penaltyScheduler.upsertRoleSnapshot(message.guild.id, authoritativeTarget.id, snapshotRoles);
      try {
        await freshTarget.roles.set([jailRole]);
      } catch (err) {
        await penaltyScheduler.deleteRoleSnapshot(message.guild.id, authoritativeTarget.id).catch(() => {});
        throw err;
      }
    },
    sideEffects: [
      {
        label: 'log kaydı',
        requiredForSuccess: true,
        run: async () => {
          caseId = await logAction(message.guild.id, authoritativeTarget.id, message.author.id, 'jail', reason, durationText);
        },
      },
      ...(durationMs
        ? [
            {
              label: 'ceza zamanlayıcı',
              requiredForSuccess: true,
              run: async () => {
                await penaltyScheduler.schedulePenalty(message.client, {
                  guildId: message.guild.id,
                  userId: authoritativeTarget.id,
                  actionType: 'jail',
                  roleId: jailRole,
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
    systemErrorOptions: { iconUser: message.client.user },
    warningPrefix: `${targetMention} Underworld'e gönderildi ancak bazı takip işlemleri tamamlanamadı`,
  });

  await notifyModerationActionIfSuccessful(executionResult, {
    message,
    actionType: 'jail',
    targetUserOrMember: authoritativeTarget,
    reason,
    durationText,
  });
}

module.exports = { run };



