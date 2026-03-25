const cache = require('../../../utils/cache');
const { MAX_COMMAND_NAME_LEN, MAX_COMMAND_RESPONSE_LEN, isSnowflake, truncate } = require('./helpers');
const commandRepository = require('../../../infrastructure/repositories/commandRepository');
const { BUILTIN_COMMAND_NAME_SET } = require('../../../bot/builtinCommands');

function isReservedCommandName(guildId, commandName) {
  const safeName = String(commandName || '').trim().toLowerCase();
  if (!safeName) return false;
  if (BUILTIN_COMMAND_NAME_SET.has(safeName)) return true;

  const settings = cache.getSettings(guildId) || {};
  const dynamicPrefix = String(settings.prefix || '.').trim();
  const prefixCandidates = new Set([dynamicPrefix, '.', '!', '/'].filter(Boolean));

  for (const prefix of prefixCandidates) {
    if (!safeName.startsWith(prefix)) continue;
    const withoutPrefix = safeName.slice(prefix.length).trim();
    if (BUILTIN_COMMAND_NAME_SET.has(withoutPrefix)) return true;
  }

  return false;
}

function registerCommandRoutes(app, { requireAuth, routeError, logError = () => {} }) {
  function appendWarning(existing, next) {
    const cleanNext = String(next || '').trim();
    if (!cleanNext) return existing || null;
    if (!existing) return cleanNext;
    if (existing.includes(cleanNext)) return existing;
    return `${existing} ${cleanNext}`.trim();
  }

  app.get('/api/commands/:id', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) {
      return res.status(400).json({ error: 'Gecersiz sunucu ID', requestId: req.requestId });
    }
    try {
      const rows = await commandRepository.getGuildCommands(req.params.id);
      return res.json(rows || []);
    } catch (err) {
      return routeError(res, req, 'commands_get_failed', err, 'SQL Hatasi');
    }
  });

  app.post('/api/commands/:id', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) {
      return res.status(400).json({ error: 'Gecersiz sunucu ID', requestId: req.requestId });
    }
    const { command_name, command_response } = req.body || {};
    if (!command_name || !command_response) return res.status(400).json({ error: 'Eksik veri' });

    try {
      const normalizedName = truncate(command_name, MAX_COMMAND_NAME_LEN).toLowerCase();
      const normalizedResponse = truncate(command_response, MAX_COMMAND_RESPONSE_LEN);
      if (!/^[\w.-]{1,32}$/.test(normalizedName)) {
        return res.status(400).json({ error: 'Komut adi gecersiz', requestId: req.requestId });
      }
      if (!normalizedResponse) {
        return res.status(400).json({ error: 'Komut cevabi bos olamaz', requestId: req.requestId });
      }
      if (isReservedCommandName(req.params.id, normalizedName)) {
        return res.status(400).json({
          error: 'Bu komut adi ayrilmis bir sistem komutuyla cakisiyor',
          requestId: req.requestId,
        });
      }

      await commandRepository.upsertGuildCommand(req.params.id, normalizedName, normalizedResponse);
      let warning = null;
      try {
        await commandRepository.insertCommandAudit(
          req.params.id,
          normalizedName,
          'UPSERT',
          req.userSession?.userId || null,
          `req=${req.requestId}`
        );
      } catch (err) {
        logError('commands_add_audit_failed', err, {
          guildId: req.params.id,
          commandName: normalizedName,
          requestId: req.requestId,
        });
        warning = appendWarning(warning, 'Komut kaydedildi ancak audit kaydi yazilamadi.');
      }
      try {
        cache.upsertCustomCommand(req.params.id, normalizedName, normalizedResponse);
      } catch (err) {
        logError('commands_add_cache_failed', err, {
          guildId: req.params.id,
          commandName: normalizedName,
          requestId: req.requestId,
        });
        warning = appendWarning(warning, 'Komut kaydedildi ancak runtime cache hemen guncellenemedi.');
      }
      return res.json({ success: true, partial: Boolean(warning), warning });
    } catch (err) {
      return routeError(res, req, 'commands_add_failed', err, 'Eklenemedi');
    }
  });

  app.delete('/api/commands/:id/:name', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) {
      return res.status(400).json({ error: 'Gecersiz sunucu ID', requestId: req.requestId });
    }
    try {
      const normalizedName = truncate(req.params.name, MAX_COMMAND_NAME_LEN).toLowerCase();
      if (!/^[\w.-]{1,32}$/.test(normalizedName)) {
        return res.status(400).json({ error: 'Komut adi gecersiz', requestId: req.requestId });
      }

      await commandRepository.deleteGuildCommand(req.params.id, normalizedName);
      let warning = null;
      try {
        await commandRepository.insertCommandAudit(
          req.params.id,
          normalizedName,
          'DELETE',
          req.userSession?.userId || null,
          `req=${req.requestId}`
        );
      } catch (err) {
        logError('commands_delete_audit_failed', err, {
          guildId: req.params.id,
          commandName: normalizedName,
          requestId: req.requestId,
        });
        warning = appendWarning(warning, 'Komut silindi ancak audit kaydi yazilamadi.');
      }
      try {
        cache.removeCustomCommand(req.params.id, normalizedName);
      } catch (err) {
        logError('commands_delete_cache_failed', err, {
          guildId: req.params.id,
          commandName: normalizedName,
          requestId: req.requestId,
        });
        warning = appendWarning(warning, 'Komut silindi ancak runtime cache hemen guncellenemedi.');
      }
      return res.json({ success: true, partial: Boolean(warning), warning });
    } catch (err) {
      return routeError(res, req, 'commands_delete_failed', err, 'Silinemedi');
    }
  });
}

module.exports = {
  registerCommandRoutes,
  isReservedCommandName,
};
