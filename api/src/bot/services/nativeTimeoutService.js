'use strict';

const { parseTime, formatTime } = require('../moderation.utils');
const {
  retryModerationVerification,
} = require('./moderationVerification');

const NATIVE_TIMEOUT_DAY_MS = 24 * 60 * 60 * 1000;
const NATIVE_TIMEOUT_LIMIT_DAYS = 28;
const MAX_NATIVE_TIMEOUT_MS = NATIVE_TIMEOUT_LIMIT_DAYS * NATIVE_TIMEOUT_DAY_MS;
const SAFE_TIMEOUT_BUFFER_MS = 5_000;
const SAFE_MAX_NATIVE_TIMEOUT_MS = MAX_NATIVE_TIMEOUT_MS - SAFE_TIMEOUT_BUFFER_MS;
const DEFAULT_NATIVE_TIMEOUT_MS = SAFE_MAX_NATIVE_TIMEOUT_MS;
const DEFAULT_NATIVE_TIMEOUT_TEXT = `${NATIVE_TIMEOUT_LIMIT_DAYS}d`;
const DURATION_LIKE_TOKEN_REGEX = /^\d/;
const TIMEOUT_VERIFY_SKEW_MS = 5_000;
const TIMEOUT_VERIFY_RETRY_DELAYS_MS = Object.freeze([0, 150, 350]);

function clampNativeTimeoutDurationMs(durationMs) {
  const normalizedDurationMs = Number(durationMs || 0);
  if (!Number.isFinite(normalizedDurationMs) || normalizedDurationMs <= 0) {
    return normalizedDurationMs;
  }

  return Math.min(normalizedDurationMs, SAFE_MAX_NATIVE_TIMEOUT_MS);
}

function parseRequiredTimeoutDuration(rawDuration) {
  const token = String(rawDuration || '').trim();
  if (!token) {
    return {
      ok: true,
      durationMs: DEFAULT_NATIVE_TIMEOUT_MS,
      durationText: DEFAULT_NATIVE_TIMEOUT_TEXT,
      usedDefault: true,
      consumedDurationToken: false,
    };
  }

  const durationMs = parseTime(token);
  if (!durationMs) {
    if (!DURATION_LIKE_TOKEN_REGEX.test(token)) {
      return {
        ok: true,
        durationMs: DEFAULT_NATIVE_TIMEOUT_MS,
        durationText: DEFAULT_NATIVE_TIMEOUT_TEXT,
        usedDefault: true,
        consumedDurationToken: false,
      };
    }

    return {
      ok: false,
      error: 'invalid_duration',
    };
  }

  if (durationMs > MAX_NATIVE_TIMEOUT_MS) {
    return {
      ok: false,
      error: 'duration_too_long',
      maxDurationText: DEFAULT_NATIVE_TIMEOUT_TEXT,
      maxDurationMs: MAX_NATIVE_TIMEOUT_MS,
    };
  }

  return {
    ok: true,
    durationMs: clampNativeTimeoutDurationMs(durationMs),
    durationText: formatTime(token),
    usedDefault: false,
    consumedDurationToken: true,
  };
}

