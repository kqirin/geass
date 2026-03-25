function registerBotPresenceRoutes(
  app,
  {
    requireAuth,
    routeError,
    botPresenceManager = null,
  }
) {
  function resolveGuildId(req) {
    const guildId = req.authorizedGuildId || req.query?.guildId || req.body?.guildId || null;
    return /^\d{5,32}$/.test(String(guildId || '').trim()) ? String(guildId).trim() : null;
  }

  app.get('/api/bot-presence', requireAuth, async (req, res) => {
    const guildId = resolveGuildId(req);
    if (!guildId) {
      return res.status(400).json({
        error: 'guildId gerekli',
        requestId: req.requestId,
      });
    }

    if (typeof botPresenceManager?.loadCurrentSettings !== 'function') {
      return res.status(503).json({
        error: 'Bot durum servisi hazir degil',
        requestId: req.requestId,
      });
    }

    try {
      const settings = await botPresenceManager.loadCurrentSettings();
      return res.json({
        scope: 'global',
        authorizedGuildId: guildId,
        settings,
        meta: {
          ...botPresenceManager.getMeta(),
          scope: 'global',
        },
      });
    } catch (err) {
      return routeError(
        res,
        req,
        'bot_presence_get_failed',
        err,
        'Bot durum ayari okunamadi',
        500
      );
    }
  });

  app.post('/api/bot-presence', requireAuth, async (req, res) => {
    const guildId = resolveGuildId(req);
    if (!guildId) {
      return res.status(400).json({
        error: 'guildId gerekli',
        requestId: req.requestId,
      });
    }

    res.set('Allow', 'GET');
    return res.status(405).json({
      error: 'Global bot presence dashboard uzerinden degistirilemez. Config katmani authoritative kaynaktir.',
      requestId: req.requestId,
      readOnly: true,
      source: 'config',
      scope: 'global',
      authorizedGuildId: guildId,
    });
  });
}

module.exports = { registerBotPresenceRoutes };
