const { logAction } = require('../moderation.logs');
const { parseTime, formatTime } = require('../moderation.utils');
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

  if (target.voice.serverMute) {
    return sendTemplate('alreadyApplied', { target: targetMention }, { iconUser: target.user });
  }

  const durationMs = parseTime(cleanArgs[0]);
  const durationText = durationMs ? formatTime(cleanArgs[0]) : 'Suresiz';
  let reason = durationMs ? cleanArgs.slice(1).join(' ') : cleanArgs.join(' ');
  reason = reason || 'Yok';

  try {
    await target.voice.setMute(true, reason);

    const caseId = await logAction(message.guild.id, target.id, message.author.id, 'vcmute', reason, durationText);
    cache.incrementLimit(check.key);

    if (durationMs) {
      await penaltyScheduler.schedulePenalty(message.client, {
        guildId: message.guild.id,
        userId: target.id,
        actionType: 'vcmute',
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
    return sendTemplate('systemError', { target: targetMention }, { iconUser: target.user });
  }
}

module.exports = { run };

