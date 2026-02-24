const { logAction } = require('../moderation.logs');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, cache } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  if (!target.roles) {
    return sendTemplate('userNotFound', { target: targetMention }, { iconUser: message.client.user });
  }

  const check = await verifyPermission('kick', target);
  if (!check.success) return;

  const reason = cleanArgs.join(' ') || 'Yok';

  if (!target.kickable) {
    return sendTemplate('operationNotAllowed', { target: targetMention }, { iconUser: target.user });
  }

  try {
    await target.kick(reason);

    const caseId = await logAction(message.guild.id, target.id, message.author.id, 'kick', reason, 'Yok');
    cache.incrementLimit(check.key);

    await sendTemplate('success', {
      target: targetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }, {
      iconUser: target.user,
    });
  } catch {
    await sendTemplate('systemError', { target: targetMention }, { iconUser: target.user });
  }
}

module.exports = { run };

