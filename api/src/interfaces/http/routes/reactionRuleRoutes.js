const reactionRuleRepository = require('../../../infrastructure/repositories/reactionRuleRepository');
const { isReactionMatch } = require('../../../application/reactionActions/emoji');

const ACTION_TYPES = new Set([
  'ROLE_ADD',
  'ROLE_REMOVE',
  'DM_SEND',
  'REPLY',
  'CHANNEL_LINK',
  'RUN_INTERNAL_COMMAND',
  'REMOVE_OTHER_REACTIONS_IN_GROUP',
]);

function isSnowflake(value) {
  return /^\d{5,32}$/.test(String(value || '').trim());
}

function toIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter((x) => isSnowflake(x));
}

function sanitizeActions(rawActions) {
  if (!Array.isArray(rawActions)) return [];
  const out = [];
  for (const item of rawActions) {
    const type = String(item?.type || '').trim().toUpperCase();
    if (!ACTION_TYPES.has(type)) continue;
    const payload = typeof item?.payload === 'object' && item.payload !== null ? item.payload : {};
    out.push({ type, payload });
  }
  return out.slice(0, 20);
}

function sanitizeRuleInput(input = {}) {
  const emojiType = input.emojiType === 'custom' ? 'custom' : 'unicode';
  const triggerMode = ['ADD', 'REMOVE', 'TOGGLE'].includes(String(input.triggerMode || '').toUpperCase())
    ? String(input.triggerMode).toUpperCase()
    : 'TOGGLE';
  const actions = sanitizeActions(input.actions);
  return {
    guildId: String(input.guildId || ''),
    channelId: String(input.channelId || ''),
    messageId: String(input.messageId || ''),
    emojiType,
    emojiId: emojiType === 'custom' ? String(input.emojiId || '') || null : null,
    emojiName: emojiType === 'unicode' ? String(input.emojiName || '').trim() : String(input.emojiName || '').trim() || null,
    triggerMode,
    enabled: Boolean(input.enabled ?? true),
    cooldownSeconds: Math.min(Math.max(Number(input.cooldownSeconds || 0), 0), 3600),
    onlyOnce: Boolean(input.onlyOnce),
    groupKey: String(input.groupKey || '').trim().slice(0, 64) || null,
    allowedRoles: toIdList(input.allowedRoles),
    excludedRoles: toIdList(input.excludedRoles),
    actions,
  };
}

function validateRuleInput(input) {
  if (!isSnowflake(input.guildId)) return 'guildId gecersiz';
  if (!isSnowflake(input.channelId)) return 'channelId gecersiz';
  if (!isSnowflake(input.messageId)) return 'messageId gecersiz';
  if (input.emojiType === 'custom' && !isSnowflake(input.emojiId || '')) return 'emojiId gecersiz';
  if (input.emojiType === 'unicode' && !(input.emojiName || '').length) return 'emojiName gerekli';
  if (!Array.isArray(input.actions) || input.actions.length === 0) return 'en az bir aksiyon gerekli';
  return null;
}

