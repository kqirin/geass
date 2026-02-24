const weeklyStaffRepository = require('../../infrastructure/repositories/weeklyStaffRepository');
const { getWeekWindow } = require('./time');

const defaultWeights = {
  command: 1,
  warn: 1,
  mute: 2,
  vcmute: 2,
  jail: 3,
  kick: 3,
  ban: 5,
};

const defaultSpamGuard = {
  commandCooldownSec: 6,
  duplicatePenaltyPoints: 1,
};

function safeInt(value, fallback, min = 0, max = 10000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function buildConfig(rawConfig) {
  return {
    ...rawConfig,
    timezone: rawConfig?.timezone || 'Europe/Istanbul',
    weekStartDow: safeInt(rawConfig?.weekStartDow, 1, 0, 6),
    weights: { ...defaultWeights, ...(rawConfig?.weights || {}) },
    spamGuard: {
      commandCooldownSec: safeInt(rawConfig?.spamGuard?.commandCooldownSec, defaultSpamGuard.commandCooldownSec, 1, 300),
      duplicatePenaltyPoints: safeInt(rawConfig?.spamGuard?.duplicatePenaltyPoints, defaultSpamGuard.duplicatePenaltyPoints, 0, 10),
    },
    eligibleRoles: Array.isArray(rawConfig?.eligibleRoles) ? rawConfig.eligibleRoles : [],
    excludedRoles: Array.isArray(rawConfig?.excludedRoles) ? rawConfig.excludedRoles : [],
  };
}

function createWeeklyStaffTracker({ client, logError = () => {} } = {}) {
  if (!client) throw new Error('createWeeklyStaffTracker: client gerekli');
  const cooldowns = new Map();
  let pruneTick = 0;

  function bumpPrune(nowMs) {
    pruneTick += 1;
    if (pruneTick % 100 !== 0) return;
    for (const [key, expiresAt] of cooldowns.entries()) {
      if (expiresAt <= nowMs) cooldowns.delete(key);
    }
  }

  async function isEligibleMember(guildId, userId, cfg) {
    try {
      const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
      if (!guild) return false;
      const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
      if (!member) return false;

      if (cfg.excludedRoles.length > 0 && member.roles.cache.some((r) => cfg.excludedRoles.includes(r.id))) return false;
      if (cfg.eligibleRoles.length === 0) return false;
      return member.roles.cache.some((r) => cfg.eligibleRoles.includes(r.id));
    } catch (err) {
      logError('weekly_staff_member_check_failed', err, { guildId, userId });
      return false;
    }
  }

  async function trackEvent({
    guildId,
    userId,
    eventType,
    commandName = null,
    occurredAt = Date.now(),
    metadata = null,
  }) {
    try {
      if (!guildId || !userId || !eventType) return;
      const rawConfig = await weeklyStaffRepository.getConfig(guildId);
      if (!rawConfig?.enabled) return;
      const cfg = buildConfig(rawConfig);
      const eligible = await isEligibleMember(guildId, userId, cfg);
      if (!eligible) return;

      let points = safeInt(cfg.weights[eventType], 0, -1000, 10000);
      let spamApplied = false;

      if (eventType === 'command') {
        const cooldownSec = cfg.spamGuard.commandCooldownSec;
        const cooldownKey = `${guildId}:${userId}:${String(commandName || '').toLowerCase()}`;
        const currentCooldown = cooldowns.get(cooldownKey) || 0;
        if (currentCooldown > occurredAt) {
          points = Math.max(0, points - cfg.spamGuard.duplicatePenaltyPoints);
          spamApplied = true;
        }
        cooldowns.set(cooldownKey, occurredAt + cooldownSec * 1000);
        bumpPrune(occurredAt);
      }

      const { weekStartMs, weekEndMs } = getWeekWindow(occurredAt, cfg.timezone, cfg.weekStartDow);
      await weeklyStaffRepository.insertEvent({
        guildId,
        userId,
        eventType,
        commandName: commandName || null,
        pointsDelta: points,
        occurredAt,
        weekStart: weekStartMs,
        metadata: {
          ...(metadata || {}),
          spamApplied,
        },
      });
      await weeklyStaffRepository.upsertScoreDelta({
        guildId,
        userId,
        weekStart: weekStartMs,
        weekEnd: weekEndMs,
        pointsDelta: points,
        commandDelta: eventType === 'command' ? 1 : 0,
        moderationDelta: eventType === 'command' ? 0 : 1,
        breakdownKey: eventType,
      });
    } catch (err) {
      logError('weekly_staff_track_event_failed', err, {
        guildId,
        userId,
        eventType,
        commandName,
      });
    }
  }

  return {
    trackEvent,
  };
}

module.exports = {
  createWeeklyStaffTracker,
  defaultWeights,
  defaultSpamGuard,
};

