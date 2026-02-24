const { logAction } = require('../moderation.logs');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, cache } = ctx;
  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('ban', target.roles ? target : null);
  if (!check.success) return;

  const already = await message.guild.bans.fetch(target.id).catch(() => null);
  if (already) {
    return sendTemplate('alreadyApplied', { target: targetMention }, { iconUser: target.user || target });
  }

  const reason = cleanArgs.join(' ') || 'Yok';

  try {
    await message.guild.members.ban(target.id, { reason });

    const caseId = await logAction(message.guild.id, target.id, message.author.id, 'ban', reason, 'Suresiz');
    cache.incrementLimit(check.key);

    await sendTemplate('success', {
      target: targetMention,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }, {
      iconUser: target.user || target,
    });
  } catch {
    await sendTemplate('systemError', { target: targetMention }, { iconUser: target.user || target });
  }
}

module.exports = { run };

