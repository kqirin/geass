const { EmbedBuilder } = require('discord.js');
const {
  MAX_EMBED_TEXT_LEN,
  MAX_CONTENT_TEXT_LEN,
  isSnowflake,
  truncate,
  isValidHttpUrl,
} = require('./helpers');

function registerEmbedRoutes(app, { client, requireAuth, routeError }) {
  app.post('/api/embed/send', requireAuth, async (req, res) => {
    const { guildId, channelId, title, description, color, imageUrl, content } = req.body || {};
    if (!guildId || !channelId) return res.status(400).json({ error: 'Eksik veri' });
    if (!isSnowflake(guildId) || !isSnowflake(channelId)) {
      return res.status(400).json({ error: 'guildId veya channelId gecersiz', requestId: req.requestId });
    }

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ error: 'Sunucu yok' });

      const channel = guild.channels.cache.get(channelId);
      if (!channel) return res.status(404).json({ error: 'Kanal yok' });
      if (typeof channel.send !== 'function') {
        return res.status(400).json({ error: 'Mesaj gonderilemeyen kanal', requestId: req.requestId });
      }

      const safeTitle = truncate(title, 256);
      const safeDescription = truncate(description, MAX_EMBED_TEXT_LEN);
      const safeContent = truncate(content, MAX_CONTENT_TEXT_LEN);
      const safeImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';

      const hasTitle = safeTitle.length > 0;
      const hasDescription = safeDescription.length > 0;
      const hasImage = safeImageUrl.length > 0;
      const hasContent = safeContent.length > 0;

      if (!hasTitle && !hasDescription && !hasImage && !hasContent) {
        return res.status(400).json({ error: 'Icerik bos olamaz', requestId: req.requestId });
      }
      if (hasImage && !isValidHttpUrl(safeImageUrl)) {
        return res.status(400).json({ error: 'Gecersiz imageUrl', requestId: req.requestId });
      }

      const embed = new EmbedBuilder();
      if (hasTitle) embed.setTitle(safeTitle);
      if (hasDescription) embed.setDescription(safeDescription);
      if (color) {
        try {
          embed.setColor(color);
        } catch {}
      }
      if (hasImage) embed.setImage(safeImageUrl);

      const embeds = hasTitle || hasDescription || hasImage ? [embed] : [];
      await channel.send({
        content: hasContent ? safeContent : undefined,
        embeds,
        allowedMentions: { parse: [] },
      });

      return res.json({ success: true });
    } catch (err) {
      return routeError(res, req, 'embed_send_failed', err, 'Embed gonderilemedi');
    }
  });
}

module.exports = { registerEmbedRoutes };

