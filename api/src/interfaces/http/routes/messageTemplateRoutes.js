const cache = require('../../../utils/cache');
const {
  upsertMessageTemplates: upsertMessageTemplatesRepo,
  deleteMessageTemplates: deleteMessageTemplatesRepo,
} = require('../../../infrastructure/repositories/messageTemplateRepository');
const {
  TEMPLATE_SCOPE_GLOBAL,
  TEMPLATE_SCOPE_COMMAND,
  TEMPLATE_VARIABLES,
  normalizeCommandName,
  isSupportedMessageCommand,
  getMessageCommandCatalog,
  getTemplateKeyMetaForCommand,
  getTemplateKeyMetaForGlobal,
} = require('../../../application/messages/catalog');
const {
  resolveTemplatesForScope,
  sanitizeTemplatesPayload,
} = require('../../../application/messages/templateService');

function isSnowflake(value) {
  return /^\d{5,32}$/.test(String(value || '').trim());
}

function normalizeScope(scopeRaw) {
  return scopeRaw === TEMPLATE_SCOPE_COMMAND ? TEMPLATE_SCOPE_COMMAND : TEMPLATE_SCOPE_GLOBAL;
}

function validateScopeAndCommand(scope, commandName) {
  if (scope === TEMPLATE_SCOPE_GLOBAL) return { ok: true, commandName: '' };
  const normalized = normalizeCommandName(commandName);
  if (!normalized) return { ok: false, error: 'commandName gerekli' };
  if (!isSupportedMessageCommand(normalized)) return { ok: false, error: 'Gecersiz commandName' };
  return { ok: true, commandName: normalized };
}

function registerMessageTemplateRoutes(app, { requireAuth, routeError }) {
  app.get('/api/messages/commands/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    try {
      return res.json({
        guildId,
        commands: getMessageCommandCatalog(),
        globalTemplateKeys: getTemplateKeyMetaForGlobal(),
        variables: TEMPLATE_VARIABLES,
      });
    } catch (err) {
      return routeError(res, req, 'message_commands_failed', err, 'Komut listesi alinamadi');
    }
  });

  app.get('/api/messages/templates/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const scope = normalizeScope(req.query.scope);
    const check = validateScopeAndCommand(scope, req.query.commandName);
    if (!check.ok) return res.status(400).json({ error: check.error, requestId: req.requestId });

    try {
      const resolved = resolveTemplatesForScope({
        cache,
        guildId,
        scope,
        commandName: check.commandName,
      });
      const templateKeys =
        scope === TEMPLATE_SCOPE_COMMAND
          ? getTemplateKeyMetaForCommand(check.commandName)
          : getTemplateKeyMetaForGlobal();

      return res.json({
        guildId,
        scope,
        commandName: check.commandName,
        templateKeys,
        storedTemplates: resolved.storedTemplates,
        resolvedTemplates: resolved.resolvedTemplates,
      });
    } catch (err) {
      return routeError(res, req, 'message_templates_get_failed', err, 'Mesaj sablonlari alinamadi');
    }
  });

  app.post('/api/messages/templates/:guildId', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const scope = normalizeScope(req.body?.scope);
    const check = validateScopeAndCommand(scope, req.body?.commandName);
    if (!check.ok) return res.status(400).json({ error: check.error, requestId: req.requestId });

    const payload = sanitizeTemplatesPayload({
      templates: req.body?.templates || {},
      scope,
      commandName: check.commandName,
    });
    if (!payload.ok) return res.status(400).json({ error: payload.error, requestId: req.requestId });

    try {
      if (Object.keys(payload.templates).length === 0) {
        await deleteMessageTemplatesRepo(guildId, scope, check.commandName);
        cache.resetMessageTemplates(guildId, scope, check.commandName);
      } else {
        await upsertMessageTemplatesRepo(guildId, scope, check.commandName, JSON.stringify(payload.templates));
        cache.upsertMessageTemplates(guildId, scope, check.commandName, payload.templates);
      }

      return res.json({ success: true });
    } catch (err) {
      return routeError(res, req, 'message_templates_save_failed', err, 'Mesaj sablonu kaydedilemedi');
    }
  });

  app.post('/api/messages/templates/:guildId/reset', requireAuth, async (req, res) => {
    const guildId = req.params.guildId;
    if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    const scope = normalizeScope(req.body?.scope);
    const check = validateScopeAndCommand(scope, req.body?.commandName);
    if (!check.ok) return res.status(400).json({ error: check.error, requestId: req.requestId });

    try {
      await deleteMessageTemplatesRepo(guildId, scope, check.commandName);
      cache.resetMessageTemplates(guildId, scope, check.commandName);
      return res.json({ success: true });
    } catch (err) {
      return routeError(res, req, 'message_templates_reset_failed', err, 'Mesaj sablonu sifirlanamadi');
    }
  });
}

module.exports = { registerMessageTemplateRoutes };
