const reactionRuleRepository = require('../../infrastructure/repositories/reactionRuleRepository');
const { normalizeUnicodeEmojiName, normalizeEmojiKey: buildEmojiKey } = require('./emoji');

const INTERNAL_COMMANDS = {
  'partner-bilgi': async ({ member }) => {
    const text = 'Partner basvuru bilgisi: Profilini duzgun doldur, aktifligini koru ve kurallari kabul et.';
    await member.send({ content: text }).catch(() => {});
  },
};

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

function createReactionActionService({ client, logError = () => {}, logSystem = () => {} } = {}) {
  if (!client) throw new Error('createReactionActionService: client gerekli');

  const ruleCache = new Map();
  const cooldownMap = new Map();
  let pruneTick = 0;

  function pruneCooldown(nowMs) {
    pruneTick += 1;
    if (pruneTick % 100 !== 0) return;
    for (const [key, expiry] of cooldownMap.entries()) {
      if (expiry <= nowMs) cooldownMap.delete(key);
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

  async function refreshGuildRules(guildId) {
    const all = await reactionRuleRepository.listEnabledRulesByGuild(guildId);
    for (const key of [...ruleCache.keys()]) {
      if (key.startsWith(`${guildId}:`)) ruleCache.delete(key);
    }
    for (const rule of all) {
      const key = buildRuleCacheKey(rule);
      const list = ruleCache.get(key) || [];
      list.push(rule);
      ruleCache.set(key, list);
      await ensureRuleReaction(rule);
    }
    return all;
  }

  async function refreshAllRules() {
    let refreshedGuildCount = 0;
    for (const guild of client.guilds.cache.values()) {
      await refreshGuildRules(guild.id);
      refreshedGuildCount += 1;
    }
    logSystem(`Reaction rules cache yenilendi: guild=${refreshedGuildCount}`, 'INFO');
  }

  async function fetchMatchingRules(guildId, messageId, emojiMeta) {
    const key = `${guildId}:${messageId}:${buildEmojiKey(emojiMeta)}`;
    const cached = ruleCache.get(key);
    if (cached) return cached;
    await refreshGuildRules(guildId);
    return ruleCache.get(key) || [];
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
      const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
      if (!me?.permissions?.has('ManageRoles')) return { ok: false, code: 'bot_missing_manage_roles' };
      if (!role) return { ok: false, code: 'role_not_found' };
      if (isDangerousRole(role, guild)) return { ok: false, code: 'role_blocked_for_safety' };
      if (me.roles.highest.position <= role.position) return { ok: false, code: 'role_hierarchy_too_low' };
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
      const allRules = await reactionRuleRepository.listEnabledRulesByGuild(guild.id);
      const groupRules = allRules.filter((r) => r.messageId === rule.messageId && r.groupKey && r.groupKey === groupKey && r.id !== rule.id);
      for (const r of groupRules) {
        const msgChannel = guild.channels.cache.get(r.channelId) || (await guild.channels.fetch(r.channelId).catch(() => null));
        if (!msgChannel?.isTextBased()) continue;
        const msg = await msgChannel.messages.fetch(r.messageId).catch(() => null);
        if (!msg) continue;
        const emoji = r.emojiType === 'custom' ? r.emojiId : r.emojiName;
        const targetReaction = msg.reactions?.cache?.find?.((x) =>
          r.emojiType === 'custom' ? x.emoji.id === emoji : x.emoji.name === emoji
        );
        if (!targetReaction) continue;
        await targetReaction.users.remove(member.id).catch(() => {});
      }
      return { ok: true };
    }

    return { ok: false, code: 'action_not_supported' };
  }

  async function processRule({ rule, eventType, reaction, user, guild, channel }) {
    const nowMs = Date.now();
    const resolvedGuild = guild || reaction?.message?.guild || null;
    const resolvedChannel = channel || reaction?.message?.channel || null;
    if (!resolvedGuild || !resolvedChannel) return { ok: false, code: 'message_context_missing' };

    const member = await ensureGuildMember(resolvedGuild, user);

    if (!member || member.user.bot) return { ok: false, code: 'member_invalid' };
    if (!rule.enabled) return { ok: false, code: 'rule_disabled' };
    if (rule.triggerMode === 'ADD' && eventType !== 'ADD') return { ok: false, code: 'trigger_mismatch' };
    if (rule.triggerMode === 'REMOVE' && eventType !== 'REMOVE') return { ok: false, code: 'trigger_mismatch' };

    const constraintCheck = checkRoleConstraints(member, rule);
    if (!constraintCheck.ok) return { ok: false, code: constraintCheck.code };

    const cooldownCheck = applyCooldown(rule, member.id, nowMs);
    if (!cooldownCheck.ok) return { ok: false, code: cooldownCheck.code };

    if (rule.onlyOnce) {
      const hasRun = await reactionRuleRepository.hasSuccessfulExecution(rule.id, member.id);
      if (hasRun) return { ok: false, code: 'only_once_already_executed' };
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
          await reactionRuleRepository.logRuleEvent({
            guildId: resolvedGuild.id,
            ruleId: rule.id,
            userId: member.id,
            eventType,
            status: 'ERROR',
            actionType: action?.type || null,
            errorCode: result.code || 'action_failed',
            errorMessage: result.code || 'action_failed',
          });
          return { ok: false, code: result.code || 'action_failed' };
        }
      } catch (err) {
        await reactionRuleRepository.logRuleEvent({
          guildId: resolvedGuild.id,
          ruleId: rule.id,
          userId: member.id,
          eventType,
          status: 'ERROR',
          actionType: action?.type || null,
          errorCode: 'action_exception',
          errorMessage: err?.message || 'action_exception',
        });
        return { ok: false, code: 'action_exception' };
      }
    }

    await reactionRuleRepository.logRuleEvent({
      guildId: resolvedGuild.id,
      ruleId: rule.id,
      userId: member.id,
      eventType,
      status: 'SUCCESS',
      actionType: null,
    });
    return { ok: true };
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
        if (!result.ok) {
          await reactionRuleRepository.logRuleEvent({
            guildId,
            ruleId: rule.id,
            userId: user.id,
            eventType,
            status: 'SKIPPED',
            actionType: null,
            errorCode: result.code || 'skipped',
            errorMessage: result.code || 'skipped',
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
    if (!me?.permissions?.has('ManageRoles')) issues.push('bot_missing_manage_roles');
    if (!me?.permissions?.has('ReadMessageHistory')) issues.push('bot_missing_read_message_history');
    if (!me?.permissions?.has('ManageMessages')) issues.push('bot_missing_manage_messages');

    const rules = await reactionRuleRepository.listRulesByGuild(guildId);
    const ruleIssues = [];
    for (const rule of rules) {
      const itemIssues = [];
      const channel = guild.channels.cache.get(rule.channelId) || (await guild.channels.fetch(rule.channelId).catch(() => null));
      if (!channel) itemIssues.push('channel_missing');
      const message = channel?.isTextBased() ? await channel.messages.fetch(rule.messageId).catch(() => null) : null;
      if (!message) itemIssues.push('message_missing');
      if (rule.emojiType === 'custom') {
        const emoji = guild.emojis.cache.get(rule.emojiId) || (await guild.emojis.fetch(rule.emojiId).catch(() => null));
        if (!emoji) itemIssues.push('emoji_missing');
      }
      if (itemIssues.length > 0) {
        ruleIssues.push({ ruleId: rule.id, issues: itemIssues });
      }
    }
    return { ok: issues.length === 0 && ruleIssues.length === 0, issues, ruleIssues };
  }

  function invalidateGuildCache(guildId) {
    for (const key of [...ruleCache.keys()]) {
      if (key.startsWith(`${guildId}:`)) ruleCache.delete(key);
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
