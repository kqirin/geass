const { logAction } = require('../moderation.logs');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, cache } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('warn', target.roles ? target : null);
  if (!check.success) return;

  const reason = cleanArgs.join(' ') || 'Yok';
  const caseId = await logAction(message.guild.id, target.id, message.author.id, 'warn', reason, 'Yok');
  cache.incrementLimit(check.key);

  await sendTemplate('success', {
    target: targetMention,
    reason,
    caseId: caseId ? `#${caseId}` : '',
  }, {
    iconUser: target.user || target,
  });
}

module.exports = { run };

