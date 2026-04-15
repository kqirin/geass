function normalizeGuildId(rawValue) {
  const normalized = String(rawValue || '')
    .trim()
    .replace(/[^\d]/g, '');
  if (!normalized) return null;
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function resolveDashboardGuildScope({
  config = {},
  requestedGuildId = null,
  getConfiguredStaticGuildIds = () => [],
} = {}) {
  const configuredStaticGuildIds = Array.isArray(getConfiguredStaticGuildIds?.())
    ? getConfiguredStaticGuildIds().map((guildId) => String(guildId || '').trim()).filter(Boolean)
    : [];

  const authoritativeFromOauth = normalizeGuildId(config?.oauth?.singleGuildId);
  const authoritativeFromDiscord = normalizeGuildId(config?.discord?.targetGuildId);
  const fallbackSingleStaticGuildId =
    configuredStaticGuildIds.length === 1 ? normalizeGuildId(configuredStaticGuildIds[0]) : null;
  const authoritativeGuildId =
    authoritativeFromOauth || authoritativeFromDiscord || fallbackSingleStaticGuildId || null;

  const requestedRaw = String(requestedGuildId || '').trim();
  const requestedNormalized = requestedRaw ? normalizeGuildId(requestedRaw) : null;

  const base = {
    mode: authoritativeGuildId ? 'single_guild' : 'unscoped',
    valid: true,
    reasonCode: null,
    requestedGuildId: requestedRaw ? requestedNormalized : null,
    guildId: null,
    authoritativeGuildId,
    hasAuthoritativeGuild: Boolean(authoritativeGuildId),
    configuredStaticGuildCount: configuredStaticGuildIds.length,
    hasConfiguredStaticGuild: false,
  };

  if (requestedRaw && !requestedNormalized) {
    return {
      ...base,
      valid: false,
      reasonCode: 'invalid_guild_id',
    };
  }

  if (requestedNormalized && authoritativeGuildId && requestedNormalized !== authoritativeGuildId) {
    return {
      ...base,
      valid: false,
      reasonCode: 'guild_scope_mismatch',
      requestedGuildId: requestedNormalized,
      guildId: authoritativeGuildId,
      hasConfiguredStaticGuild: configuredStaticGuildIds.includes(authoritativeGuildId),
    };
  }

  const resolvedGuildId = requestedNormalized || authoritativeGuildId || null;
  return {
    ...base,
    guildId: resolvedGuildId,
    requestedGuildId: requestedNormalized,
    hasConfiguredStaticGuild: resolvedGuildId ? configuredStaticGuildIds.includes(resolvedGuildId) : false,
  };
}

module.exports = {
  normalizeGuildId,
  resolveDashboardGuildScope,
};
