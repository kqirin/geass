const crypto = require('crypto');

function registerAuthRoutes(app, {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  frontendOrigin,
  buildCookieOptions,
  logSystem,
  logError,
  sessionSigner,
  parseUserSession,
  client,
}) {
  app.use('/api/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/auth/login', (_req, res) => {
    const oauthState = crypto.randomBytes(24).toString('base64url');
    res.cookie('oauth_state', oauthState, buildCookieOptions({ maxAge: 10 * 60 * 1000, httpOnly: true }));

    res.redirect(
      `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI
      )}&response_type=code&scope=identify%20guilds&state=${encodeURIComponent(oauthState)}`
    );
  });

  app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const expectedState = req.cookies?.oauth_state;
    res.clearCookie('oauth_state', buildCookieOptions({ httpOnly: true }));

    if (!code) return res.redirect(`${frontendOrigin}/`);
    if (!state || !expectedState || state !== expectedState) {
      return res.status(401).json({ error: 'Invalid OAuth state' });
    }

    try {
      const tokenParams = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      });

      const tokenReq = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: tokenParams,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!tokenReq.ok) {
        const tokenText = await tokenReq.text().catch(() => '');
        throw new Error(`oauth_token_failed status=${tokenReq.status} body=${tokenText.slice(0, 200)}`);
      }

      const tokenData = await tokenReq.json();
      if (!tokenData?.access_token) {
        throw new Error('oauth_token_missing_access_token');
      }

      const [guildReq, meReq] = await Promise.all([
        fetch('https://discord.com/api/users/@me/guilds', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }),
        fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }),
      ]);

      if (!guildReq.ok || !meReq.ok) {
        const guildText = !guildReq.ok ? await guildReq.text().catch(() => '') : '';
        const meText = !meReq.ok ? await meReq.text().catch(() => '') : '';
        throw new Error(
          `oauth_profile_failed guilds=${guildReq.status} me=${meReq.status} guildBody=${guildText.slice(0, 120)} meBody=${meText.slice(0, 120)}`
        );
      }

      const userGuilds = await guildReq.json();
      const me = await meReq.json();

      const botGuildIds = client.guilds.cache.map((g) => g.id);
      const validGuilds = (userGuilds || []).filter(
        (g) => botGuildIds.includes(g.id) && (g.permissions & 8) === 8
      );

      const compactGuilds = validGuilds.map((g) => ({ id: g.id, name: g.name }));

      res.cookie(
        'user_session',
        sessionSigner.pack({ userId: me?.id || null, guilds: compactGuilds }, 24 * 60 * 60 * 1000),
        buildCookieOptions({ maxAge: 24 * 60 * 60 * 1000, httpOnly: true })
      );

      logSystem("Dashboard'a giris yapiliyor...", 'SUCCESS');
      return res.redirect(`${frontendOrigin}/dashboard`);
    } catch (error) {
      logError('oauth_callback_failed', error, { requestId: req.requestId });
      return res.redirect(`${frontendOrigin}/`);
    }
  });

  app.get('/api/auth/session', (req, res) => {
    const sess = parseUserSession(req);
    if (!sess || !Array.isArray(sess.guilds)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json({ guilds: sess.guilds });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('user_session', buildCookieOptions({ httpOnly: true }));
    res.clearCookie('oauth_state', buildCookieOptions({ httpOnly: true }));
    return res.json({ success: true });
  });

  app.get('/api/me', (req, res) => {
    const sess = parseUserSession(req);
    if (!sess || !Array.isArray(sess.guilds)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json({ authenticated: true, guilds: sess.guilds });
  });
}

module.exports = { registerAuthRoutes };

