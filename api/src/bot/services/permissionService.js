const cache = require('../../utils/cache');
const {
  buildModerationAuthoritySnapshot,
  evaluateNativeActorHierarchy,
} = require('../../application/security/nativeHierarchy');
const {
  resolveBotMember,
  getHighestRolePosition,
  isRoleBelowMemberTop,
  getMissingDiscordPermissions,
} = require('../../application/security/roleSafety');
const {
  normalizeActionBucket,
} = require('./actionNormalization');

const HIERARCHY_CHECK_COMMANDS = new Set([
  'warn',
  'mute',
  'kick',
  'jail',
  'ban',
  'vcmute',
]);

const MODERATION_NATIVE_ACTOR_PERMISSIONS = Object.freeze({
  warn: 'ModerateMembers',
  mute: 'ModerateMembers',
  kick: 'KickMembers',
  ban: 'BanMembers',
  jail: 'BanMembers',
});

function normalizeIdListValue(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((x) =>
      String(x || '')
        .trim()
        .replace(/[^\d]/g, '')
    )
    .filter(Boolean);
}

function createPermissionService({ config, auditLogger = null }) {
  const ABUSE_THRESHOLD = config.moderation.abuseThreshold;
  const ONE_HOUR = 60 * 60 * 1000;
  const UNAUTH_REPLY_COOLDOWN_MS = config.moderation.unauthReplyCooldownMs;
  const UNAUTH_WINDOW_MS = config.moderation.unauthWindowMs;
  const UNAUTH_MAX_ATTEMPTS = config.moderation.unauthMaxAttempts;
  const UNAUTH_BLOCK_MS = config.moderation.unauthBlockMs;

  const limitWarnCooldown = new Map();
  const abuseCounter = new Map();
  const unauthorizedSpam = new Map();
  const executionLocks = new Map();

  let pruneTick = 0;

  function resolveActionBucket(rawAction) {
    const bucket = normalizeActionBucket(rawAction);
    if (bucket) return bucket;
    return String(rawAction || '').trim().toLowerCase();
  }

  function maybePruneModerationCaches() {
    pruneTick += 1;
    if (pruneTick % 500 !== 0) return;

    const now = Date.now();
    const warnTtl = ONE_HOUR * 2;

    for (const [key, ts] of limitWarnCooldown) {
      if (now - ts > warnTtl) limitWarnCooldown.delete(key);
    }

    for (const [key, entry] of abuseCounter) {
      if (!entry || now - entry.firstTs > ONE_HOUR) abuseCounter.delete(key);
    }

    for (const [key, entry] of unauthorizedSpam) {
      if (!entry) {
        unauthorizedSpam.delete(key);
        continue;
      }

      const windowExpired = now - entry.windowStart > UNAUTH_WINDOW_MS * 3;
      const replyExpired = now - entry.lastReplyTs > UNAUTH_WINDOW_MS * 3;
      const blockExpired = !entry.blockedUntil || entry.blockedUntil <= now;

      if (windowExpired && replyExpired && blockExpired) unauthorizedSpam.delete(key);
    }
  }

  function registerUnauthorizedAttempt(guildId, userId, cmdType) {
    const key = `${guildId}:${userId}:${cmdType}`;
    const now = Date.now();
    const cur = unauthorizedSpam.get(key) || {
      windowStart: now,
      count: 0,
      lastReplyTs: 0,
      blockedUntil: 0,
    };

    if (cur.blockedUntil > now) {
      unauthorizedSpam.set(key, cur);
      return { shouldReply: false };
    }

    if (now - cur.windowStart > UNAUTH_WINDOW_MS) {
      cur.windowStart = now;
      cur.count = 0;
    }

    cur.count += 1;
    if (cur.count >= UNAUTH_MAX_ATTEMPTS) {
      cur.blockedUntil = now + UNAUTH_BLOCK_MS;
      cur.count = 0;
      cur.windowStart = now;
    }

    const shouldReply = now - cur.lastReplyTs >= UNAUTH_REPLY_COOLDOWN_MS;
    if (shouldReply) cur.lastReplyTs = now;

    unauthorizedSpam.set(key, cur);
    return { shouldReply };
  }

  function getCmdSetting(settings, cmdType, suffix, fallback = null) {
    const key = `${cmdType}_${suffix}`;
    if (!Object.prototype.hasOwnProperty.call(settings || {}, key)) return fallback;
    return settings[key];
  }

  function normalizeSafeListValue(rawValue) {
    return String(rawValue || '')
      .split(',')
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join(',');
  }

  function mapHierarchyReasonToTemplate(reason) {
    if (reason === 'actor_hierarchy_not_high_enough') return 'targetRoleHigher';
    return 'operationNotAllowed';
  }

  function buildHardProtectedRoleSet(settings) {
    return new Set(normalizeIdListValue(settings?.hard_protected_roles || settings?.protected_role_ids || ''));
  }

  function buildHardProtectedUserSet(settings) {
    return new Set(normalizeIdListValue(settings?.hard_protected_users || settings?.protected_user_ids || ''));
  }

  function normalizeExecution(execution) {
    if (!execution || typeof execution !== 'object') return null;
    return execution;
  }

  function buildActionConfig(settings, cmdType) {
    const bucket = resolveActionBucket(cmdType);
    const enabledValue = getCmdSetting(settings, bucket, 'enabled', false);
    return {
      actionBucket: bucket,
      enabled: enabledValue === true || enabledValue === 1 || enabledValue === '1',
      allowedRole: getCmdSetting(settings, bucket, 'role', null),
      safeList: normalizeSafeListValue(getCmdSetting(settings, bucket, 'safe_list', '')),
      limit: getCmdSetting(settings, bucket, 'limit', 0),
    };
  }

  function resolveNativeActorPermission(actionBucket) {
    const key = String(actionBucket || '').trim().toLowerCase();
    return MODERATION_NATIVE_ACTOR_PERMISSIONS[key] || null;
  }

  async function resolveAuthoritativeActorMember(message, actorId) {
    const fallbackMember = message?.member || null;
    if (!actorId || typeof message?.guild?.members?.fetch !== 'function') return fallbackMember;

    try {
      const member = await message.guild.members.fetch(actorId);
      return member?.roles?.cache ? member : fallbackMember;
    } catch {
      return null;
    }
  }

  async function resolveAuthoritativeAllowedRole(message, roleId) {
    if (!roleId) return null;
    return (
      message?.guild?.roles?.cache?.get?.(roleId) ||
      (await message?.guild?.roles?.fetch?.(roleId).catch(() => null))
    );
  }

  async function resolveAuthoritativeTargetMember(message, targetId, fallbackMember = null) {
    if (!targetId || typeof message?.guild?.members?.fetch !== 'function') return fallbackMember;

    try {
      const member = await message.guild.members.fetch(targetId);
      return member?.roles?.cache ? member : fallbackMember;
    } catch {
      return fallbackMember;
    }
  }

  async function acquireExecutionLock(lockKey) {
    const key = String(lockKey || '').trim();
    if (!key) return () => {};

    const previous = executionLocks.get(key) || Promise.resolve();
    let releaseResolver = null;
    const current = new Promise((resolve) => {
      releaseResolver = resolve;
    });

    const queued = previous
      .catch(() => {})
      .then(() => current);
    executionLocks.set(key, queued);

    await previous.catch(() => {});

    return () => {
      if (executionLocks.get(key) === queued) executionLocks.delete(key);
      releaseResolver?.();
    };
  }

  async function evaluateExecutionRequirements({
    message,
    targetMember,
    settings,
    execution,
    botMember = null,
  }) {
    const normalized = normalizeExecution(execution);
    if (!normalized) return { ok: true, context: {} };

    const fail = (reasonCode, templateKey = 'operationNotAllowed', details = {}, iconUser = null) => ({
      ok: false,
      reasonCode,
      templateKey,
      details,
      iconUser,
      context: {},
    });

    if (normalized.requireTargetMember && !targetMember?.roles) {
      return fail('invalid_target_state', normalized.invalidTargetTemplate || 'userNotFound', {
        check: 'require_target_member',
      });
    }

    if (normalized.requireTargetInVoice && (!targetMember?.voice || !targetMember.voice.channel)) {
      return fail('invalid_target_state', normalized.targetNotInVoiceTemplate || 'notInVoice', {
        check: 'require_target_in_voice',
      }, targetMember?.user || null);
    }

    const requiredBotPermissions = Array.isArray(normalized.requiredBotPermissions)
      ? normalized.requiredBotPermissions
      : [];

    const me = botMember || (await resolveBotMember(message.guild));
    if (!me?.roles?.cache) {
      return fail('bot_member_not_found', 'operationNotAllowed', {
        check: 'bot_member_resolve',
      });
    }

    const missingPermissions = getMissingDiscordPermissions(me, requiredBotPermissions);
    if (missingPermissions.length > 0) {
      return fail('bot_missing_discord_permission', 'operationNotAllowed', { missingPermissions });
    }

    const context = {
      botMember: me || null,
      managedRoleId: null,
      managedRole: null,
    };

    if (normalized.managedRoleSettingKey) {
      const roleId = String(settings?.[normalized.managedRoleSettingKey] || '').trim();
      if (!roleId) {
        return fail('invalid_target_state', normalized.managedRoleMissingTemplate || 'roleNotConfigured', {
          settingKey: normalized.managedRoleSettingKey,
        });
      }

      const roleObj =
        message.guild.roles.cache.get(roleId) || (await message.guild.roles.fetch(roleId).catch(() => null));
      if (!roleObj) {
        return fail('invalid_target_state', normalized.managedRoleMissingTemplate || 'roleNotConfigured', {
          settingKey: normalized.managedRoleSettingKey,
          roleId,
        });
      }

      context.managedRoleId = roleId;
      context.managedRole = roleObj;

      if (normalized.requireBotRoleAboveManagedRole && !isRoleBelowMemberTop(me, roleObj)) {
        return fail('bot_hierarchy_not_high_enough', 'operationNotAllowed', {
          botTop: getHighestRolePosition(me),
          roleId,
          rolePosition: Number(roleObj.position || 0),
        });
      }
    }

    if (normalized.requireTargetManageable && !targetMember?.manageable) {
      return fail('bot_hierarchy_not_high_enough', 'operationNotAllowed', {
        check: 'target_manageable',
      });
    }

    if (normalized.requireTargetModeratable && !targetMember?.moderatable) {
      if (
        normalized.targetModeratableDeniedReasonCode &&
        targetMember?.permissions?.has?.('Administrator')
      ) {
        return fail(
          normalized.targetModeratableDeniedReasonCode,
          normalized.targetModeratableDeniedTemplate || 'operationNotAllowed',
          {
            check: 'target_moderatable',
            targetIsAdministrator: true,
          },
          targetMember?.user || null
        );
      }

      return fail('bot_hierarchy_not_high_enough', 'operationNotAllowed', {
        check: 'target_moderatable',
      });
    }

    if (normalized.requireTargetKickable && !targetMember?.kickable) {
      return fail('bot_hierarchy_not_high_enough', 'operationNotAllowed', {
        check: 'target_kickable',
      });
    }

    if (normalized.requireTargetBannable && !targetMember?.bannable) {
      return fail('bot_hierarchy_not_high_enough', 'operationNotAllowed', {
        check: 'target_bannable',
      });
    }

    return { ok: true, context };
  }

  async function evaluateSharedRateLimit({
    guildId,
    actorId,
    actionBucket,
    limit,
    safeList,
    allowedRole,
    allowAbuseLock = true,
    actorMember,
    consume = false,
  }) {
    let limitCheck = null;
    try {
      limitCheck = consume
        ? await cache.consumeLimit(guildId, actorId, actionBucket, limit, safeList)
        : await cache.checkLimit(guildId, actorId, actionBucket, limit, safeList);
    } catch (err) {
      return {
        ok: false,
        stage: 'rate_limit',
        reasonCode: consume ? 'rate_limit_consume_failed' : 'rate_limit_check_failed',
        details: {
          limit,
          error: String(err?.code || err?.message || 'rate_limit_failed'),
          consume,
        },
      };
    }

    if (limitCheck.allowed) {
      return {
        ok: true,
        key: limitCheck.key,
        details: {
          count: limitCheck.count,
          store: limitCheck.store,
        },
      };
    }

    const abuseKey = `${guildId}:${actorId}:${actionBucket}`;
    const now = Date.now();
    const entry = abuseCounter.get(abuseKey);
    if (!entry || now - entry.firstTs > ONE_HOUR) {
      abuseCounter.set(abuseKey, { count: 1, firstTs: now });
    } else {
      entry.count += 1;
      abuseCounter.set(abuseKey, entry);
    }

    const current = abuseCounter.get(abuseKey);
    const baseDetails = {
      limit,
      count: limitCheck.count,
      abuseCount: limitCheck.abuseCount,
      abuseAttemptCount: current?.count || 0,
    };

    if (current && current.count >= ABUSE_THRESHOLD) {
      if (!allowAbuseLock) {
        return {
          ok: false,
          stage: 'rate_limit',
          reasonCode: 'rate_limited',
          details: {
            ...baseDetails,
            abuseLock: false,
            abuseLockSkipped: true,
          },
        };
      }

      let removedRole = false;
      let removalErrorCode = null;

      try {
        if (!allowedRole || !actorMember?.roles?.remove) {
          removalErrorCode = 'abuse_lock_target_missing';
        } else {
          await actorMember.roles.remove(allowedRole);
          removedRole = true;
        }
      } catch (err) {
        removalErrorCode = String(err?.code || err?.message || 'abuse_lock_remove_failed');
      }

      if (removedRole) {
        abuseCounter.delete(abuseKey);
        return {
          ok: false,
          stage: 'rate_limit',
          reasonCode: 'rate_limited',
          details: {
            ...baseDetails,
            abuseLock: true,
            removedRoleId: allowedRole,
          },
        };
      }

      return {
        ok: false,
        stage: 'rate_limit',
        reasonCode: 'abuse_lock_apply_failed',
        details: {
          ...baseDetails,
          abuseLock: false,
          abuseLockFailed: true,
          removedRoleId: allowedRole,
          removalErrorCode,
        },
      };
    }

    return {
      ok: false,
      stage: 'rate_limit',
      reasonCode: 'rate_limited',
      details: baseDetails,
    };
  }

  async function verifyPermission({
    message,
    targetMember,
    targetId = null,
    settings,
    cmdType,
    actionCommand = null,
    sendTemplate,
    contextBase = {},
    execution = null,
    safeListBypassesRoleRestriction = false,
    authoritativeActorRoleCheck = false,
  }) {
    const replyTemplate = async (templateKey, context, iconUser) => {
      return sendTemplate(templateKey, { ...contextBase, ...(context || {}) }, { iconUser });
    };

    const guildId = message.guild?.id || null;
    const guildOwnerId = message.guild?.ownerId || null;
    const actorId = message.author?.id || null;
    const botUserId = message.client?.user?.id || null;
    const resolvedTargetId = String(targetMember?.id || targetId || '').trim() || null;
    const safeCmdType = String(cmdType || '').trim().toLowerCase();
    const commandName = String(actionCommand || cmdType || '').trim().toLowerCase() || safeCmdType;
    const actionConfig = buildActionConfig(settings, safeCmdType);
    const actionBucket = actionConfig.actionBucket;
    const nativeActorPermission = resolveNativeActorPermission(actionBucket);
    const safeListIds = normalizeIdListValue(actionConfig.safeList);
    const actorIsSafeListed = actorId ? safeListIds.includes(String(actorId)) : false;
    const normalizedExecution = normalizeExecution(execution);
    const hardProtectedRoleIds = buildHardProtectedRoleSet(settings);
    const hardProtectedUserIds = buildHardProtectedUserSet(settings);

    let actorMember = null;
    let authoritativeTargetMember = targetMember?.roles?.cache ? targetMember : null;
    let botMember = null;

    const buildAuthoritySnapshot = (overrides = {}) =>
      buildModerationAuthoritySnapshot({
        actorMember: Object.prototype.hasOwnProperty.call(overrides, 'actorMember')
          ? overrides.actorMember
          : actorMember,
        targetMember: Object.prototype.hasOwnProperty.call(overrides, 'targetMember')
          ? overrides.targetMember
          : authoritativeTargetMember,
        botMember: Object.prototype.hasOwnProperty.call(overrides, 'botMember')
          ? overrides.botMember
          : botMember,
        guildOwnerId,
      });

    const emitAudit = (payload) => {
      if (typeof auditLogger !== 'function') return;
      try {
        auditLogger({
          timestamp: Date.now(),
          guildId,
          actorId,
          targetId: resolvedTargetId,
          command: commandName,
          permissionCommand: safeCmdType,
          actionBucket,
          actionType: actionBucket,
          source: 'command',
          ...payload,
        });
      } catch { }
    };

    const deny = async ({
      stage,
      reasonCode,
      templateKey = 'operationNotAllowed',
      templateContext = {},
      iconUser = null,
      details = {},
      suppressReply = false,
      authoritySnapshot = null,
    }) => {
      const resolvedAuthoritySnapshot = authoritySnapshot || buildAuthoritySnapshot();
      emitAudit({
        allowed: false,
        stage,
        reasonCode,
        ...(resolvedAuthoritySnapshot || {}),
        details,
      });
      if (!suppressReply) {
        await replyTemplate(templateKey, templateContext, iconUser || message.author);
      }
      return {
        success: false,
        stage,
        reasonCode,
        details,
        actionBucket,
        authoritySnapshot: resolvedAuthoritySnapshot,
      };
    };

    if (!actionConfig.enabled) {
      const { shouldReply } = registerUnauthorizedAttempt(guildId, actorId, commandName);
      return deny({
        stage: 'command_gate',
        reasonCode: 'command_disabled',
        templateKey: 'permissionDenied',
        iconUser: message.author,
        suppressReply: !shouldReply,
      });
    }

    const bypassRoleRestriction = Boolean(safeListBypassesRoleRestriction && actorIsSafeListed);

    if (!nativeActorPermission && !actionConfig.allowedRole && !bypassRoleRestriction) {
      const { shouldReply } = registerUnauthorizedAttempt(guildId, actorId, commandName);
      return deny({
        stage: 'command_gate',
        reasonCode: 'missing_command_permission',
        templateKey: 'roleNotConfigured',
        iconUser: message.author,
        details: { missing: 'command_role_not_configured' },
        suppressReply: !shouldReply,
      });
    }

    actorMember = await resolveAuthoritativeActorMember(message, actorId);
    if (!actorMember?.roles?.cache) {
      return deny({
        stage: 'command_gate',
        reasonCode: 'actor_member_not_found',
        templateKey: 'operationNotAllowed',
        iconUser: message.author,
        details: {
          check: 'actor_member_resolve',
        },
      });
    }

    if (nativeActorPermission && !actorMember.permissions?.has?.(nativeActorPermission)) {
      const { shouldReply } = registerUnauthorizedAttempt(guildId, actorId, commandName);
      return deny({
        stage: 'command_gate',
        reasonCode: 'missing_command_permission',
        templateKey: 'permissionDenied',
        iconUser: message.author,
        details: { missing: 'native_actor_permission', requiredPermission: nativeActorPermission },
        suppressReply: !shouldReply,
      });
    }

    if (!nativeActorPermission && !bypassRoleRestriction && actionConfig.allowedRole) {
      const requiredRole =
        authoritativeActorRoleCheck === true || actionConfig.allowedRole
          ? await resolveAuthoritativeAllowedRole(message, actionConfig.allowedRole)
          : null;

      if (!requiredRole) {
        const { shouldReply } = registerUnauthorizedAttempt(guildId, actorId, commandName);
        return deny({
          stage: 'command_gate',
          reasonCode: 'missing_command_permission',
          templateKey: 'roleNotConfigured',
          iconUser: message.author,
          details: { missing: 'command_role_deleted', requiredRoleId: actionConfig.allowedRole },
          suppressReply: !shouldReply,
        });
      }

      if (!actorMember.roles.cache.has(actionConfig.allowedRole)) {
        const { shouldReply } = registerUnauthorizedAttempt(guildId, actorId, commandName);
        return deny({
          stage: 'command_gate',
          reasonCode: 'missing_command_permission',
          templateKey: 'roleInsufficient',
          iconUser: message.author,
          details: { missing: 'command_role_membership', requiredRoleId: actionConfig.allowedRole },
          suppressReply: !shouldReply,
        });
      }
    }

    const requiresTargetMemberForExecution = Boolean(
      normalizedExecution?.requireTargetMember ||
      normalizedExecution?.requireTargetInVoice ||
      normalizedExecution?.requireTargetManageable ||
      normalizedExecution?.requireTargetModeratable ||
      normalizedExecution?.requireTargetKickable ||
      normalizedExecution?.requireTargetBannable
    );
    const requiresTargetMember = HIERARCHY_CHECK_COMMANDS.has(actionBucket) || requiresTargetMemberForExecution;
    const requiresBotContext = Boolean(
      requiresTargetMember ||
      normalizedExecution?.managedRoleSettingKey ||
      (Array.isArray(normalizedExecution?.requiredBotPermissions) &&
        normalizedExecution.requiredBotPermissions.length > 0)
    );

    if (resolvedTargetId && requiresTargetMember) {
      authoritativeTargetMember = await resolveAuthoritativeTargetMember(
        message,
        resolvedTargetId,
        authoritativeTargetMember
      );
    }

    if (requiresBotContext) {
      botMember = await resolveBotMember(message.guild);
    }

    if (!authoritativeTargetMember?.roles && resolvedTargetId && HIERARCHY_CHECK_COMMANDS.has(actionBucket)) {
      if (resolvedTargetId === actorId) {
        return deny({
          stage: 'hierarchy',
          reasonCode: 'self_target',
          templateKey: 'operationNotAllowed',
          iconUser: message.author,
          details: { targetId: resolvedTargetId },
        });
      }
      if (guildOwnerId && resolvedTargetId === String(guildOwnerId)) {
        return deny({
          stage: 'hierarchy',
          reasonCode: 'target_is_owner',
          templateKey: 'operationNotAllowed',
          iconUser: message.client.user,
          details: { targetId: resolvedTargetId },
        });
      }
      if (botUserId && resolvedTargetId === String(botUserId)) {
        return deny({
          stage: 'hierarchy',
          reasonCode: 'target_is_bot',
          templateKey: 'operationNotAllowed',
          iconUser: message.client.user,
          details: { targetId: resolvedTargetId, detail: 'target_is_bot' },
        });
      }
      if (hardProtectedUserIds.has(resolvedTargetId)) {
        return deny({
          stage: 'hierarchy',
          reasonCode: 'protected_target',
          templateKey: 'operationNotAllowed',
          iconUser: message.client.user,
          details: { targetId: resolvedTargetId },
        });
      }
    }

    if (authoritativeTargetMember?.roles && HIERARCHY_CHECK_COMMANDS.has(actionBucket)) {
      const hierarchy = evaluateNativeActorHierarchy({
        actorMember,
        targetMember: authoritativeTargetMember,
        botMember,
        hardProtectedRoleIds,
        hardProtectedUserIds,
        guildOwnerId,
        botUserId,
      });

      if (!hierarchy.allowed) {
        return deny({
          stage: 'hierarchy',
          reasonCode: hierarchy.reasonCode,
          templateKey: mapHierarchyReasonToTemplate(hierarchy.reasonCode),
          iconUser: authoritativeTargetMember.user || message.client.user,
          details: {
            positionDelta: Object.prototype.hasOwnProperty.call(hierarchy, 'positionDelta')
              ? hierarchy.positionDelta
              : null,
            targetProtectedByUser: hierarchy.targetProtectedByUser === true,
            targetProtectedByRole: hierarchy.targetProtectedByRole === true,
          },
          authoritySnapshot: hierarchy,
        });
      }
    }

    const denyRateLimitResult = async (rateLimitResult) => {
      if (rateLimitResult.reasonCode === 'rate_limit_check_failed' || rateLimitResult.reasonCode === 'rate_limit_consume_failed') {
        return deny({
          stage: 'rate_limit',
          reasonCode: rateLimitResult.reasonCode,
          templateKey: 'operationNotAllowed',
          iconUser: message.author,
          details: rateLimitResult.details || {},
          authoritySnapshot: buildAuthoritySnapshot(),
        });
      }

      if (rateLimitResult.reasonCode === 'abuse_lock_apply_failed') {
        return deny({
          stage: 'rate_limit',
          reasonCode: rateLimitResult.reasonCode,
          templateKey: 'limitReached',
          templateContext: { limit: actionConfig.limit },
          iconUser: message.author,
          details: rateLimitResult.details || {},
          authoritySnapshot: buildAuthoritySnapshot(),
        });
      }

      if (rateLimitResult.details?.abuseLock) {
        return deny({
          stage: 'rate_limit',
          reasonCode: 'rate_limited',
          templateKey: 'abuseLock',
          templateContext: { limit: actionConfig.limit },
          iconUser: message.author,
          details: rateLimitResult.details || {},
          authoritySnapshot: buildAuthoritySnapshot(),
        });
      }

      const now = Date.now();
      const cdKey = `${message.guild.id}:${message.author.id}:${actionBucket}:limitwarn`;
      const last = limitWarnCooldown.get(cdKey) || 0;
      if (now - last > 5000) {
        limitWarnCooldown.set(cdKey, now);
        await deny({
          stage: 'rate_limit',
          reasonCode: 'rate_limited',
          templateKey: 'limitReached',
          templateContext: { limit: actionConfig.limit },
          iconUser: message.author,
          details: rateLimitResult.details || {},
          authoritySnapshot: buildAuthoritySnapshot(),
        });
        return { success: false, stage: 'rate_limit', reasonCode: 'rate_limited', actionBucket };
      }

      emitAudit({
        allowed: false,
        stage: 'rate_limit',
        reasonCode: 'rate_limited',
        ...buildAuthoritySnapshot(),
        details: {
          ...(rateLimitResult.details || {}),
          warningSuppressed: true,
        },
      });
      return { success: false, stage: 'rate_limit', reasonCode: 'rate_limited', actionBucket };
    };

    const rateLimitArgs = {
      guildId: message.guild.id,
      actorId: message.author.id,
      actionBucket,
      limit: actionConfig.limit,
      safeList: actionConfig.safeList,
      allowedRole: actionConfig.allowedRole,
      allowAbuseLock: !nativeActorPermission || Boolean(actionConfig.allowedRole),
      actorMember,
    };

    const rateLimitResult = await evaluateSharedRateLimit(rateLimitArgs);
    if (!rateLimitResult.ok) {
      return denyRateLimitResult(rateLimitResult);
    }

    const executionResult = await evaluateExecutionRequirements({
      message,
      targetMember: authoritativeTargetMember,
      settings,
      execution: normalizedExecution,
      botMember,
    });
    if (!executionResult.ok) {
      return deny({
        stage: 'bot_capability',
        reasonCode: executionResult.reasonCode,
        templateKey: executionResult.templateKey || 'operationNotAllowed',
        iconUser: executionResult.iconUser || message.client.user,
        details: executionResult.details || {},
        authoritySnapshot: buildAuthoritySnapshot({
          botMember: executionResult.context?.botMember || botMember,
        }),
      });
    }

    botMember = executionResult.context?.botMember || botMember;

    const consumeLimit = async () => {
      const releaseExecutionLock = await acquireExecutionLock(rateLimitResult.key);
      const consumeResult = await evaluateSharedRateLimit({
        ...rateLimitArgs,
        consume: true,
      });
      if (!consumeResult.ok) {
        releaseExecutionLock();
        await denyRateLimitResult(consumeResult);
        return false;
      }

      let settled = false;
      const settle = async ({ rollback = false } = {}) => {
        if (settled) return;
        settled = true;

        try {
          if (rollback && consumeResult.key) {
            await cache.releaseLimit(consumeResult.key);
          }
        } finally {
          releaseExecutionLock();
        }
      };

      return {
        ok: true,
        key: consumeResult.key,
        store: consumeResult.store || null,
        commit: async () => {
          await settle({ rollback: false });
        },
        rollback: async () => {
          await settle({ rollback: true });
        },
      };
    };

    return {
      success: true,
      key: rateLimitResult.key,
      context: {
        ...(executionResult.context || {}),
        actorMember,
        targetMember: authoritativeTargetMember || null,
        botMember: botMember || executionResult.context?.botMember || null,
        authoritySnapshot: buildAuthoritySnapshot(),
      },
      actionBucket,
      consumeLimit,
    };
  }

  return {
    maybePruneModerationCaches,
    verifyPermission,
  };
}

module.exports = { createPermissionService };
