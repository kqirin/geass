const { createBoundaryErrorResult } = require('./authBoundary');
const { normalizeGuildId } = require('./guildScope');
const { normalizePrincipal } = require('./principal');
const { createDirectJsonResponse } = require('./routeHttpResponse');
const {
  RequestValidationError,
  normalizeHeaderValue,
  parseJsonRequestBody,
} = require('./requestValidation');

class MutationPipelineError extends Error {
  constructor(
    message,
    {
      statusCode = 400,
      errorCode = 'mutation_failed',
      details = null,
      reasonCode = null,
    } = {}
  ) {
    super(message || 'Mutation failed.');
    this.name = 'MutationPipelineError';
    this.statusCode = Number(statusCode) || 400;
    this.errorCode = String(errorCode || 'mutation_failed');
    this.details = details && typeof details === 'object' ? details : null;
    this.reasonCode = String(reasonCode || this.details?.reasonCode || 'mutation_failed');
  }
}

function normalizeAllowedOrigins(allowedOrigins = []) {
  if (!Array.isArray(allowedOrigins)) return [];
  const origins = [];
  for (const rawEntry of allowedOrigins) {
    const value = String(rawEntry || '').trim();
    if (!value) continue;

    try {
      origins.push(new URL(value).origin);
    } catch {
      // Ignore invalid origins; route should not crash on bad config.
    }
  }
  return [...new Set(origins)];
}

function createMutationOriginGuard({ allowedOrigins = [] } = {}) {
  const normalizedAllowedOrigins = normalizeAllowedOrigins(allowedOrigins);

  return function guardMutationOrigin({ req = null } = {}) {
    if (normalizedAllowedOrigins.length === 0) {
      return {
        ok: true,
      };
    }

    const originHeader = normalizeHeaderValue(req?.headers?.origin);
    if (!originHeader) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'csrf_origin_denied',
        details: {
          reasonCode: 'origin_required',
        },
      };
    }

    let normalizedOrigin = '';
    try {
      normalizedOrigin = new URL(originHeader).origin;
    } catch {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'csrf_origin_denied',
        details: {
          reasonCode: 'origin_invalid',
        },
      };
    }

    if (!normalizedAllowedOrigins.includes(normalizedOrigin)) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'csrf_origin_denied',
        details: {
          reasonCode: 'origin_not_allowed',
        },
      };
    }

    return {
      ok: true,
    };
  };
}

function createMutationFailureResponse({
  statusCode = 400,
  errorCode = 'mutation_failed',
  details = null,
} = {}) {
  return createDirectJsonResponse({
    statusCode: Number(statusCode) || 400,
    headers: {
      'Cache-Control': 'no-store',
    },
    payload: {
      ok: false,
      error: String(errorCode || 'mutation_failed'),
      details: details && typeof details === 'object' ? details : null,
    },
  });
}

function resolveAuditScope({
  routeContext = {},
  checkOutcomes = [],
} = {}) {
  const checkDerivedGuildId = checkOutcomes.reduce((selectedGuildId, outcome) => {
    if (selectedGuildId) return selectedGuildId;
    if (!outcome || typeof outcome !== 'object') return selectedGuildId;
    const fromAccess = normalizeGuildId(outcome?.access?.targetGuildId);
    const fromGuildId = normalizeGuildId(outcome?.guildId);
    return fromAccess || fromGuildId || selectedGuildId;
  }, null);

  const requestScope = routeContext?.requestContext?.guildScope || {};
  return {
    guildId:
      normalizeGuildId(requestScope?.guildId) ||
      normalizeGuildId(requestScope?.requestedGuildId) ||
      checkDerivedGuildId,
    path: String(routeContext?.path || routeContext?.requestContext?.path || ''),
    method: String(routeContext?.method || routeContext?.requestContext?.method || ''),
  };
}

function resolveMutationActor(authContext = {}) {
  const principal = normalizePrincipal(authContext?.principal);
  return {
    principal,
    actorId: principal?.id ? String(principal.id) : null,
    actorType: principal?.type ? String(principal.type) : null,
  };
}

async function recordAudit(auditRecorder = null, entry = {}) {
  if (!auditRecorder || typeof auditRecorder.record !== 'function') return;
  try {
    await auditRecorder.record(entry);
  } catch {
    // Audit recording must not break mutation handling.
  }
}

function mapMutationError(error) {
  if (error instanceof RequestValidationError) {
    return {
      statusCode: Number(error.statusCode || 400),
      errorCode: String(error.errorCode || 'invalid_request_body'),
      details: error.details || null,
      reasonCode: String(error.details?.reasonCode || error.errorCode || 'invalid_request_body'),
    };
  }

  if (error instanceof MutationPipelineError) {
    return {
      statusCode: Number(error.statusCode || 400),
      errorCode: String(error.errorCode || 'mutation_failed'),
      details: error.details || null,
      reasonCode: String(error.reasonCode || error.details?.reasonCode || 'mutation_failed'),
    };
  }

  return {
    statusCode: 500,
    errorCode: 'internal_error',
    details: null,
    reasonCode: 'internal_error',
  };
}

