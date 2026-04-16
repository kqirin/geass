const { createRequireGuildAccess, requireAuth, withBoundaryChecks } = require('./authBoundary');
const {
  MutationPipelineError,
  createMutationOriginGuard,
  createMutationPipeline,
} = require('./mutationPipeline');
const { createInMemoryMutationAuditRecorder } = require('./mutationAudit');
const {
  BOT_COMMAND_KEY_DURUM,
  BOT_STATUS_DETAIL_MODE_COMPACT,
  BOT_STATUS_DETAIL_MODE_LEGACY,
  createDefaultGuildBotSettings,
  getSharedBotSettingsRepository,
  normalizeCommandSettings,
  normalizeGuildBotSettings,
  normalizeStatusCommandSettings,
  toEffectiveDurumCommandSettings,
  toEffectiveStatusCommandSettings,
} = require('./botSettingsRepository');
const {
  RequestValidationError,
  assertPlainObject,
} = require('./requestValidation');
const { resolveDashboardGuildScope } = require('./guildScope');

const BOT_STATUS_SETTINGS_PATH = '/api/dashboard/protected/bot-settings/status-command';
const BOT_STATUS_SETTINGS_MUTATION_TYPE = 'bot_status_settings_upsert';
const BOT_COMMAND_SETTINGS_PATH = '/api/dashboard/protected/bot-settings/commands';
const BOT_COMMAND_SETTINGS_MUTATION_TYPE = 'bot_command_settings_upsert';
const BOT_SETTINGS_MAX_BODY_BYTES = 2 * 1024;

function createValidationError({
  reasonCode = 'invalid_request_body',
  field = null,
  statusCode = 400,
  errorCode = 'invalid_request_body',
} = {}) {
  return new RequestValidationError('Bot settings request is invalid.', {
    statusCode,
    errorCode,
    details: {
      reasonCode: String(reasonCode || 'invalid_request_body'),
      ...(field ? { field: String(field) } : {}),
    },
  });
}

function ensureNoUnknownFields(payload = {}, allowedFields = new Set(), prefix = '') {
  for (const field of Object.keys(payload)) {
    if (allowedFields.has(field)) continue;
    throw createValidationError({
      reasonCode: 'unknown_field',
      field: prefix ? `${prefix}.${field}` : field,
    });
  }
}

function normalizeDetailModePatch(rawValue) {
  if (rawValue === null) return null;
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field: 'settings.detailMode',
    });
  }

  const normalizedValue = String(rawValue || '').trim().toLowerCase();
  if (!normalizedValue) {
    throw createValidationError({
      reasonCode: 'invalid_enum_value',
      field: 'settings.detailMode',
    });
  }
  if (normalizedValue === BOT_STATUS_DETAIL_MODE_LEGACY) {
    return null;
  }
  if (normalizedValue === BOT_STATUS_DETAIL_MODE_COMPACT) {
    return BOT_STATUS_DETAIL_MODE_COMPACT;
  }

  throw createValidationError({
    reasonCode: 'invalid_enum_value',
    field: 'settings.detailMode',
  });
}

function normalizeCommandDetailModePatch(rawValue) {
  if (rawValue === null) return null;
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field: `commands.${BOT_COMMAND_KEY_DURUM}.detailMode`,
    });
  }

  const normalizedValue = String(rawValue || '').trim().toLowerCase();
  if (!normalizedValue) {
    throw createValidationError({
      reasonCode: 'invalid_enum_value',
      field: `commands.${BOT_COMMAND_KEY_DURUM}.detailMode`,
    });
  }
  if (normalizedValue === BOT_STATUS_DETAIL_MODE_LEGACY) {
    return null;
  }
  if (normalizedValue === BOT_STATUS_DETAIL_MODE_COMPACT) {
    return BOT_STATUS_DETAIL_MODE_COMPACT;
  }

  throw createValidationError({
    reasonCode: 'invalid_enum_value',
    field: `commands.${BOT_COMMAND_KEY_DURUM}.detailMode`,
  });
}

