function createAuthMiddleware({ client, sessionSigner, singleGuildId }) {
  const LIVE_GUILD_ACCESS_TTL_MS = 15 * 1000;
  const liveGuildAccessCache = new Map();
  const liveGuildAccessInflight = new Map();

  function isSnowflake(value) {
    return /^\d{5,32}$/.test(String(value || '').trim());
  }

  function sanitizeSession(rawSession) {
    if (!rawSession || typeof rawSession !== 'object') return null;
    if (!Array.isArray(rawSession.guilds)) return null;

    const guilds = rawSession.guilds
      .map((g) => ({ id: String(g?.id || '').trim(), name: String(g?.name || '').trim() }))
      .filter((g) => isSnowflake(g.id));
    if (guilds.length === 0) return null;

    const userId = isSnowflake(rawSession.userId) ? String(rawSession.userId) : null;
    return { ...rawSession, userId, guilds };
  }

  function parseUserSession(req) {
    const raw = req.cookies?.user_session;
    if (!raw) return null;
    return sanitizeSession(sessionSigner.unpack(raw));
  }

  function getAccessCacheKey(userId, guildId) {
    return `${String(userId || '')}:${String(guildId || '')}`;
  }

  function pruneLiveGuildAccessCache(now = Date.now()) {
    for (const [key, entry] of liveGuildAccessCache.entries()) {
      if (!entry || Number(entry.expiresAt || 0) <= now) liveGuildAccessCache.delete(key);
    }
  }

  async function hasLiveGuildAccess(sess, guildId, req = null) {
    if (!guildId) return true;
    if (!sess?.userId) return sess.guilds?.some((g) => g.id === guildId);

    const requestCache = req?.authState?.guildAccess;
    if (requestCache?.has(guildId)) {
      return requestCache.get(guildId) === true;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const cacheKey = getAccessCacheKey(sess.userId, guildId);
    const now = Date.now();
    pruneLiveGuildAccessCache(now);

    const cached = liveGuildAccessCache.get(cacheKey);
    if (cached?.allowed && Number(cached.expiresAt || 0) > now) {
      requestCache?.set(guildId, true);
      return true;
    }

    if (liveGuildAccessInflight.has(cacheKey)) {
      const allowed = await liveGuildAccessInflight.get(cacheKey);
      requestCache?.set(guildId, allowed === true);
      return allowed === true;
    }

    const pending = guild.members.fetch(sess.userId)
      .then((member) => member?.permissions?.has?.('Administrator') === true)
      .catch(() => {
        const fallback = liveGuildAccessCache.get(cacheKey);
        return fallback?.allowed === true && Number(fallback.expiresAt || 0) > Date.now();
      })
      .finally(() => {
        liveGuildAccessInflight.delete(cacheKey);
      });
    liveGuildAccessInflight.set(cacheKey, pending);

    const allowed = await pending;
    if (allowed) {
      liveGuildAccessCache.set(cacheKey, {
        allowed: true,
        expiresAt: Date.now() + LIVE_GUILD_ACCESS_TTL_MS,
      });
    } else {
      liveGuildAccessCache.delete(cacheKey);
    }
    requestCache?.set(guildId, allowed === true);
    return allowed === true;
  }

  function resolveRequestedGuildId(req, sess) {
    const rawGuildId =
      req.params?.id ||
      req.params?.guildId ||
      req.body?.guildId ||
      req.query?.guildId ||
      null;
    if (isSnowflake(rawGuildId)) return String(rawGuildId).trim();

    if (isSnowflake(singleGuildId)) return String(singleGuildId).trim();
    if (Array.isArray(sess?.guilds) && sess.guilds.length === 1 && isSnowflake(sess.guilds[0]?.id)) {
      return String(sess.guilds[0].id).trim();
    }
    return null;
  }

  async function requireAuth(req, res, next) {
    const sess = parseUserSession(req);
    if (!sess || !Array.isArray(sess.guilds)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.authState = req.authState || { guildAccess: new Map() };

    const guildId = resolveRequestedGuildId(req, sess);
    if (singleGuildId && guildId && guildId !== singleGuildId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (guildId) {
      const cookieHasGuild = sess.guilds.some((g) => g.id === guildId);
      if (!cookieHasGuild) return res.status(403).json({ error: 'Forbidden' });

      const liveAllowed = await hasLiveGuildAccess(sess, guildId, req);
      if (!liveAllowed) return res.status(403).json({ error: 'Forbidden' });
    }

    req.userSession = sess;
    req.authorizedGuildId = guildId;
    req.hasAuthorizedGuildAccess = async (requestedGuildId) => {
      const normalizedGuildId = isSnowflake(requestedGuildId) ? String(requestedGuildId).trim() : null;
      if (!normalizedGuildId) return false;
      if (req.authorizedGuildId && req.authorizedGuildId === normalizedGuildId) return true;
      if (!sess.guilds.some((g) => g.id === normalizedGuildId)) return false;
      return hasLiveGuildAccess(sess, normalizedGuildId, req);
    };
    return next();
  }

  return { requireAuth, parseUserSession };
}

module.exports = { createAuthMiddleware };

