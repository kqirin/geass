const penaltyScheduler = require('../penaltyScheduler');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, settings, cache } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  if (!target.roles) {
    return sendTemplate('userNotFound', { target: targetMention }, { iconUser: message.client.user });
  }

  const check = await verifyPermission('mute', target);
  if (!check.success) return;

  const muteRole = settings.mute_penalty_role;
  if (!muteRole) {
    return sendTemplate('roleNotConfigured', {}, { iconUser: message.client.user });
  }

  if (!target.roles.cache.has(muteRole)) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: target.user });
  }

  const reason = cleanArgs.join(' ') || 'manuel';

  try {
    await target.roles.remove(muteRole);
    await penaltyScheduler.cancelPenalty(message.guild.id, target.id, 'mute');
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

