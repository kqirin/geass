const cache = require('../../../utils/cache');
const {
  MAX_MEMBER_SEARCH_QUERY,
  isSnowflake,
  pickAllowedSettings,
  truncate,
} = require('./helpers');
const {
  getSettingsByGuildId,
  hasSettingsRow,
  updateSettings,
  insertSettings,
  getSettingsColumns,
} = require('../../../infrastructure/repositories/settingsRepository');

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function normalizeIdList(value) {
  if (!value) return '';
  return String(value)
    .split(',')
    .map((x) => String(x || '').trim().replace(/[^\d]/g, ''))
    .filter((x) => isSnowflake(x))
    .join(',');
}

function normalizeSettingsInput(raw) {
  const input = { ...(raw || {}) };
  for (const [key, value] of Object.entries(input)) {
    if (key.endsWith('_enabled')) {
      input[key] = value === true || value === 1 || value === '1';
      continue;
    }
    if (key.endsWith('_limit')) {
      input[key] = clampNumber(value, 0, 5000, 0);
      continue;
    }
    if (key.endsWith('_safe_list')) {
      input[key] = normalizeIdList(value);
      continue;
    }
    if (key.endsWith('_role') || key.endsWith('_channel') || key.endsWith('_category')) {
      const normalized = String(value || '').trim().replace(/[^\d]/g, '');
      input[key] = isSnowflake(normalized) ? normalized : null;
      continue;
    }
  }

  return input;
}

function registerSettingsRoutes(app, { client, requireAuth, routeError: _routeError, logSystem, logError, tagRoleFeature = null, settingsColumnsTtlMs }) {
  let settingsColumnsCache = null;
  let settingsColumnsCacheAt = 0;

  async function getColumns(force = false) {
    const freshEnough = Date.now() - settingsColumnsCacheAt <= settingsColumnsTtlMs;
    if (!force && settingsColumnsCache && freshEnough) return settingsColumnsCache;
    settingsColumnsCache = await getSettingsColumns();
    settingsColumnsCacheAt = Date.now();
    return settingsColumnsCache;
  }

  app.get('/api/settings/:id', requireAuth, async (req, res) => {
    const guildId = req.params.id;
    if (!isSnowflake(guildId)) {
      return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    }

    const defaultSettings = {
      prefix: '.',
      custom_messages: {},
      log_enabled: true,
      log_role: null,
      log_safe_list: '',
      log_limit: 25,
      warn_enabled: true,
      warn_limit: 0,
      mute_enabled: true,
      mute_limit: 25,
      kick_enabled: true,
      kick_limit: 5,
      ban_enabled: true,
      ban_limit: 5,
      jail_enabled: true,
      jail_limit: 5,
      clear_enabled: true,
      clear_limit: 25,
      tag_enabled: false,
      tag_role: null,
    };

    try {
      const rows = await getSettingsByGuildId(guildId);
      if (!rows || rows.length === 0) return res.json(defaultSettings);

      const dbSettings = rows[0];
      try {
        if (typeof dbSettings.custom_messages === 'string') {
          dbSettings.custom_messages = JSON.parse(dbSettings.custom_messages || '{}');
        }
      } catch {
        dbSettings.custom_messages = {};
      }

      return res.json({ ...defaultSettings, ...dbSettings });
    } catch (err) {
      logError('settings_get_failed', err, { guildId, requestId: req.requestId });
      return res.json(defaultSettings);
    }
  });

  app.get('/api/settings/search-members/:id', requireAuth, async (req, res) => {
    const guildId = req.params.id;
    if (!isSnowflake(guildId)) {
      return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    }
    const q = truncate(req.query.q, MAX_MEMBER_SEARCH_QUERY);
    if (!q) return res.json([]);

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const results = await guild.members.search({ query: q, limit: 10 });
      const mapped = results.map((m) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.displayAvatarURL({ size: 64 }),
      }));
      return res.json(mapped);
    } catch (err) {
      logError('settings_member_search_failed', err, { guildId, q, requestId: req.requestId });
      return res.json([]);
    }
  });

  app.post('/api/settings/:id', requireAuth, async (req, res) => {
    const guildId = req.params.id;
    if (!isSnowflake(guildId)) {
      return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    }
    const inputRaw = normalizeSettingsInput(pickAllowedSettings(req.body || {}));

    const safePrefix = typeof inputRaw.prefix === 'string' ? inputRaw.prefix.trim() : '';
    if (safePrefix.length > 3) {
      return res.status(400).json({ error: 'Prefix en fazla 3 karakter olabilir', requestId: req.requestId });
    }
    if (safePrefix) inputRaw.prefix = safePrefix;

    const customMessagesObj =
      typeof inputRaw.custom_messages === 'object' && inputRaw.custom_messages !== null
        ? inputRaw.custom_messages
        : {};

    const settingsForDb = {
      ...inputRaw,
      custom_messages: JSON.stringify(customMessagesObj),
    };

    try {
      const settingsColumns = await getColumns();
      const keys = Object.keys(settingsForDb).filter((k) => settingsColumns.has(k) && k !== 'guild_id');
      if (keys.length === 0) {
        return res.status(400).json({ error: 'Kaydedilecek gecerli ayar alani yok', requestId: req.requestId });
      }

      const exists = await hasSettingsRow(guildId);
      const values = keys.map((k) => settingsForDb[k]);

      if (exists) {
        await updateSettings(guildId, keys, values);
        logSystem(`Ayarlar guncellendi: ${guildId}`, 'SUCCESS');
      } else {
        await insertSettings(guildId, keys, values);
        logSystem(`Ayarlar eklendi: ${guildId}`, 'SUCCESS');
      }

      cache.updateSettings(guildId, { ...inputRaw, custom_messages: customMessagesObj });

      const shouldSyncTagRole = ['tag_enabled', 'tag_role'].some((k) =>
        Object.prototype.hasOwnProperty.call(inputRaw, k)
      );
      if (shouldSyncTagRole && tagRoleFeature?.syncGuild) {
        const syncResult = await tagRoleFeature.syncGuild(guildId, 'settings_save');
        if (!syncResult?.ok && syncResult?.code && syncResult.code !== 'disabled_or_incomplete') {
          logSystem(`Tag role sync sonucu: guild=${guildId} code=${syncResult.code}`, 'INFO');
        }
      }

      return res.json({ success: true });
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        try {
          await getColumns(true);
        } catch {}
      }

      logError('settings_save_failed', err, { guildId, requestId: req.requestId });
      return res.status(500).json({
        error: err?.sqlMessage || err?.code || 'Guncellenemedi',
        requestId: req.requestId,
      });
    }
  });
}

module.exports = { registerSettingsRoutes };

