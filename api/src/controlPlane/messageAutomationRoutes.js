const { createRequireGuildAccess, requireAuth, withBoundaryChecks } = require('./authBoundary');
const {
  MutationPipelineError,
  createMutationOriginGuard,
  createMutationPipeline,
} = require('./mutationPipeline');
const { createInMemoryMutationAuditRecorder } = require('./mutationAudit');
const {
  RequestValidationError,
  assertPlainObject,
} = require('./requestValidation');
const { resolveDashboardGuildScope } = require('./guildScope');
const {
  MESSAGE_AUTOMATION_MODULE_KEYS,
  MESSAGE_AUTOMATION_THUMBNAIL_MODES,
  createDefaultMessageAutomationSettings,
  getSharedMessageAutomationRepository,
  normalizeMessageAutomationSettings,
} = require('./messageAutomationRepository');

const MESSAGE_AUTOMATION_PATH = '/api/dashboard/protected/message-automation';
const MESSAGE_AUTOMATION_MUTATION_TYPE = 'message_automation_settings_upsert';
const MESSAGE_AUTOMATION_MAX_BODY_BYTES = 12 * 1024;

const MODULE_ALLOWED_FIELDS = Object.freeze([
  'enabled',
  'channelId',
  'plainMessage',
  'embed',
]);
const EMBED_ALLOWED_FIELDS = Object.freeze([
  'enabled',
  'title',
  'description',
  'color',
  'imageUrl',
  'thumbnailMode',
  'footer',
]);

const DISCORD_SNOWFLAKE_LIKE_REGEX = /^\d{15,25}$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const MAX_PLAIN_MESSAGE_LENGTH = 2000;
const MAX_EMBED_TITLE_LENGTH = 256;
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const MAX_EMBED_FOOTER_LENGTH = 2048;
const MAX_IMAGE_URL_LENGTH = 1024;

function createValidationError({
  reasonCode = 'invalid_request_body',
  field = null,
  statusCode = 400,
  errorCode = 'invalid_request_body',
} = {}) {
  return new RequestValidationError('Message automation request is invalid.', {
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

function validateTextField({
  rawValue = '',
  field = '',
  maxLength = 0,
} = {}) {
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field,
    });
  }
  if (
    Number.isFinite(Number(maxLength)) &&
    Number(maxLength) > 0 &&
    rawValue.length > Number(maxLength)
  ) {
    throw createValidationError({
      reasonCode: 'field_too_long',
      field,
      statusCode: 413,
      errorCode: 'payload_too_large',
    });
  }
  return rawValue;
}

function validateChannelIdField(rawValue, field) {
  if (rawValue === null) return null;
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field,
    });
  }

  const normalizedValue = String(rawValue || '').trim();
  if (!normalizedValue || !DISCORD_SNOWFLAKE_LIKE_REGEX.test(normalizedValue)) {
    throw createValidationError({
      reasonCode: 'invalid_field_value',
      field,
    });
  }

  return normalizedValue;
}

function validateColorField(rawValue, field) {
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field,
    });
  }
  const normalizedValue = String(rawValue || '').trim();
  if (!HEX_COLOR_REGEX.test(normalizedValue)) {
    throw createValidationError({
      reasonCode: 'invalid_field_value',
      field,
    });
  }
  return normalizedValue.toLowerCase();
}

function validateImageUrlField(rawValue, field) {
  if (rawValue === null) return null;
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field,
    });
  }

  const normalizedValue = String(rawValue || '').trim();
  if (!normalizedValue) return null;
  if (normalizedValue.length > MAX_IMAGE_URL_LENGTH) {
    throw createValidationError({
      reasonCode: 'field_too_long',
      field,
      statusCode: 413,
      errorCode: 'payload_too_large',
    });
  }

  try {
    const parsed = new URL(normalizedValue);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid_protocol');
    }
    return parsed.toString();
  } catch {
    throw createValidationError({
      reasonCode: 'invalid_field_value',
      field,
    });
  }
}

