const weeklyStaffRepository = require('../../infrastructure/repositories/weeklyStaffRepository');
const { getWeekWindow, WEEK_MS } = require('./time');
const { defaultWeights, defaultSpamGuard } = require('./tracker');

function safeInt(value, fallback, min = 0, max = 10000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function normalizeConfig(rawConfig) {
  return {
    ...rawConfig,
    announcementMessage: rawConfig?.announcementMessage || null,
    timezone: rawConfig?.timezone || 'Europe/Istanbul',
    weekStartDow: safeInt(rawConfig?.weekStartDow, 1, 0, 6),
    minimumPoints: safeInt(rawConfig?.minimumPoints, 20, 0, 100000),
    tieBreakMode: rawConfig?.tieBreakMode || 'moderation_first',
    weights: { ...defaultWeights, ...(rawConfig?.weights || {}) },
    spamGuard: { ...defaultSpamGuard, ...(rawConfig?.spamGuard || {}) },
    eligibleRoles: Array.isArray(rawConfig?.eligibleRoles) ? rawConfig.eligibleRoles : [],
    excludedRoles: Array.isArray(rawConfig?.excludedRoles) ? rawConfig.excludedRoles : [],
  };
}

function pickWinners(candidates, tieBreakMode) {
  if (!candidates.length) return { winners: [], tieInfo: null };
  const topPoint = Number(candidates[0].points || 0);
  const topPointCandidates = candidates.filter((x) => Number(x.points || 0) === topPoint);
  if (topPointCandidates.length === 1) return { winners: [topPointCandidates[0]], tieInfo: null };

  if (tieBreakMode === 'multi') {
    return {
      winners: topPointCandidates,
      tieInfo: { mode: 'multi', topPoint, candidateCount: topPointCandidates.length },
    };
  }

  if (tieBreakMode === 'random') {
    const winner = topPointCandidates[Math.floor(Math.random() * topPointCandidates.length)];
    return {
      winners: winner ? [winner] : [],
      tieInfo: { mode: 'random', topPoint, candidateCount: topPointCandidates.length },
    };
  }

  const moderationSorted = [...topPointCandidates].sort(
    (a, b) => Number(b.moderation_actions || 0) - Number(a.moderation_actions || 0)
  );
  const topModeration = Number(moderationSorted[0]?.moderation_actions || 0);
  const moderationTop = moderationSorted.filter((x) => Number(x.moderation_actions || 0) === topModeration);
  if (moderationTop.length === 1) {
    return {
      winners: [moderationTop[0]],
      tieInfo: { mode: 'moderation_first', topPoint, topModeration, candidateCount: topPointCandidates.length },
    };
  }
  const winner = moderationTop[Math.floor(Math.random() * moderationTop.length)];
  return {
    winners: winner ? [winner] : [],
    tieInfo: { mode: 'moderation_random', topPoint, topModeration, candidateCount: moderationTop.length },
  };
}

async function removeAwardRole(client, winnerRow, roleId, logError) {
  try {
    if (!roleId) return;
    const guild = client.guilds.cache.get(winnerRow.guild_id) || (await client.guilds.fetch(winnerRow.guild_id).catch(() => null));
    if (!guild) return;
    const member = guild.members.cache.get(winnerRow.winner_user_id) || (await guild.members.fetch(winnerRow.winner_user_id).catch(() => null));
    if (!member) return;
    if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
  } catch (err) {
    logError('weekly_staff_remove_role_failed', err, {
      guildId: winnerRow.guild_id,
      userId: winnerRow.winner_user_id,
      roleId,
    });
  }
}

async function giveAwardRole(client, guildId, userId, roleId, logError) {
  if (!roleId) return { ok: false, reason: 'award_role_not_set' };
  try {
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { ok: false, reason: 'guild_not_found' };
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!me) return { ok: false, reason: 'bot_member_not_found' };
    if (!me.permissions?.has('ManageRoles')) return { ok: false, reason: 'bot_missing_manage_roles' };
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) return { ok: false, reason: 'award_role_not_found' };
    if (me.roles.highest.position <= role.position) return { ok: false, reason: 'role_hierarchy_too_low' };
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    if (!member) return { ok: false, reason: 'winner_member_not_found' };
    if (!member.manageable) return { ok: false, reason: 'winner_not_manageable' };
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
    return { ok: true, reason: 'assigned' };
  } catch (err) {
    logError('weekly_staff_give_role_failed', err, { guildId, userId, roleId });
    return { ok: false, reason: 'discord_api_error' };
  }
}

