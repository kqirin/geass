'use strict';

const logger = require('../../logger');

const logDmFailure =
  typeof logger.logStructuredError === 'function'
    ? logger.logStructuredError
    : (context, err, extra = {}) => {
        if (typeof logger.logError === 'function') {
          logger.logError(context, err, extra);
        }
      };

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
const BENIGN_DM_ERROR_CODES = new Set([50007, 50278]);
const BENIGN_DM_ERROR_PATTERNS = [
  /cannot\s+send\s+messages?\s+to\s+(?:this|that)\s+user/i,
  /dm(?:s)?\s+(?:are|is)\s+closed/i,
];
const APPEAL_SUFFIX = ' İtirazınız varsa ticket açabilirsiniz. ୭ ˚. !!';
const GUILD_NAME_SPLIT_PATTERNS = [
  /\s*︱\s*/u,
  /\s*\|\s*/u,
  /\s*•\s*/u,
  /\s*॥\s*/u,
  /\s*::\s*/u,
  /\s+-\s+/u,
  /\s+\/\s+/u,
];

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (text === '[object Object]') return '';
  if (/^(?:undefined|null)$/i.test(text)) return '';
  return text;
}

function getDiscordErrorCode(err) {
  const code = Number(err?.code || err?.rawError?.code || err?.data?.code || 0);
  return Number.isFinite(code) ? code : 0;
}

function classifyModerationDmFailure(err) {
  const code = getDiscordErrorCode(err);
  const message = normalizeText(err?.message || err);
  const benignByCode = BENIGN_DM_ERROR_CODES.has(code);
  const benignByMessage = BENIGN_DM_ERROR_PATTERNS.some((pattern) => pattern.test(message));

  if (benignByCode || benignByMessage) {
    return {
      benign: true,
      reason: 'dm_closed',
      code: code || null,
      message,
    };
  }

  return {
    benign: false,
    reason: 'send_failed',
    code: code || null,
    message,
  };
}

function pickText(candidates, fallback = '') {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return fallback;
}

function normalizeInlineSegment(value, fallback = '') {
  const text = pickText([value], fallback).replace(/\s+/g, ' ').replace(/`+/g, "'");
  return text || fallback;
}

function normalizeActionType(actionType) {
  const raw = normalizeText(actionType).toLowerCase();
  if (!raw) return '';
  if (raw === 'timeout') return 'mute';
  if (raw === 'untimeout') return 'unmute';
  return raw;
}

function normalizeReasonText(reason) {
  const text = normalizeInlineSegment(reason);
  if (!text) return 'Belirtilmedi';

  const normalized = text.toLowerCase();
  if (['yok', 'none', 'n/a', 'null', 'undefined'].includes(normalized)) {
    return 'Belirtilmedi';
  }

  return text;
}

function normalizeDurationText(durationText) {
  const text = normalizeInlineSegment(durationText);
  if (!text) return '';

  const normalized = text.toLowerCase();
  if (['suresiz', 'suresiz.', 'süresiz', 'süresiz.', 'permanent'].includes(normalized)) {
    return '';
  }

  return text;
}

function buildDurationSegment(durationText) {
  const normalizedDuration = normalizeDurationText(durationText);
  return normalizedDuration ? ` ${normalizedDuration} süreyle` : '';
}

function formatExecutorName(executorName) {
  return `\`${normalizeInlineSegment(executorName, 'Yetkili')}\``;
}

function cleanGuildName(guildName) {
  const normalizedGuildName = normalizeInlineSegment(guildName, '');
  if (!normalizedGuildName) return '';

  for (const pattern of GUILD_NAME_SPLIT_PATTERNS) {
    const parts = normalizedGuildName
      .split(pattern)
      .map((part) => normalizeInlineSegment(part, ''))
      .filter(Boolean);

    if (parts.length > 1) {
      return parts[0] || normalizedGuildName;
    }
  }

  return normalizedGuildName;
}

function resolveGuildName(message) {
  const rawGuildName = normalizeInlineSegment(message?.guild?.name, 'Sunucu');
  const cleanedGuildName = cleanGuildName(rawGuildName);
  return cleanedGuildName || rawGuildName;
}

function buildModerationDmText({
  actionType,
  guildName,
  executorName,
  reason,
  durationText,
} = {}) {
  const normalizedAction = normalizeActionType(actionType);
  const safeGuildName = normalizeInlineSegment(guildName, 'Sunucu');
  const safeExecutorName = formatExecutorName(executorName);
  const reasonText = normalizeReasonText(reason);
  const durationSegment = buildDurationSegment(durationText);

  if (normalizedAction === 'warn') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından ${reasonText} sebebiyle uyarıldın.${APPEAL_SUFFIX}`;
  }

  if (normalizedAction === 'mute') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından ${reasonText} sebebiyle${durationSegment} susturuldun.${APPEAL_SUFFIX}`;
  }

  if (normalizedAction === 'unmute') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından susturman kaldırıldı. ⋆˚࿔`;
  }

  if (normalizedAction === 'ban') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından ${reasonText} sebebiyle yasaklandın.${APPEAL_SUFFIX}`;
  }

  if (normalizedAction === 'unban') {
    return `${safeGuildName}'taki yasağın ${safeExecutorName} tarafından kaldırıldı. ⋆˚࿔`;
  }

  if (normalizedAction === 'kick') {
    return `${safeGuildName}'tan ${safeExecutorName} tarafından ${reasonText} sebebiyle çıkarıldın.${APPEAL_SUFFIX}`;
  }

  if (normalizedAction === 'jail') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından ${reasonText} sebebiyle Underworld'e gönderildin.${APPEAL_SUFFIX}`;
  }

  if (normalizedAction === 'unjail') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından Underworld'den çıkarıldın. ⋆˚࿔`;
  }

  if (normalizedAction === 'warn_remove' || normalizedAction === 'unwarn') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından uyarı kaydın kaldırıldı. ⋆˚࿔`;
  }

  if (normalizedAction === 'vcmute') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından ${reasonText} sebebiyle sesli kanallarda susturuldun.${APPEAL_SUFFIX}`;
  }

  if (normalizedAction === 'vcunmute') {
    return `${safeGuildName}'ta ${safeExecutorName} tarafından sesli kanal susturman kaldırıldı. ⋆˚࿔`;
  }

  return '';
}

