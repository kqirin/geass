const TAG_ROLE_SYNC_EXEMPT_USER_IDS = Object.freeze([
  '787960730975993896',
  '763898226562564116',
  '1477005738361618565',
]);

const TAG_ROLE_SYNC_EXEMPT_USER_ID_SET = new Set(TAG_ROLE_SYNC_EXEMPT_USER_IDS);

function normalizeUserId(value) {
  return String(value || '').trim();
}

function getMemberUserId(member) {
  return normalizeUserId(member?.id || member?.user?.id);
}

function isTagRoleSyncExemptUser(memberOrUserId) {
  const userId =
    typeof memberOrUserId === 'string' || typeof memberOrUserId === 'number'
      ? normalizeUserId(memberOrUserId)
      : getMemberUserId(memberOrUserId);
  return TAG_ROLE_SYNC_EXEMPT_USER_ID_SET.has(userId);
}

function createTagRoleFeature({
  client,
  getTagRoleConfig,
  logSystem = () => {},
  logError = () => {},
  targetGuildId = null,
} = {}) {
  if (!client) throw new Error('createTagRoleFeature: client gerekli');
  if (typeof getTagRoleConfig !== 'function') {
    throw new Error('createTagRoleFeature: getTagRoleConfig fonksiyonu gerekli');
  }

  const inFlight = new Map();
  const warnCooldownMap = new Map();
  const WARN_COOLDOWN_MS = 5 * 60 * 1000;

  function buildMemberKey(member) {
    return `${member.guild.id}:${member.id}`;
  }

  function withMemberLock(member, task) {
    const key = buildMemberKey(member);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = Promise.resolve()
      .then(task)
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  async function resolvePrimaryGuild(member, { allowUserRefresh = true } = {}) {
    let user = member.user;
    let primaryGuild = user?.primaryGuild || null;

    // `primaryGuild` payload may be missing/stale on member update payloads.
    if (
      allowUserRefresh &&
      (!primaryGuild || primaryGuild.identityGuildId == null || primaryGuild.identityEnabled == null)
    ) {
      user = await user.fetch(true).catch(() => user);
      primaryGuild = user?.primaryGuild || null;
    }

    return primaryGuild;
  }

  function shouldHandleGuild(guildId) {
    return !targetGuildId || targetGuildId === guildId;
  }

  function warnThrottled(key, message) {
    const now = Date.now();
    const last = Number(warnCooldownMap.get(key) || 0);
    if (now - last < WARN_COOLDOWN_MS) return;
    warnCooldownMap.set(key, now);
    logSystem(message, 'WARN');
  }

  async function syncTagRole(member, reason = 'event', options = {}) {
    const memberId = getMemberUserId(member);
    if (isTagRoleSyncExemptUser(memberId)) {
      return { ok: true, action: 'exempt_skipped', exempt: true, userId: memberId };
    }
    if (!member?.guild || member.user?.bot) return { ok: false, code: 'skip_member_invalid' };
    if (!shouldHandleGuild(member.guild.id)) return { ok: false, code: 'skip_target_guild_filter' };

    return withMemberLock(member, async () => {
      try {
        const cfg = getTagRoleConfig(member.guild.id) || {};
        const enabled = cfg.enabled === true;
        const roleId = String(cfg.roleId || '').trim();
        if (!enabled) return { ok: false, code: 'skip_disabled' };
        if (!roleId) return { ok: false, code: 'skip_role_missing' };

        const guild = member.guild;
        const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
        const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
        if (!role) return { ok: false, code: 'skip_role_not_found' };

        if (!me?.permissions?.has('ManageRoles')) {
          warnThrottled(`missing_manage_roles:${guild.id}`, `TagRole skip: bot_missing_manage_roles guild=${guild.id}`);
          return { ok: false, code: 'skip_missing_manage_roles' };
        }
        if (me.roles.highest.position <= role.position) {
          warnThrottled(
            `role_hierarchy_too_low:${guild.id}:${role.id}`,
            `TagRole skip: role_hierarchy_too_low guild=${guild.id} role=${role.id}`
          );
          return { ok: false, code: 'skip_role_hierarchy_too_low' };
        }
        if (!member.manageable) return { ok: false, code: 'skip_member_not_manageable' };

        const primaryGuild = await resolvePrimaryGuild(member, {
          allowUserRefresh: options.allowUserRefresh !== false,
        });
        const shouldHaveRole = primaryGuild?.identityEnabled === true && String(primaryGuild.identityGuildId || '') === String(guild.id);
        const hasRole = member.roles.cache.has(roleId);

        if (shouldHaveRole && !hasRole) {
          await member.roles.add(roleId, `tag-role:auto-add:${reason}`);
          return { ok: true, action: 'added' };
        }
        if (!shouldHaveRole && hasRole) {
          await member.roles.remove(roleId, `tag-role:auto-remove:${reason}`);
          return { ok: true, action: 'removed' };
        }
        return { ok: true, action: 'noop' };
      } catch (err) {
        logError('tag_role_sync_failed', err, {
          guildId: member.guild?.id,
          userId: member.id,
          reason,
        });
        return { ok: false, code: 'exception' };
      }
    });
  }

  async function syncGuild(guildId, reason = 'manual') {
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { ok: false, code: 'guild_not_found' };
    if (!shouldHandleGuild(guild.id)) return { ok: false, code: 'skip_target_guild_filter' };

    const cfg = getTagRoleConfig(guild.id) || {};
    if (cfg.enabled !== true || !String(cfg.roleId || '').trim()) {
      return { ok: false, code: 'disabled_or_incomplete' };
    }

    const cachedMembersOnly = reason === 'startup' || reason === 'settings_save';
    const members = [...guild.members.cache.values()];
    let added = 0;
    let removed = 0;
    let failed = 0;
    let exemptSkipped = 0;
    const failCodes = {};
    for (const member of members) {
      if (isTagRoleSyncExemptUser(member)) {
        exemptSkipped += 1;
        continue;
      }
      const result = await syncTagRole(member, reason, {
        allowUserRefresh: !cachedMembersOnly || member.roles.cache.has(cfg.roleId),
      });
      if (result.action === 'exempt_skipped') {
        exemptSkipped += 1;
        continue;
      }
      if (!result.ok) {
        failed += 1;
        const code = String(result.code || 'unknown');
        failCodes[code] = (failCodes[code] || 0) + 1;
        continue;
      }
      if (result.action === 'added') added += 1;
      if (result.action === 'removed') removed += 1;
    }

    const processed = members.length - exemptSkipped;
    const failSummary = failed > 0 ? ` failCodes=${JSON.stringify(failCodes)}` : '';
    const partial = cachedMembersOnly && guild.memberCount > members.length;
    logSystem(
      `TagRole sync guild=${guild.id} scanned=${members.length} exemptSkipped=${exemptSkipped} processed=${processed} added=${added} removed=${removed} failed=${failed} partial=${partial}${failSummary}`,
      'INFO'
    );
    return { ok: true, added, removed, failed, scanned: members.length, processed, exemptSkipped, partial };
  }

  async function syncAllGuilds(reason = 'startup') {
    for (const guild of client.guilds.cache.values()) {
      await syncGuild(guild.id, reason);
    }
  }

  return {
    syncTagRole,
    syncGuild,
    syncAllGuilds,
  };
}

module.exports = { createTagRoleFeature };
