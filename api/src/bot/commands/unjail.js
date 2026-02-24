const penaltyScheduler = require('../penaltyScheduler');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, settings, cache } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  if (!target.roles) {
    return sendTemplate('userNotFound', { target: targetMention }, { iconUser: message.client.user });
  }

  const check = await verifyPermission('jail', target);
  if (!check.success) return;

  const jailRole = settings.jail_penalty_role;
  if (!jailRole) {
    return sendTemplate('roleNotConfigured', {}, { iconUser: message.client.user });
  }

  if (!target.roles.cache.has(jailRole)) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: target.user });
  }

  const reason = cleanArgs.join(' ') || 'manuel';

  try {
    await penaltyScheduler.restoreJailRoles(message.client, {
      guildId: message.guild.id,
      userId: target.id,
      jailRoleId: jailRole,
    });
    await penaltyScheduler.cancelPenalty(message.guild.id, target.id, 'jail');
    cache.incrementLimit(check.key);

    await sendTemplate('success', {
      target: targetMention,
      reason,
    }, {
      iconUser: target.user,
    });
  } catch {
    await sendTemplate('systemError', { target: targetMention }, { iconUser: message.client.user });
  }
}

module.exports = { run };

