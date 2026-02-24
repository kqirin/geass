const { recordRateLimitHit } = require('../../../metrics');

function createApiRateLimiter({
  getClientIp,
  windowMs,
  authMax,
  apiMax,
  maxKeys,
}) {
  const rateWindow = new Map();

  function pruneRateWindow(now) {
    for (const [key, entry] of rateWindow) {
      if (now - entry.lastSeen > windowMs * 6) rateWindow.delete(key);
    }

    if (rateWindow.size <= maxKeys) return;
    const victims = [...rateWindow.entries()]
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
      .slice(0, rateWindow.size - maxKeys)
      .map(([k]) => k);
    for (const key of victims) rateWindow.delete(key);
  }

  return (req, res, next) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const max = req.path.startsWith('/auth/') ? authMax : apiMax;
    const key = `${ip}:${req.method}:${req.path}`;

    const cur = rateWindow.get(key) || { count: 0, start: now, lastSeen: now };
    if (now - cur.start > windowMs) {
      cur.start = now;
      cur.count = 0;
    }

    cur.count += 1;
    cur.lastSeen = now;
    rateWindow.set(key, cur);
    pruneRateWindow(now);

    if (cur.count > max) {
      recordRateLimitHit();
      return res.status(429).json({ error: 'Too many requests', requestId: req.requestId });
    }

    next();
  };
}

module.exports = { createApiRateLimiter };