function parseDiscordErrorCode(err) {
  const raw = err?.rawError?.code ?? err?.code;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function mapReactionSetupError(err) {
  const code = parseDiscordErrorCode(err);
  if (code === 50013) return 'Botun bu kanalda Mesajlari Goruntule, Gecmisi Oku ve Tepki Ekle izni olmali';
  if (code === 10008) return 'Mesaj bulunamadi';
  if (code === 10003) return 'Kanal bulunamadi';
  if (code === 10014) return 'Emoji bulunamadi';
  if (code === 50001) return 'Botun bu kaynaga erisimi yok';
  return 'Bot bu mesaja secilen emojiyi ekleyemedi';
}

function mapReactionCleanupWarning(err) {
  const code = parseDiscordErrorCode(err);
  if (code === 50013) return 'Emoji temizleme kisitli: botta Manage Messages izni yok olabilir';
  if (code === 10008) return 'Emoji temizleme atlandi: mesaj bulunamadi';
  if (code === 10003) return 'Emoji temizleme atlandi: kanal bulunamadi';
  if (code === 50001) return 'Emoji temizleme atlandi: botun erisimi yok';
  return 'Emoji temizleme tamamlanamadi';
}

function toEmojiIdentifier(input) {
  if (input.emojiType === 'custom') {
    const id = String(input.emojiId || '').trim();
    const name = String(input.emojiName || '').trim();
    if (!id) return null;
    return name ? `${name}:${id}` : id;
  }
  const name = String(input.emojiName || '').trim();
  return name || null;
}

function getRuleTargetKey(ruleLike) {
  if (!ruleLike) return '';
  return `${ruleLike.channelId}:${ruleLike.messageId}:${ruleLike.emojiType}:${ruleLike.emojiId || ''}:${ruleLike.emojiName || ''}`;
}

async function ensureRuleReactionOnMessage(client, input) {
  const guild = client.guilds.cache.get(input.guildId) || (await client.guilds.fetch(input.guildId).catch(() => null));
  if (!guild) return { ok: false, error: 'Sunucu bulunamadi' };

  const channel = guild.channels.cache.get(input.channelId) || (await guild.channels.fetch(input.channelId).catch(() => null));
  if (!channel) return { ok: false, error: 'Kanal bulunamadi' };
  if (!channel.isTextBased?.()) return { ok: false, error: 'Kanal mesaj desteklemiyor' };

  const message = await channel.messages.fetch(input.messageId).catch(() => null);
  if (!message) return { ok: false, error: 'Mesaj bulunamadi' };

  const emoji = toEmojiIdentifier(input);
  if (!emoji) return { ok: false, error: 'Emoji gecersiz' };

  try {
    await message.react(emoji);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapReactionSetupError(err) };
  }
}

async function removeRuleReactionFromMessage(client, ruleLike) {
  const guild = client.guilds.cache.get(ruleLike.guildId) || (await client.guilds.fetch(ruleLike.guildId).catch(() => null));
  if (!guild) return { ok: true };

  const channel = guild.channels.cache.get(ruleLike.channelId) || (await guild.channels.fetch(ruleLike.channelId).catch(() => null));
  if (!channel || !channel.isTextBased?.()) return { ok: true };

  const message = await channel.messages.fetch(ruleLike.messageId).catch(() => null);
  if (!message) return { ok: true };

  const ensureCached = async (msg) => {
    const mgr = msg?.reactions;
    if (!mgr) return null;

    if (typeof mgr.fetch === 'function') {
      await mgr.fetch().catch(() => null);
      return mgr.cache?.find?.((r) => isReactionMatch(ruleLike, r)) || null;
    }

    if (typeof msg.fetch === 'function') {
      const refreshed = await msg.fetch().catch(() => null);
      const refreshedMgr = refreshed?.reactions;
      if (typeof refreshedMgr?.fetch === 'function') {
        await refreshedMgr.fetch().catch(() => null);
      }
      return refreshedMgr?.cache?.find?.((r) => isReactionMatch(ruleLike, r)) || null;
    }

    return mgr.cache?.find?.((r) => isReactionMatch(ruleLike, r)) || null;
  };

  let targetReaction = message.reactions?.cache?.find?.((r) => isReactionMatch(ruleLike, r)) || null;
  if (!targetReaction) targetReaction = await ensureCached(message);
  if (!targetReaction) return { ok: true };

  const botUserId = client.user?.id;
  if (!botUserId) return { ok: true };

  try {
    // First try removing the whole reaction bucket from the message.
    // This clears all users for that emoji (needs Manage Messages).
    await targetReaction.remove();
    return { ok: true, mode: 'all' };
  } catch (err) {
    try {
      // Fallback: at least remove bot's own reaction if full removal fails.
      await targetReaction.users.remove(botUserId);
      return {
        ok: true,
        mode: 'bot_only',
        warning: mapReactionCleanupWarning(err),
      };
    } catch (fallbackErr) {
      return {
        ok: false,
        error: mapReactionSetupError(fallbackErr || err),
        warning: mapReactionCleanupWarning(fallbackErr || err),
      };
    }
  }
}