function validateThumbnailModeField(rawValue, field) {
  if (typeof rawValue !== 'string') {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field,
    });
  }
  const normalizedValue = String(rawValue || '').trim().toLowerCase();
  if (!MESSAGE_AUTOMATION_THUMBNAIL_MODES.includes(normalizedValue)) {
    throw createValidationError({
      reasonCode: 'invalid_enum_value',
      field,
    });
  }
  return normalizedValue;
}

function validateEmbedPatch(rawEmbed = {}, moduleKey = '') {
  const fieldPrefix = `settings.${moduleKey}.embed`;
  const embedPayload = assertPlainObject(rawEmbed, {
    field: fieldPrefix,
  });
  ensureNoUnknownFields(
    embedPayload,
    new Set(EMBED_ALLOWED_FIELDS),
    fieldPrefix
  );

  const embedPatch = {};
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'enabled')) {
    if (typeof embedPayload.enabled !== 'boolean') {
      throw createValidationError({
        reasonCode: 'invalid_field_type',
        field: `${fieldPrefix}.enabled`,
      });
    }
    embedPatch.enabled = embedPayload.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'title')) {
    embedPatch.title = validateTextField({
      rawValue: embedPayload.title,
      field: `${fieldPrefix}.title`,
      maxLength: MAX_EMBED_TITLE_LENGTH,
    });
  }
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'description')) {
    embedPatch.description = validateTextField({
      rawValue: embedPayload.description,
      field: `${fieldPrefix}.description`,
      maxLength: MAX_EMBED_DESCRIPTION_LENGTH,
    });
  }
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'color')) {
    embedPatch.color = validateColorField(embedPayload.color, `${fieldPrefix}.color`);
  }
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'imageUrl')) {
    embedPatch.imageUrl = validateImageUrlField(
      embedPayload.imageUrl,
      `${fieldPrefix}.imageUrl`
    );
  }
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'thumbnailMode')) {
    embedPatch.thumbnailMode = validateThumbnailModeField(
      embedPayload.thumbnailMode,
      `${fieldPrefix}.thumbnailMode`
    );
  }
  if (Object.prototype.hasOwnProperty.call(embedPayload, 'footer')) {
    embedPatch.footer = validateTextField({
      rawValue: embedPayload.footer,
      field: `${fieldPrefix}.footer`,
      maxLength: MAX_EMBED_FOOTER_LENGTH,
    });
  }

  if (Object.keys(embedPatch).length === 0) {
    throw createValidationError({
      reasonCode: 'no_mutation_fields',
      field: fieldPrefix,
    });
  }

  return embedPatch;
}

function validateModulePatch(rawModulePatch = {}, moduleKey = '') {
  const fieldPrefix = `settings.${moduleKey}`;
  const payload = assertPlainObject(rawModulePatch, {
    field: fieldPrefix,
  });
  ensureNoUnknownFields(payload, new Set(MODULE_ALLOWED_FIELDS), fieldPrefix);

  const modulePatch = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    if (typeof payload.enabled !== 'boolean') {
      throw createValidationError({
        reasonCode: 'invalid_field_type',
        field: `${fieldPrefix}.enabled`,
      });
    }
    modulePatch.enabled = payload.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'channelId')) {
    modulePatch.channelId = validateChannelIdField(
      payload.channelId,
      `${fieldPrefix}.channelId`
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'plainMessage')) {
    modulePatch.plainMessage = validateTextField({
      rawValue: payload.plainMessage,
      field: `${fieldPrefix}.plainMessage`,
      maxLength: MAX_PLAIN_MESSAGE_LENGTH,
    });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'embed')) {
    modulePatch.embed = validateEmbedPatch(payload.embed, moduleKey);
  }

  if (Object.keys(modulePatch).length === 0) {
    throw createValidationError({
      reasonCode: 'no_mutation_fields',
      field: fieldPrefix,
    });
  }

  return modulePatch;
}