async function resolveExecutorName(message) {
  const directName = pickText([
    message?.member?.displayName,
    message?.author?.globalName,
    message?.author?.username,
    message?.author?.tag,
  ]);
  if (directName) return directName;

  const actorId = normalizeText(message?.author?.id);
  if (!DISCORD_SNOWFLAKE_REGEX.test(actorId)) {
    return 'Yetkili';
  }

  try {
    const member = await message?.guild?.members?.fetch?.(actorId);
    return pickText([
      member?.displayName,
      member?.user?.globalName,
      member?.user?.username,
      member?.user?.tag,
    ], 'Yetkili');
  } catch {
    return 'Yetkili';
  }
}

function resolveTargetUserId(targetUserOrMember, targetId = null) {
  const userId = pickText([
    targetUserOrMember?.user?.id,
    targetUserOrMember?.id,
    targetId,
    typeof targetUserOrMember === 'string' || typeof targetUserOrMember === 'number'
      ? targetUserOrMember
      : '',
  ]);

  return DISCORD_SNOWFLAKE_REGEX.test(userId) ? userId : null;
}

async function resolveTargetUser(message, targetUserOrMember, targetId = null) {
  if (targetUserOrMember?.user?.send && targetUserOrMember?.user?.id) {
    return targetUserOrMember.user;
  }

  if (targetUserOrMember?.send && targetUserOrMember?.id) {
    return targetUserOrMember;
  }

  const userId = resolveTargetUserId(targetUserOrMember, targetId);
  if (!userId) return null;

  const cachedUser = message?.client?.users?.cache?.get?.(userId);
  if (cachedUser?.send) return cachedUser;

  if (typeof message?.client?.users?.fetch !== 'function') return null;
  return message.client.users.fetch(userId).catch(() => null);
}

async function sendModerationDmNotification({
  message,
  actionType,
  targetUserOrMember = null,
  targetId = null,
  reason = null,
  durationText = null,
} = {}) {
  const normalizedAction = normalizeActionType(actionType);
  if (!normalizedAction || !message?.guild) {
    return { sent: false, skipped: 'invalid_context' };
  }

  const targetUser = await resolveTargetUser(message, targetUserOrMember, targetId);
  if (!targetUser?.send) {
    return { sent: false, skipped: 'target_unavailable' };
  }

  const content = buildModerationDmText({
    actionType: normalizedAction,
    guildName: resolveGuildName(message),
    executorName: await resolveExecutorName(message),
    reason,
    durationText,
  });

  if (!content) {
    return { sent: false, skipped: 'template_not_found' };
  }

  try {
    await targetUser.send({
      content,
      allowedMentions: { parse: [] },
    });
    return { sent: true };
  } catch (err) {
    const classification = classifyModerationDmFailure(err);
    if (!classification.benign) {
      logDmFailure(
        'moderation_dm_send_failed',
        err,
        {
          guildId: message?.guild?.id || null,
          actorId: message?.author?.id || null,
          targetId: targetUser?.id || resolveTargetUserId(targetUserOrMember, targetId),
          actionType: normalizedAction,
          dmFailureReason: classification.reason,
        },
        'WARN'
      );
    }

    return {
      sent: false,
      skipped: classification.reason,
      benign: classification.benign,
    };
  }
}

async function notifyModerationActionIfSuccessful(executionResult, options = {}) {
  if (!executionResult?.ok) {
    return { sent: false, skipped: 'action_not_successful' };
  }

  return sendModerationDmNotification(options);
}

module.exports = {
  sendModerationDmNotification,
  notifyModerationActionIfSuccessful,
  __internal: {
    buildModerationDmText,
    classifyModerationDmFailure,
    formatExecutorName,
    cleanGuildName,
    getDiscordErrorCode,
    normalizeActionType,
    normalizeDurationText,
    normalizeReasonText,
    resolveExecutorName,
    resolveGuildName,
    resolveTargetUserId,
  },
};
