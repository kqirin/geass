function createAuthMiddleware({ client, sessionSigner, singleGuildId }) {
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

  async function hasLiveGuildAccess(sess, guildId) {
    if (!guildId) return true;
    if (!sess?.userId) return sess.guilds?.some((g) => g.id === guildId);

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const member = await guild.members.fetch(sess.userId).catch(() => null);
    if (!member) return false;
    return member.permissions?.has?.('Administrator') === true;
  }

  async function requireAuth(req, res, next) {
    const sess = parseUserSession(req);
    if (!sess || !Array.isArray(sess.guilds)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const guildId = req.params.id || req.params.guildId || req.body?.guildId || null;
    if (singleGuildId && guildId && guildId !== singleGuildId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (guildId) {
      const cookieHasGuild = sess.guilds.some((g) => g.id === guildId);
      if (!cookieHasGuild) return res.status(403).json({ error: 'Forbidden' });

      const liveAllowed = await hasLiveGuildAccess(sess, guildId);
      if (!liveAllowed) return res.status(403).json({ error: 'Forbidden' });
    }

    req.userSession = sess;
    return next();
  }

  return { requireAuth, parseUserSession };
}

module.exports = { createAuthMiddleware };

