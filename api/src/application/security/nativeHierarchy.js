function normalizeId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^\d]/g, '');
}

function normalizeIdSet(rawSet) {
  if (rawSet instanceof Set) {
    return new Set(
      [...rawSet]
        .map((value) => normalizeId(value))
        .filter(Boolean)
    );
  }

  if (!Array.isArray(rawSet)) return new Set();

  return new Set(
    rawSet
      .map((value) => normalizeId(value))
      .filter(Boolean)
  );
}

function toRolePosition(role) {
  const position = Number(role?.position);
  return Number.isFinite(position) ? position : 0;
}

function resolveHighestRole(member) {
  if (!member?.roles?.cache) {
    return {
      id: null,
      position: null,
    };
  }

  const highest = member?.roles?.highest || null;
  if (highest?.id) {
    return {
      id: String(highest.id),
      position: toRolePosition(highest),
    };
  }

  if (member?.roles?.cache?.values) {
    let resolvedHighest = null;
    for (const role of member.roles.cache.values()) {
      if (!resolvedHighest || toRolePosition(role) > toRolePosition(resolvedHighest)) {
        resolvedHighest = role;
      }
    }

    if (resolvedHighest?.id) {
      return {
        id: String(resolvedHighest.id),
        position: toRolePosition(resolvedHighest),
      };
    }
  }

  return {
    id: null,
    position: 0,
  };
}

function buildMemberHierarchyState(member, guildOwnerId = null) {
  const memberId = String(member?.id || '').trim() || null;
  const highestRole = resolveHighestRole(member);

  return {
    memberId,
    highestRoleId: highestRole.id,
    highestRolePosition: highestRole.position,
    isOwner: Boolean(memberId && guildOwnerId && memberId === String(guildOwnerId)),
    isResolved: Boolean(memberId && member?.roles?.cache),
  };
}

function buildModerationAuthoritySnapshot({
  actorMember = null,
  targetMember = null,
  botMember = null,
  guildOwnerId = null,
} = {}) {
  const actor = buildMemberHierarchyState(actorMember, guildOwnerId);
  const target = buildMemberHierarchyState(targetMember, guildOwnerId);
  const bot = buildMemberHierarchyState(botMember, guildOwnerId);

  return {
    actorHighestRoleId: actor.highestRoleId,
    actorHighestRolePosition: actor.highestRolePosition,
    targetHighestRoleId: target.highestRoleId,
    targetHighestRolePosition: target.highestRolePosition,
    botHighestRoleId: bot.highestRoleId,
    botHighestRolePosition: bot.highestRolePosition,
    isActorOwner: actor.isOwner,
    isTargetOwner: target.isOwner,
    isBotOwner: bot.isOwner,
    actorMemberResolved: actor.isResolved,
    targetMemberResolved: target.isResolved,
    botMemberResolved: bot.isResolved,
  };
}

function targetHasProtectedRole(targetMember, hardProtectedRoleIds) {
  if (!targetMember?.roles?.cache) return false;
  const normalizedProtectedRoleIds = normalizeIdSet(hardProtectedRoleIds);
  if (normalizedProtectedRoleIds.size === 0) return false;
  return targetMember.roles.cache.some((role) => normalizedProtectedRoleIds.has(role.id));
}

function evaluateNativeActorHierarchy({
  actorMember = null,
  targetMember = null,
  botMember = null,
  guildOwnerId = null,
  botUserId = null,
  hardProtectedRoleIds = new Set(),
  hardProtectedUserIds = new Set(),
} = {}) {
  const snapshot = buildModerationAuthoritySnapshot({
    actorMember,
    targetMember,
    botMember,
    guildOwnerId,
  });

  if (!actorMember?.id || !actorMember?.roles?.cache) {
    return {
      allowed: false,
      reasonCode: 'actor_member_not_found',
      ...snapshot,
    };
  }

  if (!targetMember?.id || !targetMember?.roles?.cache) {
    return {
      allowed: false,
      reasonCode: 'target_member_not_found',
      ...snapshot,
    };
  }

  if (actorMember.id === targetMember.id) {
    return {
      allowed: false,
      reasonCode: 'self_target',
      ...snapshot,
    };
  }

  if (guildOwnerId && String(targetMember.id) === String(guildOwnerId)) {
    return {
      allowed: false,
      reasonCode: 'target_is_owner',
      ...snapshot,
    };
  }

  if (botUserId && String(targetMember.id) === String(botUserId)) {
    return {
      allowed: false,
      reasonCode: 'target_is_bot',
      ...snapshot,
    };
  }

  const normalizedProtectedUserIds = normalizeIdSet(hardProtectedUserIds);
  const targetProtectedByUser = normalizedProtectedUserIds.has(String(targetMember.id));
  const targetProtectedByRole = targetHasProtectedRole(targetMember, hardProtectedRoleIds);
  if (targetProtectedByUser || targetProtectedByRole) {
    return {
      allowed: false,
      reasonCode: 'protected_target',
      targetProtectedByUser,
      targetProtectedByRole,
      ...snapshot,
    };
  }

  if (guildOwnerId && String(actorMember.id) === String(guildOwnerId)) {
    return {
      allowed: true,
      reasonCode: 'actor_is_owner_override',
      ...snapshot,
    };
  }

  const actorPosition = Number(snapshot.actorHighestRolePosition);
  const targetPosition = Number(snapshot.targetHighestRolePosition);

  if (!Number.isFinite(actorPosition) || !Number.isFinite(targetPosition)) {
    return {
      allowed: false,
      reasonCode: 'invalid_target_state',
      ...snapshot,
    };
  }

  if (actorPosition <= targetPosition) {
    return {
      allowed: false,
      reasonCode: 'actor_hierarchy_not_high_enough',
      positionDelta: actorPosition - targetPosition,
      ...snapshot,
    };
  }

  return {
    allowed: true,
    reasonCode: 'actor_hierarchy_allowed',
    positionDelta: actorPosition - targetPosition,
    ...snapshot,
  };
}

module.exports = {
  buildMemberHierarchyState,
  buildModerationAuthoritySnapshot,
  evaluateNativeActorHierarchy,
  normalizeIdSet,
  resolveHighestRole,
};
