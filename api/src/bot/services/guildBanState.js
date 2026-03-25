'use strict';

const { isTransientError } = require('../../utils/retry');
const { retryModerationVerification } = require('./moderationVerification');

const UNKNOWN_GUILD_BAN_ERROR_CODE = 10026;
const GUILD_BAN_VERIFY_RETRY_DELAYS_MS = Object.freeze([0, 150, 350]);
const guildBanMutationLocks = new Map();

function getDiscordErrorCode(err) {
  return Number(err?.code || err?.rawError?.code || 0);
}

function evictGuildBanCache(guild, userId) {
  const resolvedUserId = String(userId || '').trim();
  if (!resolvedUserId) return;
  guild?.bans?.cache?.delete?.(resolvedUserId);
}

async function acquireGuildBanMutationLock(guildId, userId) {
  const resolvedGuildId = String(guildId || '').trim();
  const resolvedUserId = String(userId || '').trim();
  if (!resolvedGuildId || !resolvedUserId) return () => {};

  const key = `${resolvedGuildId}:${resolvedUserId}`;
  const previous = guildBanMutationLocks.get(key) || Promise.resolve();
  let releaseResolver = null;
  const current = new Promise((resolve) => {
    releaseResolver = resolve;
  });

  const queued = previous
    .catch(() => {})
    .then(() => current);
  guildBanMutationLocks.set(key, queued);

  await previous.catch(() => {});

  return () => {
    if (guildBanMutationLocks.get(key) === queued) {
      guildBanMutationLocks.delete(key);
    }
    releaseResolver?.();
  };
}

function refreshGuildBanCache(guild, ban) {
  const resolvedUserId = String(ban?.user?.id || '').trim();
  if (!resolvedUserId) return;
  guild?.bans?.cache?.set?.(resolvedUserId, ban);
}

async function fetchAuthoritativeGuildBan(guild, userId) {
  const resolvedUserId = String(userId || '').trim();
  if (!resolvedUserId) return null;

  try {
    const ban = await guild.bans.fetch({
      user: resolvedUserId,
      force: true,
      cache: false,
    });

    if (ban) refreshGuildBanCache(guild, ban);
    return ban || null;
  } catch (err) {
    if (getDiscordErrorCode(err) === UNKNOWN_GUILD_BAN_ERROR_CODE) {
      evictGuildBanCache(guild, resolvedUserId);
      return null;
    }
    throw err;
  }
}

function createGuildBanStateError(code, userId, ban = null) {
  const err = new Error(code.toLowerCase());
  err.code = code;
  err.userId = String(userId || '').trim() || null;
  if (ban) err.ban = ban;
  return err;
}

async function ensureGuildBanPresent(guild, userId) {
  const result = await retryModerationVerification({
    retryDelaysMs: GUILD_BAN_VERIFY_RETRY_DELAYS_MS,
    shouldRetryError: (err) => isTransientError(err),
    runCheck: async () => {
      const ban = await fetchAuthoritativeGuildBan(guild, userId);
      return {
        ok: Boolean(ban),
        ban: ban || null,
      };
    },
  });

  if (result?.ok) return result.ban;
  throw createGuildBanStateError('GUILD_BAN_NOT_PRESENT', userId);
}

async function ensureGuildBanAbsent(guild, userId) {
  const result = await retryModerationVerification({
    retryDelaysMs: GUILD_BAN_VERIFY_RETRY_DELAYS_MS,
    shouldRetryError: (err) => isTransientError(err),
    runCheck: async () => {
      const ban = await fetchAuthoritativeGuildBan(guild, userId);
      return {
        ok: !ban,
        ban: ban || null,
      };
    },
  });

  if (result?.ok) return null;
  throw createGuildBanStateError('GUILD_BAN_STILL_PRESENT', userId, result?.ban || null);
}

module.exports = {
  UNKNOWN_GUILD_BAN_ERROR_CODE,
  GUILD_BAN_VERIFY_RETRY_DELAYS_MS,
  fetchAuthoritativeGuildBan,
  ensureGuildBanPresent,
  ensureGuildBanAbsent,
  evictGuildBanCache,
  acquireGuildBanMutationLock,
};
