const reactionRuleRepository = require('../../infrastructure/repositories/reactionRuleRepository');
const {
  normalizeUnicodeEmojiName,
  normalizeEmojiKey: buildEmojiKey,
  isReactionMatch,
} = require('./emoji');
const {
  resolveBotMember,
  getMissingDiscordPermissions,
  isRoleBelowMemberTop,
} = require('../security/roleSafety');

const INTERNAL_COMMANDS = {
  'partner-bilgi': async ({ member }) => {
    const text = 'Partner başvuru bilgisi: Profilini düzgün doldur, aktifliğini koru ve kuralları kabul et.';
    await member.send({ content: text }).catch(() => {});
  },
};
const RULE_CACHE_MISS_TTL_MS = 30 * 1000;

function extractReactionEmoji(reaction) {
  if (!reaction?.emoji) return null;
  if (reaction.emoji?.id) {
    return { emojiType: 'custom', emojiId: reaction.emoji.id, emojiName: reaction.emoji.name || null };
  }
  return { emojiType: 'unicode', emojiId: null, emojiName: normalizeUnicodeEmojiName(reaction.emoji?.name) || null };
}

async function safeFetchReactionPayload(reaction) {
  if (!reaction) return;
  if (reaction.partial && typeof reaction.fetch === 'function') {
    await reaction.fetch().catch(() => null);
  }
  if (reaction.message?.partial && typeof reaction.message.fetch === 'function') {
    await reaction.message.fetch().catch(() => null);
  }
}

function buildRuleCacheKey(rule) {
  return `${rule.guildId}:${rule.messageId}:${buildEmojiKey(rule)}`;
}

function toRuleEmojiIdentifier(rule) {
  if (rule.emojiType === 'custom') {
    const id = String(rule.emojiId || '').trim();
    const name = String(rule.emojiName || '').trim();
    if (!id) return null;
    return name ? `${name}:${id}` : id;
  }
  const name = String(rule.emojiName || '').trim();
  return name || null;
}

function channelHasPermissions(channel, member, permissions = []) {
  const required = (Array.isArray(permissions) ? permissions : [])
    .map((perm) => String(perm || '').trim())
    .filter(Boolean);
  if (!required.length) return true;

  const channelPermissions = channel?.permissionsFor?.(member) || member?.permissions || null;
  if (!channelPermissions?.has) return false;
  return required.every((perm) => channelPermissions.has(perm));
}

function collectRuleChannelPermissions(rule) {
  const permissions = new Set(['ViewChannel', 'ReadMessageHistory']);
  for (const action of Array.isArray(rule?.actions) ? rule.actions : []) {
    if (action?.type === 'REPLY') permissions.add('SendMessages');
    if (action?.type === 'CHANNEL_LINK' && action?.payload?.delivery === 'reply') permissions.add('SendMessages');
    if (action?.type === 'REMOVE_OTHER_REACTIONS_IN_GROUP') permissions.add('ManageMessages');
  }
  return [...permissions];
}

