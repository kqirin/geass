const { renderPrometheus } = require('../../../metrics');
const { checkHealth } = require('../../../infrastructure/repositories/systemRepository');

function registerSystemRoutes(app, { client, METRICS_TOKEN, getFeatureHealth = null }) {
  function buildHealthPayload() {
    const now = Date.now();
    const checks = { db: false, discord: false };
    return { now, checks };
  }

  async function handleHealth(_req, res) {
    const { now, checks } = buildHealthPayload();
    try {
      await checkHealth();
      checks.db = true;
    } catch {}

    checks.discord = Boolean(client?.isReady?.() && client.ws?.status === 0);

    const ok = checks.db && checks.discord;
    const rawFeatureHealth = typeof getFeatureHealth === 'function' ? getFeatureHealth() : {};
    const featureHealth = Object.fromEntries(
      Object.entries(rawFeatureHealth || {}).map(([key, value]) => [String(key), Boolean(value)])
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(ok ? 200 : 503).json({
      ok,
      ts: now,
      checks,
      features: featureHealth,
      guildCount: client?.guilds?.cache?.size || 0,
    });
  }

  app.get('/api/metrics', (req, res) => {
    if (METRICS_TOKEN) {
      const auth = req.get('authorization') || '';
      if (auth !== `Bearer ${METRICS_TOKEN}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    return res.send(renderPrometheus());
  });

  app.get('/api/health', handleHealth);
  app.get('/health', handleHealth);
}

module.exports = { registerSystemRoutes };

