const { createRequireGuildAccess, requireAuth, withBoundaryChecks } = require('./authBoundary');
const {
  MutationPipelineError,
  createMutationOriginGuard,
  createMutationPipeline,
} = require('./mutationPipeline');
const { createInMemoryMutationAuditRecorder } = require('./mutationAudit');
const {
  ALLOWED_ADVANCED_LAYOUT_MODES,
  ALLOWED_DASHBOARD_DEFAULT_VIEWS,
  createDefaultDashboardPreferences,
  createInMemoryDashboardPreferencesRepository,
} = require('./preferencesRepository');
const { CAPABILITY_KEYS } = require('./planCapabilities');
const {
  RequestValidationError,
  assertPlainObject,
} = require('./requestValidation');
const { resolveDashboardGuildScope } = require('./guildScope');

const DASHBOARD_PREFERENCES_PATH = '/api/dashboard/protected/preferences';
const DASHBOARD_PREFERENCES_MUTATION_TYPE = 'dashboard_preferences_upsert';
const DASHBOARD_PREFERENCES_MAX_BODY_BYTES = 4 * 1024;
const ADVANCED_DASHBOARD_PREFERENCES_CAPABILITY_KEY =
  CAPABILITY_KEYS.ADVANCED_DASHBOARD_PREFERENCES;

