const cache = require('../../utils/cache');
const { checkHierarchy } = require('../moderation.utils');

function createPermissionService({ config }) {
  const ABUSE_THRESHOLD = config.moderation.abuseThreshold;
  const ONE_HOUR = 60 * 60 * 1000;
  const UNAUTH_REPLY_COOLDOWN_MS = config.moderation.unauthReplyCooldownMs;
  const UNAUTH_WINDOW_MS = config.moderation.unauthWindowMs;
  const UNAUTH_MAX_ATTEMPTS = config.moderation.unauthMaxAttempts;
  const UNAUTH_BLOCK_MS = config.moderation.unauthBlockMs;

  const limitWarnCooldown = new Map();
  const abuseCounter = new Map();
  const unauthorizedSpam = new Map();

  let pruneTick = 0;

  function maybePruneModerationCaches() {
    pruneTick += 1;
    if (pruneTick % 200 !== 0) return;

    const now = Date.now();
    const warnTtl = ONE_HOUR * 2;

    for (const [key, ts] of limitWarnCooldown) {
      if (now - ts > warnTtl) limitWarnCooldown.delete(key);
    }

    for (const [key, entry] of abuseCounter) {
      if (!entry || now - entry.firstTs > ONE_HOUR) abuseCounter.delete(key);
    }

    for (const [key, entry] of unauthorizedSpam) {
      if (!entry) {
        unauthorizedSpam.delete(key);
        continue;
      }

      const windowExpired = now - entry.windowStart > UNAUTH_WINDOW_MS * 3;
      const replyExpired = now - entry.lastReplyTs > UNAUTH_WINDOW_MS * 3;
      const blockExpired = !entry.blockedUntil || entry.blockedUntil <= now;

      if (windowExpired && replyExpired && blockExpired) unauthorizedSpam.delete(key);
    }
  }

  function registerUnauthorizedAttempt(guildId, userId, cmdType) {
    const key = `${guildId}:${userId}:${cmdType}`;
    const now = Date.now();
    const cur = unauthorizedSpam.get(key) || {
      windowStart: now,
      count: 0,
      lastReplyTs: 0,
      blockedUntil: 0,
    };

    if (cur.blockedUntil > now) {
      unauthorizedSpam.set(key, cur);
      return { shouldReply: false };
    }

    if (now - cur.windowStart > UNAUTH_WINDOW_MS) {
      cur.windowStart = now;
      cur.count = 0;
    }

    cur.count += 1;
    if (cur.count >= UNAUTH_MAX_ATTEMPTS) {
      cur.blockedUntil = now + UNAUTH_BLOCK_MS;
      cur.count = 0;
      cur.windowStart = now;
    }

    const shouldReply = now - cur.lastReplyTs >= UNAUTH_REPLY_COOLDOWN_MS;
    if (shouldReply) cur.lastReplyTs = now;

    unauthorizedSpam.set(key, cur);
    return { shouldReply };
  }

  async function verifyPermission({ message, targetMember, settings, cmdType, sendTemplate, contextBase = {} }) {
    const replyTemplate = async (templateKey, context, iconUser) => {
      return sendTemplate(templateKey, { ...contextBase, ...(context || {}) }, { iconUser });
    };

    if (!settings[`${cmdType}_enabled`]) {
      await replyTemplate('permissionDenied', {}, message.author);
      return { success: false };
    }

    const allowedRole = settings[`${cmdType}_role`];
    if (!allowedRole) {
      await replyTemplate('roleNotConfigured', {}, message.author);
      return { success: false };
    }

    if (!message.member.roles.cache.has(allowedRole)) {
      await replyTemplate('roleInsufficient', {}, message.author);
      return { success: false };
    }

    const safeListRaw = settings[`${cmdType}_safe_list`] || '';
    const safeList = safeListRaw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .join(',');

    const limitCheck = cache.checkLimit(
      message.guild.id,
      message.author.id,
      cmdType,
      settings[`${cmdType}_limit`],
      safeList
    );

    if (!limitCheck.allowed) {
      const abuseKey = `${message.guild.id}:${message.author.id}:${cmdType}`;
      const now = Date.now();

      const entry = abuseCounter.get(abuseKey);
      if (!entry || now - entry.firstTs > ONE_HOUR) {
        abuseCounter.set(abuseKey, { count: 1, firstTs: now });
      } else {
        entry.count += 1;
        abuseCounter.set(abuseKey, entry);
      }

      const current = abuseCounter.get(abuseKey);
      if (current && current.count >= ABUSE_THRESHOLD) {
        try {
          await message.member.roles.remove(allowedRole);
        } catch {}
        abuseCounter.delete(abuseKey);
        await replyTemplate('abuseLock', { limit: settings[`${cmdType}_limit`] }, message.author);
        return { success: false };
      }

      const cdKey = `${message.guild.id}:${message.author.id}:${cmdType}:limitwarn`;
      const last = limitWarnCooldown.get(cdKey) || 0;
      if (now - last > 5000) {
        limitWarnCooldown.set(cdKey, now);
        await replyTemplate('limitReached', { limit: settings[`${cmdType}_limit`] }, message.author);
      }

      return { success: false };
    }

    if (targetMember && targetMember.roles) {
      const allowed = await checkHierarchy(message.member, targetMember);
      if (!allowed) {
        await replyTemplate('targetRoleHigher', {}, targetMember.user || message.client.user);
        return { success: false };
      }
    }

    return { success: true, key: limitCheck.key };
  }

  return {
    maybePruneModerationCaches,
    registerUnauthorizedAttempt,
    verifyPermission,
  };
}

module.exports = { createPermissionService };