function validateMessageAutomationMutationBody(rawBody = {}) {
  const body = assertPlainObject(rawBody, { field: 'body' });
  ensureNoUnknownFields(body, new Set(['settings']));

  if (!Object.prototype.hasOwnProperty.call(body, 'settings')) {
    throw createValidationError({
      reasonCode: 'missing_required_field',
      field: 'settings',
    });
  }

  const settingsPayload = assertPlainObject(body.settings, {
    field: 'settings',
  });
  ensureNoUnknownFields(
    settingsPayload,
    new Set(MESSAGE_AUTOMATION_MODULE_KEYS),
    'settings'
  );

  const moduleKeys = Object.keys(settingsPayload);
  if (moduleKeys.length === 0) {
    throw createValidationError({
      reasonCode: 'no_mutation_fields',
      field: 'settings',
    });
  }

  const settingsPatch = {};
  for (const moduleKey of moduleKeys) {
    settingsPatch[moduleKey] = validateModulePatch(
      settingsPayload[moduleKey],
      moduleKey
    );
  }

  return {
    settings: settingsPatch,
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

function toMessageAutomationPayload({
  guildId = null,
  settings = {},
  updatedAt = null,
} = {}) {
  return {
    contractVersion: 1,
    guildId: guildId ? String(guildId) : null,
    settings: normalizeMessageAutomationSettings(settings),
    updatedAt: updatedAt ? String(updatedAt) : null,
  };
}

function createDashboardMessageAutomationRouteDefinitions({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
  messageAutomationRepository = null,
  mutationAuditRecorder = null,
  maxBodyBytes = MESSAGE_AUTOMATION_MAX_BODY_BYTES,
} = {}) {
  const requireDashboardGuildAccess = createRequireGuildAccess({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });
  const repository =
    messageAutomationRepository || getSharedMessageAutomationRepository();
  const auditRecorder = mutationAuditRecorder || createInMemoryMutationAuditRecorder();
  const originGuard = createMutationOriginGuard({
    allowedOrigins: resolveMutationAllowedOrigins(config),
  });

  const readHandler = withBoundaryChecks(
    async ({ requestContext = {} } = {}) => {
      const guildId = String(requestContext?.guildScope?.guildId || '').trim() || null;
      const stored = await repository.getByGuildId({ guildId });
      return toMessageAutomationPayload({
        guildId,
        settings: stored?.settings || createDefaultMessageAutomationSettings(),
        updatedAt: stored?.updatedAt || null,
      });
    },
    [requireAuth, requireDashboardGuildAccess]
  );

  const writeHandler = createMutationPipeline({
    mutationType: MESSAGE_AUTOMATION_MUTATION_TYPE,
    checks: [requireAuth, requireDashboardGuildAccess],
    validateBody: (rawBody = {}) => validateMessageAutomationMutationBody(rawBody),
    executeMutation: async ({ guildId = null, actor = {}, body = {} } = {}) => {
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
        patch: body?.settings || {},
      });
      if (!mutationResult?.record) {
        throw new MutationPipelineError(
          'Failed to store message automation settings.',
          {
            statusCode: 500,
            errorCode: 'internal_error',
            reasonCode: 'message_automation_settings_store_failed',
          }
        );
      }

      return {
        ...toMessageAutomationPayload({
          guildId: mutationResult.record.guildId,
          settings: mutationResult.record.settings,
          updatedAt: mutationResult.record.updatedAt,
        }),
        mutation: {
          type: MESSAGE_AUTOMATION_MUTATION_TYPE,
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
        path: MESSAGE_AUTOMATION_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_message_automation',
        handler: readHandler,
      },
      {
        method: 'PUT',
        path: MESSAGE_AUTOMATION_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_message_automation',
        handler: writeHandler,
      },
    ],
    mutableRoutesEnabled: true,
    repository,
    auditRecorder,
  };
}

module.exports = {
  MESSAGE_AUTOMATION_MAX_BODY_BYTES,
  MESSAGE_AUTOMATION_MUTATION_TYPE,
  MESSAGE_AUTOMATION_PATH,
  createDashboardMessageAutomationRouteDefinitions,
  validateMessageAutomationMutationBody,
};
