async function run(ctx) {
  const { message, targetId, cleanArgs, sendTemplate, verifyPermission, cache } = ctx;

  const check = await verifyPermission('clear', null);
  if (!check.success) return;

  const amount = parseInt(cleanArgs[0], 10) || parseInt(targetId, 10);
  if (isNaN(amount) || amount < 1 || amount > 100) {
    return sendTemplate('invalidUsage', { amount: cleanArgs[0] || targetId || '' }, { iconUser: message.author });
  }

  try {
    await message.channel.bulkDelete(amount, true);
    cache.incrementLimit(check.key);

    await sendTemplate('success', { amount }, { iconUser: message.author });
  } catch {
    await sendTemplate('systemError', {}, { iconUser: message.author });
  }
}

module.exports = { run };