function validateBotStatusSettingsMutationBody(rawBody = {}) {
  const body = assertPlainObject(rawBody, { field: 'body' });
  const rootAllowedFields = new Set(['settings']);
  ensureNoUnknownFields(body, rootAllowedFields);

  if (!Object.prototype.hasOwnProperty.call(body, 'settings')) {
    throw createValidationError({
      reasonCode: 'missing_required_field',
      field: 'settings',
    });
  }

  const rawSettings = assertPlainObject(body.settings, {
    field: 'settings',
  });
  const settingsAllowedFields = new Set(['detailMode']);
  ensureNoUnknownFields(rawSettings, settingsAllowedFields, 'settings');

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(rawSettings, 'detailMode')) {
    patch.detailMode = normalizeDetailModePatch(rawSettings.detailMode);
  }

  if (Object.keys(patch).length === 0) {
    throw createValidationError({
      reasonCode: 'no_mutation_fields',
      field: 'settings',
    });
  }

  return {
    settings: patch,
  };
}

function validateBotCommandSettingsMutationBody(rawBody = {}) {
  const body = assertPlainObject(rawBody, { field: 'body' });
  const rootAllowedFields = new Set(['commands']);
  ensureNoUnknownFields(body, rootAllowedFields);

  if (!Object.prototype.hasOwnProperty.call(body, 'commands')) {
    throw createValidationError({
      reasonCode: 'missing_required_field',
      field: 'commands',
    });
  }

  const rawCommands = assertPlainObject(body.commands, {
    field: 'commands',
  });
  const commandAllowedFields = new Set([BOT_COMMAND_KEY_DURUM]);
  ensureNoUnknownFields(rawCommands, commandAllowedFields, 'commands');

  if (!Object.prototype.hasOwnProperty.call(rawCommands, BOT_COMMAND_KEY_DURUM)) {
    throw createValidationError({
      reasonCode: 'missing_required_field',
      field: `commands.${BOT_COMMAND_KEY_DURUM}`,
    });
  }

  const rawDurum = assertPlainObject(rawCommands[BOT_COMMAND_KEY_DURUM], {
    field: `commands.${BOT_COMMAND_KEY_DURUM}`,
  });
  const durumAllowedFields = new Set(['enabled', 'detailMode']);
  ensureNoUnknownFields(
    rawDurum,
    durumAllowedFields,
    `commands.${BOT_COMMAND_KEY_DURUM}`
  );

  const durumPatch = {};
  if (Object.prototype.hasOwnProperty.call(rawDurum, 'enabled')) {
    if (typeof rawDurum.enabled !== 'boolean') {
      throw createValidationError({
        reasonCode: 'invalid_field_type',
        field: `commands.${BOT_COMMAND_KEY_DURUM}.enabled`,
      });
    }
    durumPatch.enabled = rawDurum.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(rawDurum, 'detailMode')) {
    durumPatch.detailMode = normalizeCommandDetailModePatch(rawDurum.detailMode);
  }

  if (Object.keys(durumPatch).length === 0) {
    throw createValidationError({
      reasonCode: 'no_mutation_fields',
      field: `commands.${BOT_COMMAND_KEY_DURUM}`,
    });
  }

  return {
    commands: {
      [BOT_COMMAND_KEY_DURUM]: durumPatch,
    },
  };
}

function resolveMutationAllowedOrigins(config = {}) {
  const dashboardAllowedOrigins = Array.isArray(
    config?.controlPlane?.auth?.dashboardAllowedOrigins
  )
    ? config.controlPlane.auth.dashboardAllowedOrigins
    : [];
  const compatibilityFallbackOrigins = [
    String(config?.controlPlane?.auth?.publicBaseUrl || '').trim(),
  ].filter(Boolean);

  return [...new Set(dashboardAllowedOrigins.concat(compatibilityFallbackOrigins))];
}

function toBotStatusSettingsPayload({
  requestContext = {},
  actorId = null,
  guildId = null,
  settings = {},
  updatedAt = null,
} = {}) {
  const normalizedSettings = normalizeGuildBotSettings(settings);
  const storedStatusSettings = normalizeStatusCommandSettings(
    normalizedSettings?.statusCommand || {}
  );
  const effectiveSettings = toEffectiveStatusCommandSettings(normalizedSettings);

  return {
    contractVersion: 1,
    mode: 'protected_bot_status_settings',
    domain: 'status_command',
    requestId: String(requestContext?.requestId || ''),
    scope: {
      actorId: actorId ? String(actorId) : null,
      guildId: guildId ? String(guildId) : null,
    },
    settings: storedStatusSettings,
    effective: effectiveSettings,
    updatedAt: updatedAt ? String(updatedAt) : null,
  };
}

