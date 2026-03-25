const {
  buildAuthoritativeSettings,
} = require('../../../config/static');
const { isSnowflake } = require('./helpers');
const STATIC_SETTINGS_META = Object.freeze({
  readOnly: true,
  source: 'config',
});

function buildSettingsSnapshot(guildId) {
  return buildAuthoritativeSettings(guildId);
}

function registerSettingsRoutes(app, { requireAuth }) {
  app.get('/api/settings/:id', requireAuth, async (req, res) => {
    const guildId = req.params.id;
    if (!isSnowflake(guildId)) {
      return res.status(400).json({ error: 'Gecersiz sunucu ID', requestId: req.requestId });
    }

    return res.json({
      settings: buildSettingsSnapshot(guildId),
      meta: STATIC_SETTINGS_META,
    });
  });

  app.post('/api/settings/:id', requireAuth, async (req, res) => {
    const guildId = req.params.id;
    if (!isSnowflake(guildId)) {
      return res.status(400).json({ error: 'Gecersiz sunucu ID', requestId: req.requestId });
    }

    res.set('Allow', 'GET');
    return res.status(405).json({
      error: 'Static settings dashboard uzerinden degistirilemez. Config katmani authoritative kaynaktir.',
      requestId: req.requestId,
      readOnly: true,
      source: STATIC_SETTINGS_META.source,
    });
  });
}

module.exports = {
  STATIC_SETTINGS_META,
  registerSettingsRoutes,
};