function attachGuildIdFromQuery(req, _res, next) {
  if (!req.params.guildId && req.query?.guildId) req.params.guildId = String(req.query.guildId);
  next();
}

async function hasGuildAdminAccess(client, req, guildId) {
  const sess = req.userSession;
  if (!sess?.userId || !Array.isArray(sess.guilds)) return false;
  if (!sess.guilds.some((g) => g.id === guildId)) return false;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return false;
  const member = await guild.members.fetch(sess.userId).catch(() => null);
  return member?.permissions?.has?.('Administrator') === true;
}

function registerReactionRuleRoutes(app, { client, requireAuth, routeError, reactionActionService }) {
  app.get('/api/reaction-rules', attachGuildIdFromQuery, requireAuth, async (req, res) => {
    try {
      const guildId = String(req.query.guildId || req.params.guildId || '');
      if (!isSnowflake(guildId)) {
        return res.status(400).json({ error: 'guildId gecersiz', requestId: req.requestId });
      }
      const rules = await reactionRuleRepository.listRulesByGuild(guildId);
      return res.json(rules);
    } catch (err) {
      return routeError(res, req, 'reaction_rules_list_failed', err, 'Kurallar alinamadi');
    }
  });

  app.post('/api/reaction-rules', requireAuth, async (req, res) => {
    try {
      const input = sanitizeRuleInput(req.body || {});
      const validationError = validateRuleInput(input);
      if (validationError) return res.status(400).json({ error: validationError, requestId: req.requestId });

      const guild = client.guilds.cache.get(input.guildId);
      if (!guild) return res.status(404).json({ error: 'Sunucu bulunamadi', requestId: req.requestId });

      const reactionSetup = await ensureRuleReactionOnMessage(client, input);
      if (!reactionSetup.ok) {
        return res.status(400).json({ error: reactionSetup.error, requestId: req.requestId });
      }

      const created = await reactionRuleRepository.createRule({ ...input, createdBy: req.userSession?.userId || null });
      reactionActionService?.invalidateGuildCache(input.guildId);
      await reactionActionService?.refreshGuildRules(input.guildId);
      return res.json({ success: true, rule: created });
    } catch (err) {
      return routeError(res, req, 'reaction_rule_create_failed', err, 'Kural olusturulamadi');
    }
  });

  app.put('/api/reaction-rules/:ruleId', requireAuth, async (req, res) => {
    try {
      if (!/^\d+$/.test(String(req.params.ruleId || ''))) {
        return res.status(400).json({ error: 'ruleId gecersiz', requestId: req.requestId });
      }
      const existing = await reactionRuleRepository.getRuleById(req.params.ruleId);
      if (!existing) return res.status(404).json({ error: 'Kural bulunamadi', requestId: req.requestId });
      if (!(await hasGuildAdminAccess(client, req, existing.guildId))) {
        return res.status(403).json({ error: 'Forbidden', requestId: req.requestId });
      }

      const input = sanitizeRuleInput({ ...(req.body || {}), guildId: existing.guildId });
      const validationError = validateRuleInput(input);
      if (validationError) return res.status(400).json({ error: validationError, requestId: req.requestId });

      const reactionSetup = await ensureRuleReactionOnMessage(client, input);
      if (!reactionSetup.ok) {
        return res.status(400).json({ error: reactionSetup.error, requestId: req.requestId });
      }

      const updated = await reactionRuleRepository.updateRule(req.params.ruleId, input);
      let cleanupWarning = null;
      if (getRuleTargetKey(existing) !== getRuleTargetKey(input)) {
        const cleanup = await removeRuleReactionFromMessage(client, existing);
        cleanupWarning = cleanup?.warning || (!cleanup?.ok ? cleanup?.error : null);
      }
      reactionActionService?.invalidateGuildCache(existing.guildId);
      await reactionActionService?.refreshGuildRules(existing.guildId);
      return res.json({ success: true, rule: updated, warning: cleanupWarning || null });
    } catch (err) {
      return routeError(res, req, 'reaction_rule_update_failed', err, 'Kural guncellenemedi');
    }
  });

  app.delete('/api/reaction-rules/:ruleId', requireAuth, async (req, res) => {
    try {
      if (!/^\d+$/.test(String(req.params.ruleId || ''))) {
        return res.status(400).json({ error: 'ruleId gecersiz', requestId: req.requestId });
      }
      const existing = await reactionRuleRepository.getRuleById(req.params.ruleId);
      if (!existing) return res.status(404).json({ error: 'Kural bulunamadi', requestId: req.requestId });
      if (!(await hasGuildAdminAccess(client, req, existing.guildId))) {
        return res.status(403).json({ error: 'Forbidden', requestId: req.requestId });
      }

      const cleanup = await removeRuleReactionFromMessage(client, existing);
      await reactionRuleRepository.deleteRule(req.params.ruleId, existing.guildId);
      reactionActionService?.invalidateGuildCache(existing.guildId);
      await reactionActionService?.refreshGuildRules(existing.guildId);
      const warning = cleanup?.warning || (!cleanup?.ok ? cleanup?.error : null);
      return res.json({ success: true, warning: warning || null });
    } catch (err) {
      return routeError(res, req, 'reaction_rule_delete_failed', err, 'Kural silinemedi');
    }
  });

  app.post('/api/reaction-rules/:ruleId/test', requireAuth, async (req, res) => {
    try {
      if (!/^\d+$/.test(String(req.params.ruleId || ''))) {
        return res.status(400).json({ error: 'ruleId gecersiz', requestId: req.requestId });
      }
      const existing = await reactionRuleRepository.getRuleById(req.params.ruleId);
      if (!existing) return res.status(404).json({ error: 'Kural bulunamadi', requestId: req.requestId });
      if (!(await hasGuildAdminAccess(client, req, existing.guildId))) {
        return res.status(403).json({ error: 'Forbidden', requestId: req.requestId });
      }

      if (!reactionActionService) return res.status(503).json({ error: 'Reaction service aktif degil', requestId: req.requestId });
      const health = await reactionActionService.getHealth(existing.guildId);
      const guild = client.guilds.cache.get(existing.guildId) || (await client.guilds.fetch(existing.guildId).catch(() => null));
      const requester = guild ? await guild.members.fetch(req.userSession?.userId || '').catch(() => null) : null;
      const requesterCheck = requester
        ? {
            userId: requester.id,
            manageable: Boolean(requester.manageable),
            isOwner: guild?.ownerId === requester.id,
            highestRolePosition: requester.roles?.highest?.position ?? null,
          }
        : null;
      return res.json({ success: true, dryRun: true, health, requesterCheck });
    } catch (err) {
      return routeError(res, req, 'reaction_rule_test_failed', err, 'Kural test edilemedi');
    }
  });

  app.get('/api/reaction-rules/health', attachGuildIdFromQuery, requireAuth, async (req, res) => {
    try {
      const guildId = String(req.query.guildId || req.params.guildId || '');
      if (!isSnowflake(guildId)) {
        return res.status(400).json({ error: 'guildId gecersiz', requestId: req.requestId });
      }
      if (!reactionActionService) return res.status(503).json({ error: 'Reaction service aktif degil', requestId: req.requestId });
      const health = await reactionActionService.getHealth(guildId);
      return res.json(health);
    } catch (err) {
      return routeError(res, req, 'reaction_rule_health_failed', err, 'Saglik kontrolu alinamadi');
    }
  });
}

module.exports = { registerReactionRuleRoutes };
