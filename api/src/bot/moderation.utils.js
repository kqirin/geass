const {
  evaluateNativeActorHierarchy,
} = require('../application/security/nativeHierarchy');

function actionNameFor(cmd) {
  return actionNames[cmd] || cmd.toUpperCase();
}

const actionNames = {
  warn: 'UYARI',
  mute: 'SUSTURMA',
  unmute: 'SUSTURMA KALDIRILDI',
  kick: 'ATMA',
  jail: 'UNDERWORLD',
  unjail: 'UNDERWORLD\'DEN ÇIKARILDI',
  ban: 'BAN',
  unban: 'BAN KALDIRILDI',
  vcmute: 'SES SUSTURMA',
  vcunmute: 'SES SUSTURMA KALDIRILDI',
};

const REPLY_REFERENCE_MISS_BACKOFF_MS = 15 * 1000;
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
const DISCORD_USER_MENTION_REGEX = /^<@!?(\d{17,20})>$/;
const replyReferenceMissUntil = new Map();
let replyReferenceMissSweepTick = 0;

function buildReplyReferenceKey(message) {
  const guildId = String(message?.guild?.id || 'noguild');
  const channelId = String(message?.reference?.channelId || message?.channel?.id || 'nochannel');
  const messageId = String(message?.reference?.messageId || 'nomessage');
  return `${guildId}:${channelId}:${messageId}`;
}

function canAttemptReplyReferenceFetch(key, now = Date.now()) {
  replyReferenceMissSweepTick += 1;
  if (replyReferenceMissSweepTick % 200 === 0) {
    for (const [entryKey, blockedUntil] of replyReferenceMissUntil.entries()) {
      if (blockedUntil <= now) replyReferenceMissUntil.delete(entryKey);
    }
  }

  const blockedUntil = replyReferenceMissUntil.get(key) || 0;
  return blockedUntil <= now;
}

function markReplyReferenceMiss(key, now = Date.now()) {
  replyReferenceMissUntil.set(key, now + REPLY_REFERENCE_MISS_BACKOFF_MS);
}

function clearReplyReferenceMiss(key) {
  replyReferenceMissUntil.delete(key);
}

async function fetchReferencedMessage(message) {
  const messageId = String(message?.reference?.messageId || '').trim();
  if (!messageId) return null;

  const key = buildReplyReferenceKey(message);
  if (!canAttemptReplyReferenceFetch(key)) return null;

  let repliedMessage = await message.fetchReference().catch(() => null);
  if (!repliedMessage && message?.channel?.messages?.fetch) {
    repliedMessage = await message.channel.messages.fetch(messageId).catch(() => null);
  }

  if (!repliedMessage) {
    markReplyReferenceMiss(key);
    return null;
  }

  clearReplyReferenceMiss(key);
  return repliedMessage;
}

function normalizeTargetResolveOptions(options = {}) {
  return {
    allowNumericId: options.allowNumericId !== false,
    allowUserMention: options.allowUserMention !== false,
    allowReplyTarget: options.allowReplyTarget !== false,
    allowMemberSearch: options.allowMemberSearch !== false,
    allowUnresolvedTarget: options.allowUnresolvedTarget === true,
  };
}

function parseRawTargetToken(raw, options = {}) {
  const normalizedOptions = normalizeTargetResolveOptions(options);
  const token = String(raw || '').trim();
  if (!token) {
    return { token: '', kind: 'empty', targetId: null, recognized: false };
  }

  if (normalizedOptions.allowNumericId && DISCORD_SNOWFLAKE_REGEX.test(token)) {
    return { token, kind: 'id', targetId: token, recognized: true };
  }

  if (normalizedOptions.allowUserMention) {
    const mentionMatch = token.match(DISCORD_USER_MENTION_REGEX);
    if (mentionMatch) {
      return { token, kind: 'mention', targetId: mentionMatch[1], recognized: true };
    }
  }

  return { token, kind: 'invalid', targetId: null, recognized: false };
}

function buildUnresolvedTarget(targetId) {
  if (!targetId) return null;
  return { id: targetId };
}

function evaluateModerationHierarchy({
  actorMember,
  targetMember,
  botMember = null,
  hardProtectedRoleIds = new Set(),
  hardProtectedUserIds = new Set(),
  guildOwnerId = null,
  botUserId = null,
} = {}) {
  try {
    const result = evaluateNativeActorHierarchy({
      actorMember,
      targetMember,
      botMember,
      hardProtectedRoleIds,
      hardProtectedUserIds,
      guildOwnerId,
      botUserId,
    });

    return {
      allowed: result.allowed,
      reason: result.reasonCode,
      actorHighestRoleId: result.actorHighestRoleId,
      actorHighestRolePosition: result.actorHighestRolePosition,
      targetHighestRoleId: result.targetHighestRoleId,
      targetHighestRolePosition: result.targetHighestRolePosition,
      botHighestRoleId: result.botHighestRoleId,
      botHighestRolePosition: result.botHighestRolePosition,
      isActorOwner: result.isActorOwner,
      isTargetOwner: result.isTargetOwner,
      actorMemberResolved: result.actorMemberResolved,
      targetMemberResolved: result.targetMemberResolved,
    };
  } catch {
    return { allowed: false, reason: 'invalid_target_state', detail: 'hierarchy_eval_failed' };
  }
}

