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

  async function resolvePrimaryGuild(member) {
    let user = member.user;
    let primaryGuild = user?.primaryGuild || null;

    // `primaryGuild` payload may be missing/stale on member update payloads.
    if (!primaryGuild || primaryGuild.identityGuildId == null || primaryGuild.identityEnabled == null) {
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

  async function syncTagRole(member, reason = 'event') {
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

        const primaryGuild = await resolvePrimaryGuild(member);
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

    await guild.members.fetch().catch(() => null);
    let added = 0;
    let removed = 0;
    let failed = 0;
    const failCodes = {};
    for (const member of guild.members.cache.values()) {
      const result = await syncTagRole(member, reason);
      if (!result.ok) {
        failed += 1;
        const code = String(result.code || 'unknown');
        failCodes[code] = (failCodes[code] || 0) + 1;
        continue;
      }
      if (result.action === 'added') added += 1;
      if (result.action === 'removed') removed += 1;
    }

    const failSummary = failed > 0 ? ` failCodes=${JSON.stringify(failCodes)}` : '';
    logSystem(`TagRole sync guild=${guild.id} added=${added} removed=${removed} failed=${failed}${failSummary}`, 'INFO');
    return { ok: true, added, removed, failed };
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