function createReactionActionService({ client, logError = () => {}, logSystem = () => {} } = {}) {
  if (!client) throw new Error('createReactionActionService: client gerekli');

  const ruleCache = new Map();
  const ruleMissCache = new Map();
  const cooldownMap = new Map();
  let pruneTick = 0;

  function pruneCooldown(nowMs) {
    pruneTick += 1;
    if (pruneTick % 100 !== 0) return;
    for (const [key, expiry] of cooldownMap.entries()) {
      if (expiry <= nowMs) cooldownMap.delete(key);
    }
  }

  function pruneMissCache(nowMs) {
    if (pruneTick % 100 !== 0) return;
    for (const [key, expiry] of ruleMissCache.entries()) {
      if (expiry <= nowMs) ruleMissCache.delete(key);
    }
  }

  async function ensureRuleReaction(rule) {
    try {
      const guild = client.guilds.cache.get(rule.guildId) || (await client.guilds.fetch(rule.guildId).catch(() => null));
      if (!guild) return false;

      const channel = guild.channels.cache.get(rule.channelId) || (await guild.channels.fetch(rule.channelId).catch(() => null));
      if (!channel || !channel.isTextBased?.()) return false;

      const message = await channel.messages.fetch(rule.messageId).catch(() => null);
      if (!message) return false;
      if (message.reactions?.cache?.find?.((reaction) => isReactionMatch(rule, reaction))) return true;

      const emojiIdentifier = toRuleEmojiIdentifier(rule);
      if (!emojiIdentifier) return false;

      await message.react(emojiIdentifier);
      return true;
    } catch (err) {
      logError('reaction_rule_seed_failed', err, {
        guildId: rule.guildId,
        ruleId: rule.id,
        channelId: rule.channelId,
        messageId: rule.messageId,
      });
      return false;
    }
  }

  async function refreshGuildRules(guildId, { seedReactions = false } = {}) {
    const all = await reactionRuleRepository.listEnabledRulesByGuild(guildId);
    for (const key of [...ruleCache.keys()]) {
      if (key.startsWith(`${guildId}:`)) ruleCache.delete(key);
    }
    for (const key of [...ruleMissCache.keys()]) {
      if (key.startsWith(`${guildId}:`)) ruleMissCache.delete(key);
    }
    for (const rule of all) {
      const key = buildRuleCacheKey(rule);
      const list = ruleCache.get(key) || [];
      list.push(rule);
      ruleCache.set(key, list);
      if (seedReactions) await ensureRuleReaction(rule);
    }
    return all;
  }

  async function refreshAllRules({ seedReactions = false } = {}) {
    let refreshedGuildCount = 0;
    for (const guild of client.guilds.cache.values()) {
      await refreshGuildRules(guild.id, { seedReactions });
      refreshedGuildCount += 1;
    }
    logSystem(`Reaction rules cache yenilendi: guild=${refreshedGuildCount}`, 'INFO');
  }

  async function fetchMatchingRules(guildId, messageId, emojiMeta) {
    const key = `${guildId}:${messageId}:${buildEmojiKey(emojiMeta)}`;
    const cached = ruleCache.get(key);
    if (cached) return cached;
    const nowMs = Date.now();
    pruneTick += 1;
    const missExpiry = Number(ruleMissCache.get(key) || 0);
    if (missExpiry > nowMs) return [];
    await refreshGuildRules(guildId, { seedReactions: false });
    const refreshed = ruleCache.get(key) || [];
    if (!refreshed.length) {
      ruleMissCache.set(key, nowMs + RULE_CACHE_MISS_TTL_MS);
      pruneMissCache(nowMs);
    }
    return refreshed;
  }

  async function ensureGuildMember(guild, user) {
    if (!guild || !user?.id) return null;
    return guild.members.cache.get(user.id) || (await guild.members.fetch(user.id).catch(() => null));
  }

  function checkRoleConstraints(member, rule) {
    if (!member) return { ok: false, code: 'member_not_found' };
    const allowed = Array.isArray(rule.allowedRoles) ? rule.allowedRoles : [];
    const excluded = Array.isArray(rule.excludedRoles) ? rule.excludedRoles : [];
    if (allowed.length > 0 && !member.roles.cache.some((r) => allowed.includes(r.id))) return { ok: false, code: 'allowed_roles_mismatch' };
    if (excluded.length > 0 && member.roles.cache.some((r) => excluded.includes(r.id))) return { ok: false, code: 'excluded_roles_blocked' };
    return { ok: true };
  }

  function applyCooldown(rule, userId, nowMs) {
    const sec = Number(rule.cooldownSeconds || 0);
    if (sec <= 0) return { ok: true };
    const key = `${rule.id}:${userId}`;
    const expiry = cooldownMap.get(key) || 0;
    if (expiry > nowMs) return { ok: false, code: 'cooldown_active' };
    cooldownMap.set(key, nowMs + sec * 1000);
    pruneCooldown(nowMs);
    return { ok: true };
  }

  function isDangerousRole(role, guild) {
    if (!role || !guild) return true;
    if (role.id === guild.id) return true;
    if (role.permissions?.has?.('Administrator')) return true;
    return false;
  }

  function getGroupSiblingRules(rule) {
    if (!rule?.guildId || !rule?.messageId || !rule?.groupKey) return [];

    const out = [];
    for (const list of ruleCache.values()) {
      for (const candidate of list || []) {
        if (!candidate?.enabled) continue;
        if (candidate.guildId !== rule.guildId) continue;
        if (candidate.messageId !== rule.messageId) continue;
        if (candidate.groupKey !== rule.groupKey) continue;
        if (Number(candidate.id) === Number(rule.id)) continue;
        out.push(candidate);
      }
    }
    return out;
  }

  async function executeAction({ action, eventType, guild, member, channel, reaction, rule }) {
    const payload = action?.payload || {};
    if (!action?.type) return { ok: false, code: 'action_type_missing' };

    if (rule.triggerMode === 'TOGGLE' && eventType === 'REMOVE') {
      if (action.type === 'ROLE_ADD') action = { ...action, type: 'ROLE_REMOVE' };
      else if (action.type === 'ROLE_REMOVE') action = { ...action, type: 'ROLE_ADD' };
      else return { ok: true, code: 'toggle_remove_skip_non_role' };
    }

    if (action.type === 'ROLE_ADD' || action.type === 'ROLE_REMOVE') {
      const roleId = String(payload.roleId || '');
      if (!roleId) return { ok: false, code: 'role_id_missing' };
      const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
      const me = await resolveBotMember(guild);
      const missingPermissions = getMissingDiscordPermissions(me, ['ManageRoles']);
      if (missingPermissions.length > 0) return { ok: false, code: 'bot_missing_manage_roles' };
      if (!role) return { ok: false, code: 'role_not_found' };
      if (isDangerousRole(role, guild)) return { ok: false, code: 'role_blocked_for_safety' };
      if (!isRoleBelowMemberTop(me, role)) return { ok: false, code: 'role_hierarchy_too_low' };
      if (!member?.manageable) return { ok: false, code: 'member_not_manageable' };
      if (action.type === 'ROLE_ADD') await member.roles.add(roleId);
      else await member.roles.remove(roleId);
      return { ok: true };
    }

    if (action.type === 'DM_SEND') {
      const text = String(payload.text || '').slice(0, 1800);
      if (!text) return { ok: false, code: 'dm_text_empty' };
      await member.send({ content: text });
      return { ok: true };
    }

    if (action.type === 'REPLY') {
      const text = String(payload.text || '').slice(0, 1800);
      if (!text) return { ok: false, code: 'reply_text_empty' };
      await channel.send({ content: `<@${member.id}> ${text}`, allowedMentions: { users: [member.id] } });
      return { ok: true };
    }

    if (action.type === 'CHANNEL_LINK') {
      const targetChannelId = String(payload.channelId || '');
      const delivery = payload.delivery === 'reply' ? 'reply' : 'dm';
      if (!targetChannelId) return { ok: false, code: 'channel_id_missing' };
      const link = `https://discord.com/channels/${guild.id}/${targetChannelId}`;
      if (delivery === 'reply') {
        await channel.send({ content: `<@${member.id}> ${link}`, allowedMentions: { users: [member.id] } });
      } else {
        await member.send({ content: link });
      }
      return { ok: true };
    }

    if (action.type === 'RUN_INTERNAL_COMMAND') {
      const command = String(payload.command || '').trim().toLowerCase();
      const fn = INTERNAL_COMMANDS[command];
      if (!fn) return { ok: false, code: 'internal_command_not_whitelisted' };
      await fn({ guild, member, channel, reaction, rule });
      return { ok: true };
    }

    if (action.type === 'REMOVE_OTHER_REACTIONS_IN_GROUP') {
      const groupKey = rule.groupKey;
      if (!groupKey) return { ok: false, code: 'group_key_missing' };
      const groupRules = getGroupSiblingRules(rule);
      const message = reaction?.message || null;
      if (!message?.reactions?.cache?.find) return { ok: false, code: 'message_reactions_unavailable' };
      if (typeof message.reactions.fetch === 'function') {
        await message.reactions.fetch().catch(() => null);
      }

      for (const r of groupRules) {
        const emoji = r.emojiType === 'custom' ? r.emojiId : r.emojiName;
        const targetReaction = message.reactions.cache.find((x) =>
          r.emojiType === 'custom' ? x.emoji.id === emoji : x.emoji.name === emoji
        );
        if (!targetReaction) continue;
        try {
          await targetReaction.users.remove(member.id);
        } catch (err) {
          return {
            ok: false,
            code: String(err?.code || err?.message || 'group_reaction_remove_failed'),
          };
        }
      }
      return { ok: true };
    }

    return { ok: false, code: 'action_not_supported' };
  }

  async function processRule({ rule, eventType, reaction, user, guild, channel }) {
    const nowMs = Date.now();
    const resolvedGuild = guild || reaction?.message?.guild || null;
    const resolvedChannel = channel || reaction?.message?.channel || null;
    if (!resolvedGuild || !resolvedChannel) {
      return { ok: false, code: 'message_context_missing', status: 'ERROR' };
    }

    const member = await ensureGuildMember(resolvedGuild, user);

    if (!member || member.user.bot) return { ok: false, code: 'member_invalid', status: 'SKIPPED' };
    if (!rule.enabled) return { ok: false, code: 'rule_disabled', status: 'SKIPPED' };
    if (rule.triggerMode === 'ADD' && eventType !== 'ADD') return { ok: false, code: 'trigger_mismatch', status: 'SKIPPED' };
    if (rule.triggerMode === 'REMOVE' && eventType !== 'REMOVE') return { ok: false, code: 'trigger_mismatch', status: 'SKIPPED' };

    const constraintCheck = checkRoleConstraints(member, rule);
    if (!constraintCheck.ok) return { ok: false, code: constraintCheck.code, status: 'SKIPPED' };

    const cooldownCheck = applyCooldown(rule, member.id, nowMs);
    if (!cooldownCheck.ok) return { ok: false, code: cooldownCheck.code, status: 'SKIPPED' };

    let onlyOnceExecution = null;
    if (rule.onlyOnce) {
      try {
        onlyOnceExecution = await reactionRuleRepository.tryBeginOnlyOnceExecution({
          guildId: resolvedGuild.id,
          ruleId: rule.id,
          userId: member.id,
          eventType,
        });
      } catch (err) {
        return {
          ok: false,
          code: 'only_once_guard_unavailable',
          status: 'ERROR',
          errorMessage: err?.message || 'only_once_guard_unavailable',
        };
      }

      if (!onlyOnceExecution?.acquired) {
        return {
          ok: false,
          code: onlyOnceExecution?.state === 'SUCCESS'
            ? 'only_once_already_executed'
            : 'only_once_execution_in_progress',
          status: 'SKIPPED',
        };
      }
    }

    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    for (const action of actions) {
      try {
        const result = await executeAction({
          action,
          eventType,
          guild: resolvedGuild,
          member,
          channel: resolvedChannel,
          reaction,
          rule,
        });
        if (!result.ok) {
          return {
            ok: false,
            code: result.code || 'action_failed',
            status: 'ERROR',
            actionType: action?.type || null,
            onlyOnceExecution,
          };
        }
      } catch (err) {
        return {
          ok: false,
          code: 'action_exception',
          status: 'ERROR',
          actionType: action?.type || null,
          errorMessage: err?.message || 'action_exception',
          onlyOnceExecution,
        };
      }
    }
    return { ok: true, status: 'SUCCESS', onlyOnceExecution };
  }

  async function persistRuleResult({ guildId, rule, userId, eventType, result }) {
    const onlyOnceExecution = result?.onlyOnceExecution || null;
    if (onlyOnceExecution?.acquired) {
      if (result.ok) {
        await reactionRuleRepository.markOnlyOnceExecutionSuccess({
          ruleId: rule.id,
          userId,
          eventType,
        });
      } else {
        await reactionRuleRepository.releaseOnlyOnceExecution({
          ruleId: rule.id,
          userId,
          eventType,
        });
      }
    }

    await reactionRuleRepository.logRuleEvent({
      guildId,
      ruleId: rule.id,
      userId,
      eventType,
      status: result.ok ? 'SUCCESS' : (result.status || 'SKIPPED'),
      actionType: result.actionType || null,
      errorCode: result.ok ? null : (result.code || 'skipped'),
      errorMessage: result.ok ? null : (result.errorMessage || result.code || 'skipped'),
    });
  }

  async function handleReactionEvent(eventType, reaction, user) {
    try {
      if (!reaction || !user || user.bot) return;
      await safeFetchReactionPayload(reaction);
      const guildId = reaction.message?.guild?.id || reaction.message?.guildId || null;
      const messageId = reaction.message?.id || null;
      if (!guildId || !messageId) return;
      const emojiMeta = extractReactionEmoji(reaction);
      if (!emojiMeta) return;
      const rules = await fetchMatchingRules(guildId, messageId, emojiMeta);
      if (!rules.length) return;

      const guild = reaction.message?.guild || (await client.guilds.fetch(guildId).catch(() => null));
      if (!guild) return;

      let channel = reaction.message?.channel || null;
      if (!channel && reaction.message?.channelId) {
        channel = guild.channels.cache.get(reaction.message.channelId) || (await guild.channels.fetch(reaction.message.channelId).catch(() => null));
      }
      if (!channel?.isTextBased?.()) return;

      for (const rule of rules) {
        const result = await processRule({ rule, eventType, reaction, user, guild, channel });
        try {
          await persistRuleResult({
            guildId,
            rule,
            userId: user.id,
            eventType,
            result,
          });
        } catch (err) {
          logError('reaction_rule_result_persist_failed', err, {
            guildId,
            ruleId: rule.id,
            userId: user.id,
            eventType,
            status: result.ok ? 'SUCCESS' : (result.status || 'SKIPPED'),
            onlyOnceState: result?.onlyOnceExecution?.acquired ? 'reserved' : 'not_reserved',
          });
        }
      }
    } catch (err) {
      logError('reaction_action_event_failed', err, {
        guildId: reaction?.message?.guild?.id,
        messageId: reaction?.message?.id,
        userId: user?.id,
      });
    }
  }

  async function getHealth(guildId) {
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { ok: false, issues: ['guild_not_found'], ruleIssues: [] };
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const issues = [];
    if (!me) issues.push('bot_member_not_found');

    const rules = await reactionRuleRepository.listRulesByGuild(guildId);
    const ruleIssues = [];
    for (const rule of rules) {
      const itemIssues = [];
      const channel = guild.channels.cache.get(rule.channelId) || (await guild.channels.fetch(rule.channelId).catch(() => null));
      if (!channel) itemIssues.push('channel_missing');
      if (channel && !channel.isTextBased?.()) itemIssues.push('channel_not_text_based');

      const requiredChannelPermissions = collectRuleChannelPermissions(rule);
      if (channel && me && !channelHasPermissions(channel, me, requiredChannelPermissions)) {
        itemIssues.push('channel_permissions_missing');
      }

      const message = channel?.isTextBased?.() ? await channel.messages.fetch(rule.messageId).catch(() => null) : null;
      if (!message) itemIssues.push('message_missing');
      if (rule.emojiType === 'custom') {
        const emoji = guild.emojis.cache.get(rule.emojiId) || (await guild.emojis.fetch(rule.emojiId).catch(() => null));
        if (!emoji) itemIssues.push('emoji_missing');
      }
      for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
        if (action?.type === 'ROLE_ADD' || action?.type === 'ROLE_REMOVE') {
          const roleId = String(action?.payload?.roleId || '').trim();
          const role = roleId ? guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null)) : null;
          if (!me?.permissions?.has?.('ManageRoles')) itemIssues.push('bot_missing_manage_roles');
          if (!role) itemIssues.push('action_role_missing');
          else if (!isRoleBelowMemberTop(me, role)) itemIssues.push('action_role_hierarchy_too_low');
        }
        if (action?.type === 'REMOVE_OTHER_REACTIONS_IN_GROUP' && !me?.permissions?.has?.('ManageMessages')) {
          itemIssues.push('bot_missing_manage_messages');
        }
      }
      if (itemIssues.length > 0) {
        ruleIssues.push({ ruleId: rule.id, issues: [...new Set(itemIssues)] });
      }
    }
    return { ok: issues.length === 0 && ruleIssues.length === 0, issues, ruleIssues };
  }

  function invalidateGuildCache(guildId) {
    for (const key of [...ruleCache.keys()]) {
      if (key.startsWith(`${guildId}:`)) ruleCache.delete(key);
    }
    for (const key of [...ruleMissCache.keys()]) {
      if (key.startsWith(`${guildId}:`)) ruleMissCache.delete(key);
    }
  }

  return {
    refreshAllRules,
    refreshGuildRules,
    invalidateGuildCache,
    handleReactionEvent,
    getHealth,
  };
}

module.exports = { createReactionActionService };
