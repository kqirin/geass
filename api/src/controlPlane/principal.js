const { normalizeGuildId } = require('./guildScope');

const ADMINISTRATOR_PERMISSION = 0x8n;
const MANAGE_GUILD_PERMISSION = 0x20n;

function createAnonymousPrincipal() {
  return null;
}

function parsePermissionBits(rawValue) {
  if (typeof rawValue === 'bigint') return rawValue;
  const normalized = String(rawValue || '').trim();
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function hasOperatorPermissions(permissionBits) {
  if (typeof permissionBits !== 'bigint') return false;
  return (
    (permissionBits & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION ||
    (permissionBits & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION
  );
}

function normalizeGuildMembership(rawMembership = {}) {
  if (!rawMembership || typeof rawMembership !== 'object') return null;
  const id = normalizeGuildId(rawMembership.id || rawMembership.guildId);
  if (!id) return null;

  const name = String(rawMembership.name || '').trim() || null;
  const iconUrlRaw = String(rawMembership.iconUrl || '').trim() || null;
  const iconHash = String(rawMembership.icon || '').trim() || null;
  const iconUrl =
    iconUrlRaw ||
    (iconHash
      ? `https://cdn.discordapp.com/icons/${encodeURIComponent(id)}/${encodeURIComponent(iconHash)}.png`
      : null);
  const owner = rawMembership.owner === true || rawMembership.isOwner === true;
  const permissionBits = parsePermissionBits(rawMembership.permissions || rawMembership.permissionsNew);
  const isOperator =
    rawMembership.isOperator === true || owner || hasOperatorPermissions(permissionBits);

  return {
    id,
    name,
    iconUrl,
    isOwner: owner,
    isOperator,
  };
}

function mergeGuildMembership(existingMembership = null, nextMembership = null) {
  if (!existingMembership) return nextMembership;
  if (!nextMembership) return existingMembership;
  return {
    id: existingMembership.id,
    name: nextMembership.name || existingMembership.name || null,
    iconUrl: nextMembership.iconUrl || existingMembership.iconUrl || null,
    isOwner: existingMembership.isOwner || nextMembership.isOwner,
    isOperator: existingMembership.isOperator || nextMembership.isOperator,
  };
}

function normalizePrincipal(rawPrincipal) {
  if (!rawPrincipal || typeof rawPrincipal !== 'object') {
    return null;
  }

  const id = String(rawPrincipal.id || '').trim();
  if (!id) {
    return null;
  }

  const type = String(rawPrincipal.type || 'discord_user').trim().toLowerCase();
  const membershipMap = new Map();
  const rawMemberships = Array.isArray(rawPrincipal.guildMemberships) ? rawPrincipal.guildMemberships : [];
  for (const rawMembership of rawMemberships) {
    const normalizedMembership = normalizeGuildMembership(rawMembership);
    if (!normalizedMembership) continue;
    membershipMap.set(
      normalizedMembership.id,
      mergeGuildMembership(membershipMap.get(normalizedMembership.id), normalizedMembership)
    );
  }

  const rawGuildIds = Array.isArray(rawPrincipal.guildIds) ? rawPrincipal.guildIds : [];
  for (const rawGuildId of rawGuildIds) {
    const normalizedGuildId = normalizeGuildId(rawGuildId);
    if (!normalizedGuildId) continue;
    membershipMap.set(
      normalizedGuildId,
      mergeGuildMembership(membershipMap.get(normalizedGuildId), {
        id: normalizedGuildId,
        name: null,
        iconUrl: null,
        isOwner: false,
        isOperator: false,
      })
    );
  }

  const guildMemberships = [...membershipMap.values()];
  const guildIds = guildMemberships.map((membership) => membership.id);
  const username = String(rawPrincipal.username || '').trim() || null;
  const displayName = String(rawPrincipal.displayName || '').trim() || username;
  const avatarUrl = String(rawPrincipal.avatarUrl || '').trim() || null;
  const provider = String(rawPrincipal.provider || 'discord_oauth').trim().toLowerCase();

  return {
    type,
    id,
    username,
    displayName,
    avatarUrl,
    provider,
    guildIds,
    guildMemberships,
  };
}

function createPrincipalFromDiscordIdentity({ user = null, guildIds = [], guildMemberships = [] } = {}) {
  if (!user || typeof user !== 'object') return null;
  const id = String(user.id || '').trim();
  if (!id) return null;

  const username = String(user.username || '').trim() || null;
  const globalName = String(user.globalName || '').trim() || null;
  const avatarHash = String(user.avatar || '').trim() || null;

  return normalizePrincipal({
    type: 'discord_user',
    id,
    username,
    displayName: globalName || username,
    avatarUrl:
      avatarHash && id
        ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(avatarHash)}.png`
        : null,
    provider: 'discord_oauth',
    guildIds,
    guildMemberships,
  });
}

module.exports = {
  createPrincipalFromDiscordIdentity,
  createAnonymousPrincipal,
  normalizeGuildMembership,
  normalizePrincipal,
};
