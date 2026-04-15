const { normalizePrincipal } = require('./principal');

function toPublicGuildSummary(rawMembership = {}) {
  if (!rawMembership || typeof rawMembership !== 'object') return null;
  const id = String(rawMembership.id || '').trim();
  if (!id) return null;

  return {
    id,
    name: String(rawMembership.name || '').trim() || null,
    iconUrl: String(rawMembership.iconUrl || '').trim() || null,
    isOwner: rawMembership.isOwner === true,
    isOperator: rawMembership.isOperator === true,
  };
}

function toPublicGuildSummaries(principal = null) {
  const normalizedPrincipal = normalizePrincipal(principal);
  if (!normalizedPrincipal) return [];
  const rawMemberships = Array.isArray(normalizedPrincipal.guildMemberships)
    ? normalizedPrincipal.guildMemberships
    : [];

  return rawMemberships
    .map((membership) => toPublicGuildSummary(membership))
    .filter(Boolean)
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
}

function toPublicGuildSummaryById(principal = null, guildId = null) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) return null;
  const summaries = toPublicGuildSummaries(principal);
  return summaries.find((entry) => entry.id === normalizedGuildId) || null;
}

function summarizePrincipalGuildAccess(principal = null) {
  const guilds = toPublicGuildSummaries(principal);
  return {
    guildCount: guilds.length,
    operatorGuildCount: guilds.filter((entry) => entry.isOperator === true).length,
  };
}

module.exports = {
  summarizePrincipalGuildAccess,
  toPublicGuildSummaries,
  toPublicGuildSummary,
  toPublicGuildSummaryById,
};
