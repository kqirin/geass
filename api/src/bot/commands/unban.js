async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, cache } = ctx;

  if (!target?.id) {
    return sendTemplate('invalidUsage', {}, { iconUser: message.client.user });
  }

  const check = await verifyPermission('ban', null);
  if (!check.success) return;

  const banned = await message.guild.bans.fetch(target.id).catch(() => null);
  if (!banned) {
    return sendTemplate('notApplied', { target: targetMention }, { iconUser: target.user || target });
  }

  const reason = cleanArgs.join(' ') || 'af';

  try {
    await message.guild.bans.remove(target.id);
    cache.incrementLimit(check.key);

    await sendTemplate('success', {
      target: targetMention,
      reason,
    }, {
      iconUser: target.user || target,
    });
  } catch {
    await sendTemplate('systemError', { target: targetMention }, { iconUser: target.user || target });
  }
}

module.exports = { run };