function toBotCommandSettingsPayload({
  requestContext = {},
  actorId = null,
  guildId = null,
  settings = {},
  updatedAt = null,
} = {}) {
  const normalizedSettings = normalizeGuildBotSettings(settings);
  const commandSettings = normalizeCommandSettings(normalizedSettings?.commands || {});
  const effectiveDurumCommand = toEffectiveDurumCommandSettings(normalizedSettings);

  return {
    contractVersion: 1,
    mode: 'protected_bot_command_settings',
    domain: 'commands',
    requestId: String(requestContext?.requestId || ''),
    scope: {
      actorId: actorId ? String(actorId) : null,
      guildId: guildId ? String(guildId) : null,
    },
    commands: commandSettings,
    effective: {
      [BOT_COMMAND_KEY_DURUM]: effectiveDurumCommand,
    },
    updatedAt: updatedAt ? String(updatedAt) : null,
  };
}

function createDashboardBotStatusSettingsRouteDefinitions({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
  botSettingsRepository = null,
  mutationAuditRecorder = null,
  maxBodyBytes = BOT_SETTINGS_MAX_BODY_BYTES,
} = {}) {
  const requireDashboardGuildAccess = createRequireGuildAccess({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });
  const repository = botSettingsRepository || getSharedBotSettingsRepository();
  const auditRecorder = mutationAuditRecorder || createInMemoryMutationAuditRecorder();
  const originGuard = createMutationOriginGuard({
    allowedOrigins: resolveMutationAllowedOrigins(config),
  });

  const readStatusSettingsHandler = withBoundaryChecks(
    async ({ authContext = {}, requestContext = {} } = {}) => {
      const actorId = String(authContext?.principal?.id || '').trim() || null;
      const guildId = String(requestContext?.guildScope?.guildId || '').trim() || null;
      const stored = await repository.getByGuildId({ guildId });
      return toBotStatusSettingsPayload({
        requestContext,
        actorId,
        guildId,
        settings: stored?.settings || createDefaultGuildBotSettings(),
        updatedAt: stored?.updatedAt || null,
      });
    },
    [requireAuth, requireDashboardGuildAccess]
  );

  const writeStatusSettingsHandler = createMutationPipeline({
    mutationType: BOT_STATUS_SETTINGS_MUTATION_TYPE,
    checks: [requireAuth, requireDashboardGuildAccess],
    validateBody: (rawBody = {}) => validateBotStatusSettingsMutationBody(rawBody),
    executeMutation: async ({ routeContext = {}, actor = {}, guildId = null, body = {} } = {}) => {
      const actorId = String(actor?.actorId || '').trim();
      if (!actorId) {
        throw new MutationPipelineError('Mutation actor must be authenticated.', {
          statusCode: 401,
          errorCode: 'unauthenticated',
          reasonCode: 'actor_missing',
        });
      }

      const normalizedGuildId = String(guildId || '').trim();
      if (!normalizedGuildId) {
        throw new MutationPipelineError('Guild scope must be resolved for mutation.', {
          statusCode: 403,
          errorCode: 'guild_access_denied',
          reasonCode: 'guild_scope_unresolved',
        });
      }

      const mutationResult = await repository.upsertByGuildId({
        actorId,
        guildId: normalizedGuildId,
        patch: {
          statusCommand: body?.settings || {},
        },
      });
      if (!mutationResult?.record) {
        throw new MutationPipelineError('Failed to store bot status settings.', {
          statusCode: 500,
          errorCode: 'internal_error',
          reasonCode: 'bot_status_settings_store_failed',
        });
      }

      return {
        ...toBotStatusSettingsPayload({
          requestContext: routeContext?.requestContext,
          actorId: mutationResult.record.actorId,
          guildId: mutationResult.record.guildId,
          settings: mutationResult.record.settings,
          updatedAt: mutationResult.record.updatedAt,
        }),
        mutation: {
          type: BOT_STATUS_SETTINGS_MUTATION_TYPE,
          applied: Boolean(mutationResult.applied),
          duplicate: Boolean(mutationResult.duplicate),
        },
      };
    },
    auditRecorder,
    maxBodyBytes,
    requireJsonContentType: true,
    originGuard,
  });

  const readCommandSettingsHandler = withBoundaryChecks(
    async ({ authContext = {}, requestContext = {} } = {}) => {
      const actorId = String(authContext?.principal?.id || '').trim() || null;
      const guildId = String(requestContext?.guildScope?.guildId || '').trim() || null;
      const stored = await repository.getByGuildId({ guildId });
      return toBotCommandSettingsPayload({
        requestContext,
        actorId,
        guildId,
        settings: stored?.settings || createDefaultGuildBotSettings(),
        updatedAt: stored?.updatedAt || null,
      });
    },
    [requireAuth, requireDashboardGuildAccess]
  );

  const writeCommandSettingsHandler = createMutationPipeline({
    mutationType: BOT_COMMAND_SETTINGS_MUTATION_TYPE,
    checks: [requireAuth, requireDashboardGuildAccess],
    validateBody: (rawBody = {}) => validateBotCommandSettingsMutationBody(rawBody),
    executeMutation: async ({ routeContext = {}, actor = {}, guildId = null, body = {} } = {}) => {
      const actorId = String(actor?.actorId || '').trim();
      if (!actorId) {
        throw new MutationPipelineError('Mutation actor must be authenticated.', {
          statusCode: 401,
          errorCode: 'unauthenticated',
          reasonCode: 'actor_missing',
        });
      }

      const normalizedGuildId = String(guildId || '').trim();
      if (!normalizedGuildId) {
        throw new MutationPipelineError('Guild scope must be resolved for mutation.', {
          statusCode: 403,
          errorCode: 'guild_access_denied',
          reasonCode: 'guild_scope_unresolved',
        });
      }

      const mutationResult = await repository.upsertByGuildId({
        actorId,
        guildId: normalizedGuildId,
        patch: {
          commands: body?.commands || {},
        },
      });
      if (!mutationResult?.record) {
        throw new MutationPipelineError('Failed to store bot command settings.', {
          statusCode: 500,
          errorCode: 'internal_error',
          reasonCode: 'bot_command_settings_store_failed',
        });
      }

      return {
        ...toBotCommandSettingsPayload({
          requestContext: routeContext?.requestContext,
          actorId: mutationResult.record.actorId,
          guildId: mutationResult.record.guildId,
          settings: mutationResult.record.settings,
          updatedAt: mutationResult.record.updatedAt,
        }),
        mutation: {
          type: BOT_COMMAND_SETTINGS_MUTATION_TYPE,
          applied: Boolean(mutationResult.applied),
          duplicate: Boolean(mutationResult.duplicate),
        },
      };
    },
    auditRecorder,
    maxBodyBytes,
    requireJsonContentType: true,
    originGuard,
  });

  return {
    routeDefinitions: [
      {
        method: 'GET',
        path: BOT_STATUS_SETTINGS_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_bot_status_settings',
        handler: readStatusSettingsHandler,
      },
      {
        method: 'PUT',
        path: BOT_STATUS_SETTINGS_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_bot_status_settings',
        handler: writeStatusSettingsHandler,
      },
      {
        method: 'GET',
        path: BOT_COMMAND_SETTINGS_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_bot_command_settings',
        handler: readCommandSettingsHandler,
      },
      {
        method: 'PUT',
        path: BOT_COMMAND_SETTINGS_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_bot_command_settings',
        handler: writeCommandSettingsHandler,
      },
    ],
    mutableRoutesEnabled: true,
    repository,
    auditRecorder,
  };
}

module.exports = {
  BOT_SETTINGS_MAX_BODY_BYTES,
  BOT_STATUS_SETTINGS_MUTATION_TYPE,
  BOT_STATUS_SETTINGS_PATH,
  BOT_COMMAND_SETTINGS_MUTATION_TYPE,
  BOT_COMMAND_SETTINGS_PATH,
  createDashboardBotStatusSettingsRouteDefinitions,
  validateBotStatusSettingsMutationBody,
  validateBotCommandSettingsMutationBody,
};
