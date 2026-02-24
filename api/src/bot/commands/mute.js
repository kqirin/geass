const { logAction } = require('../moderation.logs');
const { parseTime, formatTime } = require('../moderation.utils');
const penaltyScheduler = require('../penaltyScheduler');

async function run(ctx) {
  const { message, target, cleanArgs, targetMention, sendTemplate, verifyPermission, cache, settings } = ctx;
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

  if (target.roles.cache.has(muteRole)) {
    return sendTemplate('alreadyApplied', { target: targetMention }, { iconUser: target.user });
  }

  const durationMs = parseTime(cleanArgs[0]);
  const durationText = durationMs ? formatTime(cleanArgs[0]) : 'Suresiz';
  let reason = durationMs ? cleanArgs.slice(1).join(' ') : cleanArgs.join(' ');
  reason = reason || 'Yok';

  try {
    await target.roles.add(muteRole);

    const caseId = await logAction(message.guild.id, target.id, message.author.id, 'mute', reason, durationText);
    cache.incrementLimit(check.key);

    if (durationMs) {
      await penaltyScheduler.schedulePenalty(message.client, {
        guildId: message.guild.id,
        userId: target.id,
        actionType: 'mute',
        roleId: muteRole,
        revokeAt: Date.now() + durationMs,
        reason,
      });
    }

    await sendTemplate('success', {
      target: targetMention,
      time: durationText,
      reason,
      caseId: caseId ? `#${caseId}` : '',
    }, {
      iconUser: target.user,
    });
  } catch {
    return sendTemplate('systemError', { target: targetMention }, { iconUser: message.client.user });
  }
}

module.exports = { run };

