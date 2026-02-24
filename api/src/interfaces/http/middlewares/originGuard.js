function createOriginGuard({ allowedOrigins, allowedOriginSet }) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const origin = req.get('origin');
    const referer = req.get('referer');

    if (origin && allowedOriginSet.has(origin)) return next();

    if (referer) {
      for (const allowed of allowedOrigins) {
        if (referer.startsWith(allowed)) return next();
      }
    }

    return res.status(403).json({ error: 'Forbidden origin', requestId: req.requestId });
  };
}

module.exports = { createOriginGuard };

