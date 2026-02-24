const penaltyScheduler = require('../penaltyScheduler');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, cache } = ctx;

  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }
  if (!target.roles) {
    return sendTemplate('userNotFound', { target: targetMention }, { iconUser: message.author });
  }

  const check = await verifyPermission('vcmute', target);
  if (!check.success) return;

  if (!target.voice || !target.voice.channel) {
    return sendTemplate('notInVoice', { target: targetMention }, { iconUser: target.user });
  }

  if (!target.voice.serverMute) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: target.user });
  }

  const reason = cleanArgs.join(' ') || 'manuel';

  try {
    await target.voice.setMute(false, reason);
    await penaltyScheduler.cancelPenalty(message.guild.id, target.id, 'vcmute');
    cache.incrementLimit(check.key);

    await sendTemplate('success', {
      target: targetMention,
      reason,
    }, {
      iconUser: target.user,
    });
  } catch {
    return sendTemplate('systemError', { target: targetMention }, { iconUser: target.user });
  }
}

module.exports = { run };

