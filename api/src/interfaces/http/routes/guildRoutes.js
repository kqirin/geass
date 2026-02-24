const { isSnowflake } = require('./helpers');

function registerGuildRoutes(app, { client, requireAuth, routeError }) {
  app.get('/api/guilds/:id/stats', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const owner = guild.members.cache.get(guild.ownerId) || (await guild.fetchOwner().catch(() => null));
      const ownerName = owner ? owner.user.username : 'Bilinmiyor';

      const totalMembers = guild.memberCount || guild.members.cache.size;
      const activeMembers = guild.members.cache.filter((m) => m.presence?.status && m.presence.status !== 'offline').size;
      const inVoice = guild.members.cache.filter((m) => m.voice && m.voice.channelId).size;
      const boostCount = guild.premiumSubscriptionCount || 0;

      res.json({
        name: guild.name,
        icon: guild.iconURL({ dynamic: true }),
        ownerName,
        memberCount: totalMembers,
        activeMembers,
        voiceMembers: inVoice,
        boostCount,
        createdAt: guild.createdAt,
      });
    } catch (err) {
      return routeError(res, req, 'stats_failed', err, 'Stats cekilemedi');
    }
  });

  app.get('/api/guilds/:id/channels', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const validChannels = guild.channels.cache
        .filter((c) => c.type === 0 || c.type === 2)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name }));

      res.json(validChannels);
    } catch (err) {
      return routeError(res, req, 'channels_failed', err, 'Kanallar cekilemedi');
    }
  });

  app.get('/api/guilds/:id/roles', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const roles = guild.roles.cache
        .filter((r) => r && r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name }));
      return res.json(roles);
    } catch (err) {
      return routeError(res, req, 'roles_failed', err, 'Roller cekilemedi');
    }
  });

  app.get('/api/guilds/:id/emojis', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi' });

    try {
      const emojis = guild.emojis.cache
        .map((e) => ({
          id: e.id,
          name: e.name,
          animated: Boolean(e.animated),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.json(emojis);
    } catch (err) {
      return routeError(res, req, 'emojis_failed', err, 'Emojiler cekilemedi');
    }
  });
}

module.exports = { registerGuildRoutes };

