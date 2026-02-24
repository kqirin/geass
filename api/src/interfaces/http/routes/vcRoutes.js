const voiceManager = require('../../../voice/voiceManager');
const privateVoiceRepository = require('../../../infrastructure/repositories/privateVoiceRepository');

function normalizeId(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  return /^\d{5,32}$/.test(clean) ? clean : null;
}

function sanitizePrivateConfigInput(input = {}) {
  return {
    enabled: Boolean(input.enabled),
    hubChannelId: normalizeId(input.hubChannelId),
    requiredRoleId: normalizeId(input.requiredRoleId),
    categoryId: normalizeId(input.categoryId),
  };
}

function registerVcRoutes(app, { client, requireAuth, routeError, logError, singleGuildId, privateRoomService = null }) {
  app.get('/api/vc/private/:guildId/config', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!normalizeId(guildId)) return res.status(400).json({ error: 'Gecersiz guildId', requestId: req.requestId });
    if (singleGuildId && guildId !== singleGuildId) return res.status(403).json({ error: 'Forbidden' });

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const config = await privateVoiceRepository.getGuildConfig(guildId);
      return res.json(config);
    } catch (err) {
      return routeError(res, req, 'private_vc_config_get_failed', err, 'Ozel oda ayarlari alinamadi');
    }
  });

  app.post('/api/vc/private/:guildId/config', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!normalizeId(guildId)) return res.status(400).json({ error: 'Gecersiz guildId', requestId: req.requestId });
    if (singleGuildId && guildId !== singleGuildId) return res.status(403).json({ error: 'Forbidden' });

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    const nextConfig = sanitizePrivateConfigInput(req.body || {});
    if (nextConfig.enabled && (!nextConfig.hubChannelId || !nextConfig.requiredRoleId)) {
      return res.status(400).json({
        error: 'Aktif durumda hubChannelId ve requiredRoleId zorunlu',
        requestId: req.requestId,
      });
    }

    try {
      if (nextConfig.hubChannelId) {
        const hub = guild.channels.cache.get(nextConfig.hubChannelId) || (await guild.channels.fetch(nextConfig.hubChannelId).catch(() => null));
        if (!hub || (hub.type !== 2 && hub.type !== 13)) {
          return res.status(400).json({ error: 'Hub kanali ses/stage olmalidir', requestId: req.requestId });
        }
      }

      if (nextConfig.categoryId) {
        const category =
          guild.channels.cache.get(nextConfig.categoryId) || (await guild.channels.fetch(nextConfig.categoryId).catch(() => null));
        if (!category || category.type !== 4) {
          return res.status(400).json({ error: 'Kategori gecersiz', requestId: req.requestId });
        }
      }

      if (nextConfig.requiredRoleId) {
        const role = guild.roles.cache.get(nextConfig.requiredRoleId) || (await guild.roles.fetch(nextConfig.requiredRoleId).catch(() => null));
        if (!role) {
          return res.status(400).json({ error: 'Gerekli rol bulunamadi', requestId: req.requestId });
        }
      }

      await privateVoiceRepository.upsertGuildConfig(guildId, nextConfig);
      privateRoomService?.invalidateConfig?.(guildId);

      return res.json({ success: true, config: nextConfig });
    } catch (err) {
      return routeError(res, req, 'private_vc_config_save_failed', err, 'Ozel oda ayarlari kaydedilemedi');
    }
  });

  app.get('/api/vc/voice-channels/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!normalizeId(guildId)) return res.status(400).json({ error: 'Gecersiz guildId', requestId: req.requestId });
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const categories = guild.channels.cache
        .filter((c) => c.type === 4)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name, pos: c.rawPosition }));

      const voiceCh = guild.channels.cache
        .filter((c) => c.type === 2 || c.type === 13)
        .map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId || null,
          pos: c.rawPosition,
          kind: c.type === 13 ? 'stage' : 'voice',
        }));

      const byCat = new Map();
      for (const v of voiceCh) {
        const key = v.parentId || 'NO_CATEGORY';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(v);
      }

      for (const [k, arr] of byCat) {
        arr.sort((a, b) => a.pos - b.pos);
        byCat.set(k, arr);
      }

      const groups = [];
      if (byCat.has('NO_CATEGORY')) {
        groups.push({ categoryId: null, categoryName: null, channels: byCat.get('NO_CATEGORY') });
      }

      for (const cat of categories) {
        const list = byCat.get(cat.id);
        if (list && list.length) groups.push({ categoryId: cat.id, categoryName: cat.name, channels: list });
      }

      return res.json(groups);
    } catch (err) {
      return routeError(res, req, 'voice_channels_failed', err, 'Ses kanallari cekilemedi');
    }
  });

  app.get('/api/vc/status/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!normalizeId(guildId)) return res.status(400).json({ error: 'Gecersiz guildId', requestId: req.requestId });
    if (singleGuildId && guildId !== singleGuildId) return res.status(403).json({ error: 'Forbidden' });
    return res.json(voiceManager.getStatus(guildId, client));
  });

  app.post('/api/vc/connect/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    const { channelId } = req.body || {};
    if (!channelId) return res.status(400).json({ error: 'channelId gerekli' });
    if (!normalizeId(guildId) || !normalizeId(channelId)) {
      return res.status(400).json({ error: 'guildId/channelId gecersiz', requestId: req.requestId });
    }
    if (singleGuildId && guildId !== singleGuildId) return res.status(403).json({ error: 'Forbidden' });

    try {
      await voiceManager.connectToChannel({ client, guildId, channelId, selfDeaf: true });
      return res.json({ success: true, status: voiceManager.getStatus(guildId, client) });
    } catch (err) {
      logError('voice_connect_failed', err, { guildId, requestId: req.requestId });
      return res.status(500).json({ error: err.message || 'Baglanilamadi', requestId: req.requestId });
    }
  });

  app.post('/api/vc/disconnect/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!normalizeId(guildId)) return res.status(400).json({ error: 'Gecersiz guildId', requestId: req.requestId });
    if (singleGuildId && guildId !== singleGuildId) return res.status(403).json({ error: 'Forbidden' });

    try {
      await voiceManager.disconnect({ guildId });
      return res.json({ success: true, status: voiceManager.getStatus(guildId, client) });
    } catch (err) {
      return routeError(res, req, 'voice_disconnect_failed', err, 'Baglanti kesilemedi');
    }
  });
}

module.exports = { registerVcRoutes };