async function resolveMemberFromReply(message) {
  const guild = message.guild;
  if (!guild) return null;

  const repliedUserId = message.mentions?.repliedUser?.id || null;
  if (repliedUserId) {
    const member = await guild.members.fetch(repliedUserId).catch(() => null);
    if (member) return member;
  }

  if (!message.reference?.messageId) return null;
  const repliedMessage = await fetchReferencedMessage(message);
  const repliedAuthorId = repliedMessage?.author?.id || null;
  if (!repliedAuthorId) return null;
  return guild.members.fetch(repliedAuthorId).catch(() => null);
}

async function resolveMemberFromRaw(guild, raw, options = {}) {
  const normalizedOptions = normalizeTargetResolveOptions(options);
  const parsedToken = parseRawTargetToken(raw, normalizedOptions);
  if (parsedToken.targetId) {
    const byId = await guild.members.fetch(parsedToken.targetId).catch(() => null);
    if (byId) {
      return {
        member: byId,
        rawId: parsedToken.targetId,
        recognized: true,
      };
    }

    return {
      member: null,
      rawId: parsedToken.targetId,
      recognized: true,
    };
  }

  const query = String(raw || '').trim();
  if (!query || !normalizedOptions.allowMemberSearch) {
    return { member: null, rawId: null, recognized: false };
  }

  try {
    const found = await guild.members.search({ query, limit: 5 }).catch(() => null);
    const members = found ? [...found.values()] : [];
    if (members.length === 1) {
      const bySearch = members[0];
      return { member: bySearch, rawId: bySearch.id, recognized: true };
    }

    if (members.length > 1) {
      const normalizedQuery = query.toLowerCase();
      const exactMatches = members.filter((member) => {
        const candidates = [
          member?.user?.username,
          member?.user?.globalName,
          member?.displayName,
        ];
        return candidates.some((value) => String(value || '').trim().toLowerCase() === normalizedQuery);
      });

      if (exactMatches.length === 1) {
        const bySearch = exactMatches[0];
        return { member: bySearch, rawId: bySearch.id, recognized: true, ambiguous: false };
      }

      return {
        member: null,
        rawId: null,
        recognized: false,
        ambiguous: true,
        matchCount: members.length,
      };
    }
  } catch {}

  return { member: null, rawId: null, recognized: false, ambiguous: false };
}

async function resolveTarget(_client, message, args, options = {}) {
  const guild = message.guild;
  const normalizedOptions = normalizeTargetResolveOptions(options);
  const replyMember = normalizedOptions.allowReplyTarget
    ? await resolveMemberFromReply(message)
    : null;
  const raw = args[0];

  // Reply command with no target token: use replied message author as target.
  if (!raw) {
    if (replyMember) {
      return {
        target: replyMember,
        targetId: replyMember.id,
        cleanArgs: args,
        displayUsername: replyMember.user.username,
        ambiguous: false,
        matchCount: 0,
      };
    }
    return {
      target: null,
      targetId: null,
      cleanArgs: args,
      displayUsername: message.author.username,
      ambiguous: false,
      matchCount: 0,
    };
  }

  const {
    member: memberFromRaw,
    rawId,
    recognized,
    ambiguous = false,
    matchCount = 0,
  } = await resolveMemberFromRaw(guild, raw, normalizedOptions);
  if (memberFromRaw) {
    args.shift();
    return {
      target: memberFromRaw,
      targetId: memberFromRaw.id,
      cleanArgs: args,
      displayUsername: memberFromRaw.user.username,
      ambiguous: false,
      matchCount: 0,
    };
  }

  if (recognized && rawId) {
    args.shift();
    return {
      target: normalizedOptions.allowUnresolvedTarget ? buildUnresolvedTarget(rawId) : null,
      targetId: rawId,
      cleanArgs: args,
      displayUsername: rawId,
      ambiguous: false,
      matchCount: 0,
    };
  }

  // If first token is not a user and message is a reply, treat token as reason/duration.
  if (replyMember) {
    return {
      target: replyMember,
      targetId: replyMember.id,
      cleanArgs: args,
      displayUsername: replyMember.user.username,
      ambiguous: false,
      matchCount: 0,
    };
  }

  return {
    target: null,
    targetId: null,
    cleanArgs: args,
    displayUsername: message.author.username,
    ambiguous,
    matchCount,
  };
}

function parseTime(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const m = s.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  const u = m[2];
  if (!Number.isFinite(n) || n <= 0) return null;

  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60 * 1000;
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  return null;
}

function formatTime(str) {
  return String(str);
}

module.exports = {
  actionNames,
  actionNameFor,
  evaluateModerationHierarchy,
  resolveTarget,
  parseTime,
  formatTime,
};

