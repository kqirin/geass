function createOriginGuard({ allowedOrigins, allowedOriginSet }) {
  const normalizedAllowedOrigins = new Set();

  const addAllowedOrigin = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;

    normalizedAllowedOrigins.add(raw);
    try {
      normalizedAllowedOrigins.add(new URL(raw).origin);
    } catch {}
  };

  for (const origin of allowedOrigins || []) addAllowedOrigin(origin);
  for (const origin of allowedOriginSet || []) addAllowedOrigin(origin);

  const extractOrigin = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      return new URL(raw).origin;
    } catch {
      return raw;
    }
  };

  const isAllowed = (value) => {
    const normalized = extractOrigin(value);
    if (!normalized) return false;
    return normalizedAllowedOrigins.has(normalized);
  };

  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const origin = req.get('origin');
    const referer = req.get('referer');

    if (isAllowed(origin)) return next();
    if (isAllowed(referer)) return next();

    return res.status(403).json({ error: 'Forbidden origin', requestId: req.requestId });
  };
}

module.exports = { createOriginGuard };

