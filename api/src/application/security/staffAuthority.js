function normalizeId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^\d]/g, '');
}

function normalizeStaffHierarchyRoles(rawValue) {
  const list = String(rawValue || '')
    .split(',')
    .map((item) => normalizeId(item))
    .filter(Boolean);

  return [...new Set(list)];
}

function resolveMemberAuthority(member, hierarchyRoleIds = []) {
  const normalizedHierarchy = Array.isArray(hierarchyRoleIds) ? hierarchyRoleIds : [];
  if (!member?.roles?.cache || normalizedHierarchy.length === 0) {
    return {
      level: null,
      rankIndex: null,
      matchedRoleId: null,
    };
  }

  for (let index = 0; index < normalizedHierarchy.length; index += 1) {
    const roleId = normalizedHierarchy[index];
    if (!member.roles.cache.has(roleId)) continue;
    return {
      level: normalizedHierarchy.length - index,
      rankIndex: index,
      matchedRoleId: roleId,
    };
  }

  return {
    level: null,
    rankIndex: null,
    matchedRoleId: null,
  };
}

function compareMemberAuthority(actorAuthority, targetAuthority, options = {}) {
  const actorLevel = Number(actorAuthority?.level || 0);
  const targetLevel = Number(targetAuthority?.level || 0);
  const hierarchyConfigured = options.hierarchyConfigured !== false;

  if (!hierarchyConfigured) {
    return {
      allowed: false,
      reason: 'hierarchy_not_configured',
      actorLevel: actorLevel > 0 ? actorLevel : null,
      targetLevel: targetLevel > 0 ? targetLevel : null,
    };
  }

  if (targetLevel <= 0) {
    if (actorLevel <= 0) {
      return {
        allowed: false,
        reason: 'actor_role_not_high_enough',
        actorLevel: null,
        targetLevel: null,
      };
    }

    return {
      allowed: true,
      reason: 'actor_staff_over_nonstaff',
      actorLevel,
      targetLevel: null,
    };
  }

  if (actorLevel <= 0) {
    return {
      allowed: false,
      reason: 'actor_role_not_high_enough',
      actorLevel: null,
      targetLevel,
    };
  }

  if (actorLevel <= targetLevel) {
    return {
      allowed: false,
      reason: 'actor_role_not_high_enough',
      actorLevel,
      targetLevel,
    };
  }

  return {
    allowed: true,
    reason: 'actor_staff_higher',
    actorLevel,
    targetLevel,
  };
}

module.exports = {
  normalizeStaffHierarchyRoles,
  resolveMemberAuthority,
  compareMemberAuthority,
};