async function announceWinners(client, guildId, cfg, winners, logError) {
  if (!cfg.announcementChannelId || !winners.length) return;
  try {
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const channel = guild.channels.cache.get(cfg.announcementChannelId) || (await guild.channels.fetch(cfg.announcementChannelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return;
    const winnerLine = winners
      .map((w) => `<@${w.user_id}> (${Number(w.points || 0)} puan, mod: ${Number(w.moderation_actions || 0)})`)
      .join('\n');
    const template = String(cfg.announcementMessage || '').trim();
    const firstWinner = winners[0];
    const textFromTemplate = template
      .replaceAll('{winners}', winnerLine)
      .replaceAll('{winner}', firstWinner ? `<@${firstWinner.user_id}>` : '-')
      .replaceAll('{points}', firstWinner ? String(Number(firstWinner.points || 0)) : '0');
    await channel.send({
      content: textFromTemplate || `Haftanin Yetkilisi\n${winnerLine}`,
      allowedMentions: { parse: ['users'] },
    });
  } catch (err) {
    logError('weekly_staff_announce_failed', err, { guildId, channelId: cfg.announcementChannelId });
  }
}

function createWeeklyStaffScheduler({ client, logSystem = () => {}, logError = () => {} } = {}) {
  if (!client) throw new Error('createWeeklyStaffScheduler: client gerekli');
  let intervalRef = null;
  let running = false;

  async function cleanupExpired(nowMs = Date.now()) {
    const expired = await weeklyStaffRepository.getExpiredActiveWinners(nowMs);
    for (const row of expired) {
      const cfg = normalizeConfig(await weeklyStaffRepository.getConfig(row.guild_id));
      await removeAwardRole(client, row, cfg.awardRoleId, logError);
      await weeklyStaffRepository.deactivateWinner(row.guild_id, row.week_start, row.winner_user_id);
    }
  }

  async function evaluateGuild(guildId, nowMs = Date.now(), options = {}) {
    const useCurrentWeek = Boolean(options?.useCurrentWeek);
    const rawConfig = await weeklyStaffRepository.getConfig(guildId);
    if (!rawConfig?.enabled) return { ok: false, reason: 'disabled' };
    const cfg = normalizeConfig(rawConfig);
    const currentWindow = getWeekWindow(nowMs, cfg.timezone, cfg.weekStartDow);
    const targetWeekStart = useCurrentWeek ? currentWindow.weekStartMs : currentWindow.weekStartMs - WEEK_MS;
    const targetWeekEnd = useCurrentWeek ? currentWindow.weekEndMs : currentWindow.weekStartMs;

    const existingWinner = await weeklyStaffRepository.getWinnerForWeek(guildId, targetWeekStart);
    if (existingWinner) return { ok: true, reason: 'already_selected', winnerUserId: existingWinner.winner_user_id };

    const allScores = await weeklyStaffRepository.getWeekScores(guildId, targetWeekStart);
    const candidates = allScores
      .filter((row) => Number(row.points || 0) >= cfg.minimumPoints)
      .sort((a, b) => {
        const p = Number(b.points || 0) - Number(a.points || 0);
        if (p !== 0) return p;
        const m = Number(b.moderation_actions || 0) - Number(a.moderation_actions || 0);
        if (m !== 0) return m;
        return Number(b.command_count || 0) - Number(a.command_count || 0);
      });

    const activeRows = await weeklyStaffRepository.getActiveWinners(guildId);
    for (const row of activeRows) {
      await removeAwardRole(client, row, cfg.awardRoleId, logError);
      await weeklyStaffRepository.deactivateWinner(guildId, row.week_start, row.winner_user_id);
    }

    if (candidates.length === 0) {
      await weeklyStaffRepository.finalizeWeek(guildId, targetWeekStart);
      return { ok: true, reason: 'no_candidates' };
    }

    const picked = pickWinners(candidates, cfg.tieBreakMode);
    const winners = picked.winners;
    if (!winners.length) {
      await weeklyStaffRepository.finalizeWeek(guildId, targetWeekStart);
      return { ok: true, reason: 'no_winner_after_tie_break' };
    }

    const roleAssign = [];
    for (const winner of winners) {
      const assignResult = await giveAwardRole(client, guildId, winner.user_id, cfg.awardRoleId, logError);
      roleAssign.push({ userId: winner.user_id, ...assignResult });
      await weeklyStaffRepository.insertWinner({
        guildId,
        weekStart: targetWeekStart,
        weekEnd: targetWeekEnd,
        winnerUserId: winner.user_id,
        points: Number(winner.points || 0),
        moderationActions: Number(winner.moderation_actions || 0),
        awardedAt: nowMs,
        expiresAt: currentWindow.weekEndMs,
        tieInfo: picked.tieInfo,
      });
    }

    await weeklyStaffRepository.finalizeWeek(guildId, targetWeekStart);
    await announceWinners(client, guildId, cfg, winners, logError);
    logSystem(`Weekly staff secimi tamamlandi: guild=${guildId}, winners=${winners.map((w) => w.user_id).join(',')}`, 'INFO');
    const failedRoleAssign = roleAssign.filter((x) => !x.ok);
    if (failedRoleAssign.length > 0) {
      logError('weekly_staff_role_assignment_partial_failed', new Error('role_assignment_failed'), {
        guildId,
        failures: failedRoleAssign,
      });
    }
    return {
      ok: true,
      reason: failedRoleAssign.length > 0 ? 'success_with_role_errors' : 'success',
      winners: winners.map((w) => w.user_id),
      roleAssign,
    };
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      await cleanupExpired(now);
      const guildIds = await weeklyStaffRepository.listEnabledConfigs();
      for (const guildId of guildIds) {
        await evaluateGuild(guildId, now);
      }
    } catch (err) {
      logError('weekly_staff_scheduler_tick_failed', err);
    } finally {
      running = false;
    }
  }

  function start() {
    if (intervalRef) return;
    intervalRef = setInterval(() => {
      tick().catch((err) => logError('weekly_staff_scheduler_tick_unhandled', err));
    }, 60 * 1000);
    intervalRef.unref();
    tick().catch((err) => logError('weekly_staff_scheduler_initial_tick_failed', err));
  }

  function stop() {
    if (!intervalRef) return;
    clearInterval(intervalRef);
    intervalRef = null;
  }

  return {
    start,
    stop,
    tick,
    evaluateGuild,
    cleanupExpired,
  };
}

module.exports = {
  createWeeklyStaffScheduler,
  normalizeConfig,
};