function createMutationPipeline({
  mutationType = 'unknown_mutation',
  checks = [],
  validateBody = null,
  executeMutation = async () => ({}),
  auditRecorder = null,
  maxBodyBytes = 8 * 1024,
  requireJsonContentType = true,
  originGuard = null,
} = {}) {
  const normalizedMutationType = String(mutationType || 'unknown_mutation');
  const preconditions = Array.isArray(checks)
    ? checks.filter((check) => typeof check === 'function')
    : [];
  const guardOrigin = typeof originGuard === 'function' ? originGuard : null;

  return async function handleMutation(routeContext = {}) {
    const actor = resolveMutationActor(routeContext?.authContext);
    const requestId = String(routeContext?.requestContext?.requestId || '') || null;
    const checkOutcomes = [];

    for (const check of preconditions) {
      let outcome = null;
      try {
        outcome = check(routeContext);
      } catch {
        outcome = {
          ok: false,
          statusCode: 500,
          errorCode: 'internal_error',
        };
      }
      if (!outcome || outcome.ok !== true) {
        await recordAudit(auditRecorder, {
          mutationType: normalizedMutationType,
          actorId: actor.actorId,
          actorType: actor.actorType,
          requestId,
          scope: resolveAuditScope({ routeContext, checkOutcomes }),
          result: 'rejected',
          reasonCode: String(outcome?.errorCode || 'boundary_check_failed'),
        });
        return createBoundaryErrorResult(outcome || {});
      }
      checkOutcomes.push(outcome);
    }

    if (guardOrigin) {
      const guardResult = guardOrigin(routeContext);
      if (!guardResult || guardResult.ok !== true) {
        await recordAudit(auditRecorder, {
          mutationType: normalizedMutationType,
          actorId: actor.actorId,
          actorType: actor.actorType,
          requestId,
          scope: resolveAuditScope({ routeContext, checkOutcomes }),
          result: 'rejected',
          reasonCode: String(guardResult?.details?.reasonCode || guardResult?.errorCode || 'origin_denied'),
        });
        return createMutationFailureResponse(guardResult || {});
      }
    }

    let parsedBody = null;
    try {
      parsedBody = await parseJsonRequestBody({
        req: routeContext?.req,
        maxBytes: maxBodyBytes,
        requireJsonContentType,
      });
    } catch (error) {
      const mappedError = mapMutationError(error);
      await recordAudit(auditRecorder, {
        mutationType: normalizedMutationType,
        actorId: actor.actorId,
        actorType: actor.actorType,
        requestId,
        scope: resolveAuditScope({ routeContext, checkOutcomes }),
        result: 'failed',
        reasonCode: mappedError.reasonCode,
      });
      return createMutationFailureResponse(mappedError);
    }

    let validatedBody = parsedBody;
    if (typeof validateBody === 'function') {
      try {
        validatedBody = await validateBody(parsedBody, routeContext);
      } catch (error) {
        const mappedError = mapMutationError(error);
        await recordAudit(auditRecorder, {
          mutationType: normalizedMutationType,
          actorId: actor.actorId,
          actorType: actor.actorType,
          requestId,
          scope: resolveAuditScope({ routeContext, checkOutcomes }),
          result: 'failed',
          reasonCode: mappedError.reasonCode,
        });
        return createMutationFailureResponse(mappedError);
      }
    }

    const guildIdFromChecks = checkOutcomes.reduce((resolvedGuildId, outcome) => {
      if (resolvedGuildId) return resolvedGuildId;
      return normalizeGuildId(outcome?.guildId || outcome?.access?.targetGuildId) || null;
    }, null);

    try {
      const mutationResult = await executeMutation({
        routeContext,
        requestId,
        mutationType: normalizedMutationType,
        actor,
        guildId: guildIdFromChecks,
        body: validatedBody,
        checkOutcomes,
      });
      await recordAudit(auditRecorder, {
        mutationType: normalizedMutationType,
        actorId: actor.actorId,
        actorType: actor.actorType,
        requestId,
        scope: resolveAuditScope({ routeContext, checkOutcomes }),
        result: 'succeeded',
      });
      return mutationResult;
    } catch (error) {
      const mappedError = mapMutationError(error);
      await recordAudit(auditRecorder, {
        mutationType: normalizedMutationType,
        actorId: actor.actorId,
        actorType: actor.actorType,
        requestId,
        scope: resolveAuditScope({ routeContext, checkOutcomes }),
        result: 'failed',
        reasonCode: mappedError.reasonCode,
      });
      return createMutationFailureResponse(mappedError);
    }
  };
}

module.exports = {
  MutationPipelineError,
  createMutationOriginGuard,
  createMutationPipeline,
  createMutationFailureResponse,
};
