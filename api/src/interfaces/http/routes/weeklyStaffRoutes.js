const weeklyStaffRepository = require('../../../infrastructure/repositories/weeklyStaffRepository');
const { getWeekWindow } = require('../../../application/weeklyStaff/time');
const { normalizeConfig } = require('../../../application/weeklyStaff/scheduler');

function isSnowflake(value) {
  return /^\d{5,32}$/.test(String(value || '').trim());
}

function clampInt(value, fallback, min = 0, max = 10000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function toIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter((x) => /^\d{5,32}$/.test(x));
}

function sanitizeConfigInput(input = {}) {
  const tieBreakMode = ['moderation_first', 'random', 'multi'].includes(input.tieBreakMode)
    ? input.tieBreakMode
    : 'moderation_first';
  return {
    enabled: Boolean(input.enabled),
    awardRoleId: input.awardRoleId ? String(input.awardRoleId) : null,
    announcementChannelId: input.announcementChannelId ? String(input.announcementChannelId) : null,
    announcementMessage: String(input.announcementMessage || '').trim().slice(0, 1900) || null,
    timezone: String(input.timezone || 'Europe/Istanbul').slice(0, 64),
    weekStartDow: clampInt(input.weekStartDow, 1, 0, 6),
    minimumPoints: clampInt(input.minimumPoints, 20, 0, 100000),
    tieBreakMode,
    eligibleRoles: toIdList(input.eligibleRoles),
    excludedRoles: toIdList(input.excludedRoles),
    weights: {
      command: clampInt(input?.weights?.command, 1, 0, 100),
      warn: clampInt(input?.weights?.warn, 1, 0, 100),
      mute: clampInt(input?.weights?.mute, 2, 0, 100),
      vcmute: clampInt(input?.weights?.vcmute, 2, 0, 100),
      jail: clampInt(input?.weights?.jail, 3, 0, 100),
      kick: clampInt(input?.weights?.kick, 3, 0, 100),
      ban: clampInt(input?.weights?.ban, 5, 0, 100),
    },
    spamGuard: {
      commandCooldownSec: clampInt(input?.spamGuard?.commandCooldownSec, 6, 1, 300),
      duplicatePenaltyPoints: clampInt(input?.spamGuard?.duplicatePenaltyPoints, 1, 0, 10),
    },
  };
}

function mapConfigForApi(cfg) {
  if (!cfg) {
    return normalizeConfig({
      enabled: false,
      awardRoleId: null,
      announcementChannelId: null,
      announcementMessage: null,
      timezone: 'Europe/Istanbul',
      weekStartDow: 1,
      minimumPoints: 20,
      tieBreakMode: 'moderation_first',
      eligibleRoles: [],
      excludedRoles: [],
      weights: {},
      spamGuard: {},
    });
  }
  return normalizeConfig(cfg);
}

function parseBreakdown(row) {
  try {
    return typeof row.breakdown_json === 'string' ? JSON.parse(row.breakdown_json) : row.breakdown_json || {};
  } catch {
    return {};
  }
}

function parseTieInfo(row) {
  try {
    return row.tie_info_json ? JSON.parse(row.tie_info_json) : null;
  } catch {
    return null;
  }
}

function registerWeeklyStaffRoutes(app, { requireAuth, routeError, scheduler }) {
  app.get('/api/weekly-staff/:id/config', requireAuth, async (req, res) => {
    try {
      if (!isSnowflake(req.params.id)) {
        return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
      }
      const config = await weeklyStaffRepository.getConfig(req.params.id);
      return res.json(mapConfigForApi(config));
    } catch (err) {
      return routeError(res, req, 'weekly_staff_get_config_failed', err, 'Ayarlar alinamadi');
    }
  });

  app.post('/api/weekly-staff/:id/config', requireAuth, async (req, res) => {
    try {
      const guildId = req.params.id;
      if (!isSnowflake(guildId)) {
        return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
      }
      const input = sanitizeConfigInput(req.body || {});
      await weeklyStaffRepository.upsertConfig(guildId, input);
      return res.json({ success: true, config: mapConfigForApi(input) });
    } catch (err) {
      return routeError(res, req, 'weekly_staff_save_config_failed', err, 'Ayarlar kaydedilemedi');
    }
  });

  app.get('/api/weekly-staff/:id/leaderboard', requireAuth, async (req, res) => {
    try {
      const guildId = req.params.id;
      if (!isSnowflake(guildId)) {
        return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
      }
      const cfg = mapConfigForApi(await weeklyStaffRepository.getConfig(guildId));
      const weekStart = req.query.weekStart
        ? Number(req.query.weekStart)
        : getWeekWindow(Date.now(), cfg.timezone, cfg.weekStartDow).weekStartMs;
      const limit = clampInt(req.query.limit, 20, 1, 100);
      const rows = await weeklyStaffRepository.getLeaderboard(guildId, weekStart, limit);
      const mapped = rows.map((row) => ({
        guildId: row.guild_id,
        userId: row.user_id,
        weekStart: Number(row.week_start),
        weekEnd: Number(row.week_end),
        points: Number(row.points || 0),
        moderationActions: Number(row.moderation_actions || 0),
        commandCount: Number(row.command_count || 0),
        finalized: Boolean(row.finalized),
        breakdown: parseBreakdown(row),
      }));
      return res.json({ weekStart, list: mapped });
    } catch (err) {
      return routeError(res, req, 'weekly_staff_get_leaderboard_failed', err, 'Liderlik tablosu alinamadi');
    }
  });

  app.get('/api/weekly-staff/:id/history', requireAuth, async (req, res) => {
    try {
      if (!isSnowflake(req.params.id)) {
        return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
      }
      const rows = await weeklyStaffRepository.getWinnerHistory(req.params.id, clampInt(req.query.limit, 20, 1, 100));
      const mapped = rows.map((row) => ({
        guildId: row.guild_id,
        weekStart: Number(row.week_start),
        weekEnd: Number(row.week_end),
        winnerUserId: row.winner_user_id,
        points: Number(row.points || 0),
        moderationActions: Number(row.moderation_actions || 0),
        awardedAt: Number(row.awarded_at),
        expiresAt: Number(row.expires_at),
        active: Boolean(row.active),
        tieInfo: parseTieInfo(row),
      }));
      return res.json(mapped);
    } catch (err) {
      return routeError(res, req, 'weekly_staff_get_history_failed', err, 'Gecmis alinamadi');
    }
  });

  app.post('/api/weekly-staff/:id/run', requireAuth, async (req, res) => {
    if (!scheduler) return res.status(503).json({ error: 'Scheduler aktif degil', requestId: req.requestId });
    try {
      if (!isSnowflake(req.params.id)) {
        return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
      }
      const result = await scheduler.evaluateGuild(req.params.id, Date.now(), { useCurrentWeek: true });
      return res.json({ success: true, result });
    } catch (err) {
      return routeError(res, req, 'weekly_staff_manual_run_failed', err, 'Manuel calistirma basarisiz');
    }
  });
}

module.exports = { registerWeeklyStaffRoutes };
