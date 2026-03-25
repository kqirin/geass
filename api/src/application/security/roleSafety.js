function toPermissionList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((perm) => String(perm || '').trim())
    .filter(Boolean);
}

async function resolveBotMember(guild) {
  if (!guild) return null;
  if (guild.members?.me) return guild.members.me;
  if (typeof guild.members?.fetchMe !== 'function') return null;
  return guild.members.fetchMe().catch(() => null);
}

function getHighestRolePosition(member) {
  return Number(member?.roles?.highest?.position || 0);
}

function isRoleBelowMemberTop(member, role) {
  if (!member || !role) return false;
  return getHighestRolePosition(member) > Number(role.position || 0);
}

function getMissingDiscordPermissions(member, requiredPermissions = []) {
  const needed = toPermissionList(requiredPermissions);
  if (!needed.length) return [];
  return needed.filter((perm) => !member?.permissions?.has?.(perm));
}

module.exports = {
  resolveBotMember,
  getHighestRolePosition,
  isRoleBelowMemberTop,
  getMissingDiscordPermissions,
};
