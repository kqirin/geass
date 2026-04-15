const { normalizeGuildId, resolveDashboardGuildScope } = require('./guildScope');
const { normalizePrincipal } = require('./principal');
const {
  summarizePrincipalGuildAccess,
  toPublicGuildSummaryById,
  toPublicGuildSummaries,
} = require('./authGuildProviders');

const ACCESS_MODEL_VERSION = 1;
const ACCESS_LEVELS = Object.freeze({
  UNAUTHENTICATED: 'unauthenticated',
  AUTHENTICATED_NO_GUILD_ACCESS: 'authenticated_no_guild_access',
  AUTHENTICATED_GUILD_MEMBER: 'authenticated_guild_member',
  AUTHENTICATED_GUILD_OPERATOR: 'authenticated_guild_operator',
});

function normalizeAuthSnapshot(rawAuthContext = {}) {
  const enabled = Boolean(rawAuthContext?.enabled);
  const configured = Boolean(rawAuthContext?.configured);
  const authenticated = Boolean(rawAuthContext?.authenticated);
  return {
    enabled,
    configured,
    authenticated,
    mode: String(rawAuthContext?.mode || (configured ? 'configured' : 'not_configured')),
    reasonCode: String(
      rawAuthContext?.reasonCode ||
        (enabled ? (configured ? 'no_session' : 'auth_not_configured') : 'auth_disabled')
    ),
  };
}

function toScopeSummary(scope = {}) {
  return {
    mode: String(scope?.mode || 'unscoped'),
    valid: scope?.valid !== false,
    reasonCode: scope?.reasonCode ? String(scope.reasonCode) : null,
    guildId: normalizeGuildId(scope?.guildId),
    requestedGuildId: normalizeGuildId(scope?.requestedGuildId),
    authoritativeGuildId: normalizeGuildId(scope?.authoritativeGuildId),
    hasAuthoritativeGuild: Boolean(scope?.hasAuthoritativeGuild),
    configuredStaticGuildCount: Number(scope?.configuredStaticGuildCount || 0),
    hasConfiguredStaticGuild: Boolean(scope?.hasConfiguredStaticGuild),
  };
}

function selectRequestedGuildId({ requestedGuildId = null, guildId = null } = {}) {
  const requestedRaw = String(requestedGuildId || '').trim();
  if (requestedRaw) return requestedRaw;
  const directRaw = String(guildId || '').trim();
  return directRaw || null;
}

function resolveTargetGuildScope({
  config = {},
  requestedGuildId = null,
  guildId = null,
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const scopeResolver = typeof resolveGuildScope === 'function' ? resolveGuildScope : resolveDashboardGuildScope;
  return toScopeSummary(
    scopeResolver({
      config,
      requestedGuildId: selectRequestedGuildId({ requestedGuildId, guildId }),
      getConfiguredStaticGuildIds,
    })
  );
}

function buildDeniedResult({
  accessLevel = ACCESS_LEVELS.AUTHENTICATED_NO_GUILD_ACCESS,
  reasonCode = 'guild_access_denied',
  scope = null,
  principal = null,
  auth = null,
} = {}) {
  const normalizedPrincipal = normalizePrincipal(principal);
  const normalizedScope = toScopeSummary(scope);
  return {
    modelVersion: ACCESS_MODEL_VERSION,
    allowed: false,
    accessLevel,
    reasonCode: String(reasonCode || 'guild_access_denied'),
    guildId: normalizedScope.guildId,
    targetGuildId: normalizedScope.guildId,
    scope: normalizedScope,
    guild: normalizedScope.guildId ? toPublicGuildSummaryById(normalizedPrincipal, normalizedScope.guildId) : null,
    principalSummary: summarizePrincipalGuildAccess(normalizedPrincipal),
    auth: normalizeAuthSnapshot(auth),
  };
}

function evaluateGuildAccessPolicy({
  authContext = null,
  principal = null,
  requestedGuildId = null,
  guildId = null,
  config = {},
  getConfiguredStaticGuildIds = () => [],
  resolveGuildScope = resolveDashboardGuildScope,
} = {}) {
  const normalizedPrincipal = normalizePrincipal(principal);
  const authSnapshot = normalizeAuthSnapshot({
    ...(authContext && typeof authContext === 'object' ? authContext : {}),
    authenticated: Boolean(authContext?.authenticated && normalizedPrincipal),
  });
  const resolvedScope = resolveTargetGuildScope({
    config,
    requestedGuildId,
    guildId,
    getConfiguredStaticGuildIds,
    resolveGuildScope,
  });

  if (!authSnapshot.authenticated || !normalizedPrincipal) {
    return buildDeniedResult({
      accessLevel: ACCESS_LEVELS.UNAUTHENTICATED,
      reasonCode: authSnapshot.reasonCode || 'unauthenticated',
      scope: resolvedScope,
      principal: normalizedPrincipal,
      auth: authSnapshot,
    });
  }

  if (!resolvedScope.valid) {
    return buildDeniedResult({
      accessLevel: ACCESS_LEVELS.AUTHENTICATED_NO_GUILD_ACCESS,
      reasonCode: resolvedScope.reasonCode || 'guild_scope_invalid',
      scope: resolvedScope,
      principal: normalizedPrincipal,
      auth: authSnapshot,
    });
  }

  if (!resolvedScope.guildId) {
    return buildDeniedResult({
      accessLevel: ACCESS_LEVELS.AUTHENTICATED_NO_GUILD_ACCESS,
      reasonCode: 'guild_scope_unresolved',
      scope: resolvedScope,
      principal: normalizedPrincipal,
      auth: authSnapshot,
    });
  }

  const publicGuilds = toPublicGuildSummaries(normalizedPrincipal);
  const selectedGuild = publicGuilds.find((entry) => entry.id === resolvedScope.guildId) || null;
  if (!selectedGuild) {
    return buildDeniedResult({
      accessLevel: ACCESS_LEVELS.AUTHENTICATED_NO_GUILD_ACCESS,
      reasonCode: 'guild_membership_missing',
      scope: resolvedScope,
      principal: normalizedPrincipal,
      auth: authSnapshot,
    });
  }

  const accessLevel = selectedGuild.isOperator
    ? ACCESS_LEVELS.AUTHENTICATED_GUILD_OPERATOR
    : ACCESS_LEVELS.AUTHENTICATED_GUILD_MEMBER;

  return {
    modelVersion: ACCESS_MODEL_VERSION,
    allowed: true,
    accessLevel,
    reasonCode: null,
    guildId: resolvedScope.guildId,
    targetGuildId: resolvedScope.guildId,
    scope: resolvedScope,
    guild: selectedGuild,
    principalSummary: summarizePrincipalGuildAccess(normalizedPrincipal),
    auth: authSnapshot,
  };
}

module.exports = {
  ACCESS_LEVELS,
  ACCESS_MODEL_VERSION,
  evaluateGuildAccessPolicy,
  resolveTargetGuildScope,
};
