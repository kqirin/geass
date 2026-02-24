const cache = require('../../../utils/cache');
const { MAX_COMMAND_NAME_LEN, MAX_COMMAND_RESPONSE_LEN, isSnowflake, truncate } = require('./helpers');
const {
  getGuildCommands,
  upsertGuildCommand,
  deleteGuildCommand,
  insertCommandAudit,
} = require('../../../infrastructure/repositories/commandRepository');

function registerCommandRoutes(app, { requireAuth, routeError }) {
  app.get('/api/commands/:id', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    try {
      const rows = await getGuildCommands(req.params.id);
      return res.json(rows || []);
    } catch (err) {
      return routeError(res, req, 'commands_get_failed', err, 'SQL Hatasi');
    }
  });

  app.post('/api/commands/:id', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
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

      await upsertGuildCommand(req.params.id, normalizedName, normalizedResponse);
      await insertCommandAudit(req.params.id, normalizedName, 'UPSERT', req.userSession?.userId || null, `req=${req.requestId}`);
      cache.upsertCustomCommand(req.params.id, normalizedName, normalizedResponse);
      return res.json({ success: true });
    } catch (err) {
      return routeError(res, req, 'commands_add_failed', err, 'Eklenemedi');
    }
  });

  app.delete('/api/commands/:id/:name', requireAuth, async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: 'Gecersiz sunucu id', requestId: req.requestId });
    try {
      const normalizedName = truncate(req.params.name, MAX_COMMAND_NAME_LEN).toLowerCase();
      if (!/^[\w.-]{1,32}$/.test(normalizedName)) {
        return res.status(400).json({ error: 'Komut adi gecersiz', requestId: req.requestId });
      }

      await deleteGuildCommand(req.params.id, normalizedName);
      await insertCommandAudit(req.params.id, normalizedName, 'DELETE', req.userSession?.userId || null, `req=${req.requestId}`);
      cache.removeCustomCommand(req.params.id, normalizedName);
      return res.json({ success: true });
    } catch (err) {
      return routeError(res, req, 'commands_delete_failed', err, 'Silinemedi');
    }
  });
}

module.exports = { registerCommandRoutes };