function getCommunicationDisabledUntilTimestamp(member) {
  const rawValue =
    member?.communicationDisabledUntilTimestamp ??
    member?.communicationDisabledUntil?.getTime?.() ??
    member?.communicationDisabledUntil?.valueOf?.() ??
    null;
  const timestamp = Number(rawValue || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp;
}

function hasActiveCommunicationTimeout(member, now = Date.now()) {
  const timestamp = getCommunicationDisabledUntilTimestamp(member);
  return Number.isFinite(timestamp) && timestamp > now;
}

function verifyTimeoutApplied(member, expectedUntilMs, now = Date.now()) {
  const actualUntilMs = getCommunicationDisabledUntilTimestamp(member);
  if (!actualUntilMs || actualUntilMs <= now) {
    return {
      ok: false,
      reason: 'timeout_not_active',
      actualUntilMs,
    };
  }

  if (
    Number.isFinite(expectedUntilMs) &&
    Math.abs(actualUntilMs - Number(expectedUntilMs)) > TIMEOUT_VERIFY_SKEW_MS
  ) {
    return {
      ok: false,
      reason: 'timeout_mismatch',
      actualUntilMs,
    };
  }

  return {
    ok: true,
    actualUntilMs,
  };
}

function verifyTimeoutCleared(member, now = Date.now()) {
  const actualUntilMs = getCommunicationDisabledUntilTimestamp(member);
  return {
    ok: !actualUntilMs || actualUntilMs <= now,
    actualUntilMs,
  };
}

async function fetchAuthoritativeTargetMember(guild, targetId) {
  if (!guild?.members?.fetch || !targetId) return null;
  return guild.members.fetch(targetId).catch(() => null);
}

async function verifyTimeoutStateWithRetries({
  guild,
  targetId,
  expectedUntilMs = null,
  retryDelaysMs = TIMEOUT_VERIFY_RETRY_DELAYS_MS,
  verify,
  missingReason = 'target_missing_after_verify',
} = {}) {
  if (typeof verify !== 'function') {
    throw new TypeError('verify must be a function');
  }

  return retryModerationVerification({
    retryDelaysMs,
    runCheck: async () => {
      const member = await fetchAuthoritativeTargetMember(guild, targetId);
      if (!member?.id || !member.roles) {
        return {
          ok: false,
          reason: missingReason,
          actualUntilMs: null,
          member: null,
        };
      }

      const verifyResult = verify(member, expectedUntilMs);
      return {
        ...verifyResult,
        member,
      };
    },
  });
}

async function verifyTimeoutAppliedAuthoritatively({
  guild,
  targetId,
  expectedUntilMs,
  retryDelaysMs = TIMEOUT_VERIFY_RETRY_DELAYS_MS,
} = {}) {
  return verifyTimeoutStateWithRetries({
    guild,
    targetId,
    expectedUntilMs,
    retryDelaysMs,
    missingReason: 'target_missing_after_apply',
    verify: (member, expectedUntil) => verifyTimeoutApplied(member, expectedUntil),
  });
}

async function verifyTimeoutClearedAuthoritatively({
  guild,
  targetId,
  retryDelaysMs = TIMEOUT_VERIFY_RETRY_DELAYS_MS,
} = {}) {
  return verifyTimeoutStateWithRetries({
    guild,
    targetId,
    retryDelaysMs,
    missingReason: 'target_missing_after_clear',
    verify: (member) => verifyTimeoutCleared(member),
  });
}

function isMemberInVoice(member) {
  return Boolean(member?.voice?.channelId || member?.voice?.channel);
}

function isAdministratorTarget(member) {
  return Boolean(member?.permissions?.has?.('Administrator'));
}

async function applyCommunicationTimeout(member, durationMs, reason) {
  const safeDurationMs = clampNativeTimeoutDurationMs(durationMs);

  if (typeof member?.timeout === 'function') {
    return member.timeout(safeDurationMs, reason);
  }

  if (typeof member?.disableCommunicationUntil === 'function') {
    return member.disableCommunicationUntil(new Date(Date.now() + safeDurationMs), reason);
  }

  const err = new Error('timeout_method_unavailable');
  err.code = 'TIMEOUT_METHOD_UNAVAILABLE';
  throw err;
}

async function clearCommunicationTimeout(member, reason) {
  if (typeof member?.timeout === 'function') {
    return member.timeout(null, reason);
  }

  if (typeof member?.disableCommunicationUntil === 'function') {
    return member.disableCommunicationUntil(null, reason);
  }

  const err = new Error('timeout_clear_method_unavailable');
  err.code = 'TIMEOUT_CLEAR_METHOD_UNAVAILABLE';
  throw err;
}

async function disconnectMemberFromVoice(member, reason) {
  if (typeof member?.voice?.disconnect === 'function') {
    return member.voice.disconnect(reason);
  }

  if (typeof member?.voice?.setChannel === 'function') {
    return member.voice.setChannel(null, reason);
  }

  const err = new Error('voice_disconnect_unavailable');
  err.code = 'VOICE_DISCONNECT_UNAVAILABLE';
  throw err;
}

module.exports = {
  DEFAULT_NATIVE_TIMEOUT_MS,
  DEFAULT_NATIVE_TIMEOUT_TEXT,
  MAX_NATIVE_TIMEOUT_MS,
  SAFE_TIMEOUT_BUFFER_MS,
  SAFE_MAX_NATIVE_TIMEOUT_MS,
  TIMEOUT_VERIFY_SKEW_MS,
  TIMEOUT_VERIFY_RETRY_DELAYS_MS,
  clampNativeTimeoutDurationMs,
  parseRequiredTimeoutDuration,
  getCommunicationDisabledUntilTimestamp,
  hasActiveCommunicationTimeout,
  verifyTimeoutApplied,
  verifyTimeoutCleared,
  fetchAuthoritativeTargetMember,
  verifyTimeoutAppliedAuthoritatively,
  verifyTimeoutClearedAuthoritatively,
  isMemberInVoice,
  isAdministratorTarget,
  applyCommunicationTimeout,
  clearCommunicationTimeout,
  disconnectMemberFromVoice,
};