function createValidationError({
  reasonCode = 'invalid_request_body',
  field = null,
  statusCode = 400,
  errorCode = 'invalid_request_body',
} = {}) {
  return new RequestValidationError('Dashboard preferences request is invalid.', {
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

function normalizeDismissedNoticeIds(rawValue) {
  if (!Array.isArray(rawValue)) {
    throw createValidationError({
      reasonCode: 'invalid_field_type',
      field: 'preferences.dismissedNoticeIds',
    });
  }
  if (rawValue.length > 32) {
    throw createValidationError({
      reasonCode: 'array_too_large',
      field: 'preferences.dismissedNoticeIds',
    });
  }

  const uniqueValues = new Set();
  const normalized = [];

  for (const entry of rawValue) {
    if (typeof entry !== 'string') {
      throw createValidationError({
        reasonCode: 'invalid_array_item_type',
        field: 'preferences.dismissedNoticeIds',
      });
    }
    const value = String(entry || '').trim();
    if (!value) {
      throw createValidationError({
        reasonCode: 'invalid_array_item',
        field: 'preferences.dismissedNoticeIds',
      });
    }
    if (value.length > 64) {
      throw createValidationError({
        reasonCode: 'string_too_long',
        field: 'preferences.dismissedNoticeIds',
      });
    }
    if (!/^[a-zA-Z0-9_.:-]+$/.test(value)) {
      throw createValidationError({
        reasonCode: 'invalid_array_item',
        field: 'preferences.dismissedNoticeIds',
      });
    }
    if (uniqueValues.has(value)) continue;
    uniqueValues.add(value);
    normalized.push(value);
  }

  return normalized;
}

function createCapabilityDecisionUnavailable(reasonCode = 'feature_gate_evaluator_unavailable') {
  return {
    key: ADVANCED_DASHBOARD_PREFERENCES_CAPABILITY_KEY,
    allowed: false,
    requiredPlan: 'pro',
    planTier: null,
    source: 'unresolved',
    active: true,
    gatingMode: 'enforced',
    reasonCode: String(reasonCode || 'feature_gate_evaluator_unavailable'),
  };
}

async function resolveAdvancedDashboardPreferenceCapability({
  featureGateEvaluator = null,
  guildId = null,
} = {}) {
  if (
    !featureGateEvaluator ||
    typeof featureGateEvaluator.evaluateCapability !== 'function'
  ) {
    return {
      decision: createCapabilityDecisionUnavailable('feature_gate_evaluator_unavailable'),
      entitlement: {
        status: 'unresolved',
        planTier: null,
        source: 'unresolved',
        reasonCode: 'feature_gate_evaluator_unavailable',
      },
      generatedAt: new Date().toISOString(),
    };
  }

  try {
    const resolved = await featureGateEvaluator.evaluateCapability({
      guildId,
      capabilityKey: ADVANCED_DASHBOARD_PREFERENCES_CAPABILITY_KEY,
    });
    return {
      decision:
        resolved?.decision || createCapabilityDecisionUnavailable('capability_resolution_failed'),
      entitlement: resolved?.entitlement || {
        status: 'unresolved',
        planTier: null,
        source: 'unresolved',
        reasonCode: 'capability_resolution_failed',
      },
      generatedAt: String(resolved?.generatedAt || new Date().toISOString()),
    };
  } catch {
    return {
      decision: createCapabilityDecisionUnavailable('capability_resolution_failed'),
      entitlement: {
        status: 'unresolved',
        planTier: null,
        source: 'unresolved',
        reasonCode: 'capability_resolution_failed',
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

function mapAdvancedCapabilityDenyReason(decision = null) {
  const reasonCode = String(decision?.reasonCode || '');
  if (reasonCode === 'plan_upgrade_required') {
    return 'advanced_dashboard_preferences_plan_required';
  }
  if (reasonCode === 'capability_not_active') {
    return 'advanced_dashboard_preferences_not_active';
  }
  return 'advanced_dashboard_preferences_unavailable';
}

function toPlanSummary(entitlement = {}) {
  return {
    status: String(entitlement?.status || 'unresolved'),
    tier: String(entitlement?.planTier || '') || null,
    source: String(entitlement?.source || 'unresolved'),
    reasonCode:
      entitlement?.reasonCode === undefined || entitlement?.reasonCode === null
        ? null
        : String(entitlement.reasonCode || '') || null,
  };
}

function toPreferencesCapabilitiesSummary(decision = null) {
  const resolvedDecision = decision || createCapabilityDecisionUnavailable();
  return {
    advancedDashboardPreferences: {
      key: ADVANCED_DASHBOARD_PREFERENCES_CAPABILITY_KEY,
      available: Boolean(resolvedDecision.allowed),
      requiredPlan: String(resolvedDecision.requiredPlan || 'pro'),
      active: Boolean(resolvedDecision.active),
      gatingMode: String(resolvedDecision.gatingMode || 'enforced'),
      reasonCode:
        resolvedDecision.reasonCode === undefined ||
        resolvedDecision.reasonCode === null
          ? null
          : String(resolvedDecision.reasonCode || '') || null,
    },
  };
}

function toSafePreferencesForPlan(preferences = {}, decision = null) {
  const base = createDefaultDashboardPreferences();
  const source = preferences && typeof preferences === 'object' ? preferences : {};
  const resolvedDecision = decision || createCapabilityDecisionUnavailable();

  return {
    defaultView:
      typeof source.defaultView === 'string' ? source.defaultView : base.defaultView,
    compactMode:
      typeof source.compactMode === 'boolean' ? source.compactMode : base.compactMode,
    dismissedNoticeIds: Array.isArray(source.dismissedNoticeIds)
      ? source.dismissedNoticeIds
      : base.dismissedNoticeIds,
    advancedLayoutMode: resolvedDecision.allowed
      ? source.advancedLayoutMode || null
      : null,
  };
}

function validateDashboardPreferencesMutationBody(
  rawBody = {},
  { advancedCapabilityDecision = null } = {}
) {
  const body = assertPlainObject(rawBody, { field: 'body' });
  const rootAllowedFields = new Set(['preferences']);
  ensureNoUnknownFields(body, rootAllowedFields);

  if (!Object.prototype.hasOwnProperty.call(body, 'preferences')) {
    throw createValidationError({
      reasonCode: 'missing_required_field',
      field: 'preferences',
    });
  }

  const rawPreferences = assertPlainObject(body.preferences, {
    field: 'preferences',
  });
  const preferenceAllowedFields = new Set([
    'defaultView',
    'compactMode',
    'dismissedNoticeIds',
    'advancedLayoutMode',
  ]);
  ensureNoUnknownFields(rawPreferences, preferenceAllowedFields, 'preferences');

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(rawPreferences, 'defaultView')) {
    const defaultView = String(rawPreferences.defaultView || '').trim();
    if (!ALLOWED_DASHBOARD_DEFAULT_VIEWS.includes(defaultView)) {
      throw createValidationError({
        reasonCode: 'invalid_enum_value',
        field: 'preferences.defaultView',
      });
    }
    patch.defaultView = defaultView;
  }

  if (Object.prototype.hasOwnProperty.call(rawPreferences, 'compactMode')) {
    if (typeof rawPreferences.compactMode !== 'boolean') {
      throw createValidationError({
        reasonCode: 'invalid_field_type',
        field: 'preferences.compactMode',
      });
    }
    patch.compactMode = rawPreferences.compactMode;
  }

  if (Object.prototype.hasOwnProperty.call(rawPreferences, 'dismissedNoticeIds')) {
    patch.dismissedNoticeIds = normalizeDismissedNoticeIds(
      rawPreferences.dismissedNoticeIds
    );
  }

  if (Object.prototype.hasOwnProperty.call(rawPreferences, 'advancedLayoutMode')) {
    const decision =
      advancedCapabilityDecision || createCapabilityDecisionUnavailable();
    if (!decision.allowed) {
      throw createValidationError({
        statusCode: 403,
        errorCode: 'capability_denied',
        reasonCode: mapAdvancedCapabilityDenyReason(decision),
        field: 'preferences.advancedLayoutMode',
      });
    }

    const rawAdvancedLayoutMode = rawPreferences.advancedLayoutMode;
    if (rawAdvancedLayoutMode === null) {
      patch.advancedLayoutMode = null;
    } else {
      if (typeof rawAdvancedLayoutMode !== 'string') {
        throw createValidationError({
          reasonCode: 'invalid_field_type',
          field: 'preferences.advancedLayoutMode',
        });
      }
      const advancedLayoutMode = String(rawAdvancedLayoutMode || '').trim();
      if (!ALLOWED_ADVANCED_LAYOUT_MODES.includes(advancedLayoutMode)) {
        throw createValidationError({
          reasonCode: 'invalid_enum_value',
          field: 'preferences.advancedLayoutMode',
        });
      }
      patch.advancedLayoutMode = advancedLayoutMode;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw createValidationError({
      reasonCode: 'no_mutation_fields',
      field: 'preferences',
    });
  }

  return {
    preferences: patch,
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

function toPreferencesPayload({
  requestContext = {},
  actorId = null,
  guildId = null,
  preferences = {},
  updatedAt = null,
  plan = null,
  capabilities = null,
  featureGateGeneratedAt = null,
} = {}) {
  return {
    contractVersion: 1,
    mode: 'protected_preferences',
    requestId: String(requestContext?.requestId || ''),
    scope: {
      actorId: actorId ? String(actorId) : null,
      guildId: guildId ? String(guildId) : null,
    },
    preferences: preferences && typeof preferences === 'object'
      ? preferences
      : createDefaultDashboardPreferences(),
    updatedAt: updatedAt ? String(updatedAt) : null,
    plan:
      plan && typeof plan === 'object'
        ? plan
        : toPlanSummary({
            status: 'unresolved',
            planTier: null,
            source: 'unresolved',
            reasonCode: 'feature_gate_evaluator_unavailable',
          }),
    capabilities:
      capabilities && typeof capabilities === 'object'
        ? capabilities
        : toPreferencesCapabilitiesSummary(),
    featureGateGeneratedAt:
      featureGateGeneratedAt !== null && featureGateGeneratedAt !== undefined
        ? String(featureGateGeneratedAt || '')
        : new Date().toISOString(),
  };
}

function createDashboardPreferencesRouteDefinitions({
  config = {},
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
  featureGateEvaluator = null,
  preferencesRepository = null,
  mutationAuditRecorder = null,
  maxBodyBytes = DASHBOARD_PREFERENCES_MAX_BODY_BYTES,
} = {}) {
  const requireDashboardGuildAccess = createRequireGuildAccess({
    config,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });
  const repository = preferencesRepository || createInMemoryDashboardPreferencesRepository();
  const auditRecorder =
    mutationAuditRecorder || createInMemoryMutationAuditRecorder();
  const originGuard = createMutationOriginGuard({
    allowedOrigins: resolveMutationAllowedOrigins(config),
  });

  const readPreferencesHandler = withBoundaryChecks(
    async ({ authContext = {}, requestContext = {} } = {}) => {
      const actorId = String(authContext?.principal?.id || '').trim() || null;
      const guildId = String(requestContext?.guildScope?.guildId || '').trim() || null;
      const capabilityContext = await resolveAdvancedDashboardPreferenceCapability({
        featureGateEvaluator,
        guildId,
      });
      const stored = await repository.getByActorAndGuild({
        actorId,
        guildId,
      });
      return toPreferencesPayload({
        requestContext,
        actorId,
        guildId,
        preferences: toSafePreferencesForPlan(
          stored?.preferences || createDefaultDashboardPreferences(),
          capabilityContext.decision
        ),
        updatedAt: stored?.updatedAt || null,
        plan: toPlanSummary(capabilityContext.entitlement),
        capabilities: toPreferencesCapabilitiesSummary(capabilityContext.decision),
        featureGateGeneratedAt: capabilityContext.generatedAt,
      });
    },
    [requireAuth, requireDashboardGuildAccess]
  );

  const writePreferencesHandler = createMutationPipeline({
    mutationType: DASHBOARD_PREFERENCES_MUTATION_TYPE,
    checks: [requireAuth, requireDashboardGuildAccess],
    validateBody: async (rawBody = {}, routeContext = {}) => {
      const guildId =
        String(routeContext?.requestContext?.guildScope?.guildId || '').trim() || null;
      const hasAdvancedPreferenceField = Boolean(
        rawBody &&
          typeof rawBody === 'object' &&
          rawBody.preferences &&
          typeof rawBody.preferences === 'object' &&
          Object.prototype.hasOwnProperty.call(
            rawBody.preferences,
            'advancedLayoutMode'
          )
      );
      const capabilityContext = hasAdvancedPreferenceField
        ? await resolveAdvancedDashboardPreferenceCapability({
            featureGateEvaluator,
            guildId,
          })
        : null;

      return validateDashboardPreferencesMutationBody(rawBody, {
        advancedCapabilityDecision: capabilityContext?.decision || null,
      });
    },
    executeMutation: async ({
      routeContext = {},
      actor = {},
      guildId = null,
      body = {},
    } = {}) => {
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

      const mutationResult = await repository.upsertByActorAndGuild({
        actorId,
        guildId: normalizedGuildId,
        patch: body?.preferences || {},
      });
      if (!mutationResult?.record) {
        throw new MutationPipelineError('Failed to store dashboard preferences.', {
          statusCode: 500,
          errorCode: 'internal_error',
          reasonCode: 'preferences_store_failed',
        });
      }

      const capabilityContext = await resolveAdvancedDashboardPreferenceCapability({
        featureGateEvaluator,
        guildId: normalizedGuildId,
      });

      return {
        ...toPreferencesPayload({
          requestContext: routeContext?.requestContext,
          actorId: mutationResult.record.actorId,
          guildId: mutationResult.record.guildId,
          preferences: toSafePreferencesForPlan(
            mutationResult.record.preferences,
            capabilityContext.decision
          ),
          updatedAt: mutationResult.record.updatedAt,
          plan: toPlanSummary(capabilityContext.entitlement),
          capabilities: toPreferencesCapabilitiesSummary(capabilityContext.decision),
          featureGateGeneratedAt: capabilityContext.generatedAt,
        }),
        mutation: {
          type: DASHBOARD_PREFERENCES_MUTATION_TYPE,
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
        path: DASHBOARD_PREFERENCES_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_preferences',
        handler: readPreferencesHandler,
      },
      {
        method: 'PUT',
        path: DASHBOARD_PREFERENCES_PATH,
        group: 'dashboard',
        authMode: 'require_auth_and_guild_access_read_write_preferences',
        handler: writePreferencesHandler,
      },
    ],
    mutableRoutesEnabled: true,
    repository,
    auditRecorder,
  };
}

module.exports = {
  DASHBOARD_PREFERENCES_MAX_BODY_BYTES,
  DASHBOARD_PREFERENCES_MUTATION_TYPE,
  DASHBOARD_PREFERENCES_PATH,
  createDashboardPreferencesRouteDefinitions,
  validateDashboardPreferencesMutationBody,
};
