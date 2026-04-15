const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  OverwriteType,
} = require('discord.js');
const { resolveBotMember } = require('../../application/security/roleSafety');
const channelLockSnapshotRepository = require('../../infrastructure/repositories/channelLockSnapshotRepository');
const { logError, logSystem } = require('../../logger');

const CHANNEL_LOCK_SNAPSHOTS = new Map();
const CHANNEL_MUTATION_LOCKS = new Set();
const CHANNEL_MUTATION_LOCK_TIMEOUT_MS = 10_000;

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

const SEND_MESSAGES_PERMISSION_NAME = 'SendMessages';
const OVERWRITE_STATE_ALLOW = 'allow';
const OVERWRITE_STATE_DENY = 'deny';
const OVERWRITE_STATE_INHERIT = 'inherit';

function channelMutationKey(channelId) {
  return String(channelId || '').trim();
}

async function waitChannelMutationLock(channelId, context = {}) {
  const key = channelMutationKey(channelId);
  if (!key) {
    const err = new Error('channel_lock_mutation_key_missing');
    err.code = 'CHANNEL_LOCK_MUTATION_KEY_MISSING';
    throw err;
  }

  const startedAt = Date.now();
  while (CHANNEL_MUTATION_LOCKS.has(key)) {
    if (Date.now() - startedAt >= CHANNEL_MUTATION_LOCK_TIMEOUT_MS) {
      const err = new Error('channel_lock_mutation_timeout');
      err.code = 'CHANNEL_LOCK_MUTATION_TIMEOUT';
      logError('channel_lock_mutation_timeout', err, {
        channelId: key,
        timeoutMs: CHANNEL_MUTATION_LOCK_TIMEOUT_MS,
        waitedMs: Date.now() - startedAt,
        context,
      });
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  CHANNEL_MUTATION_LOCKS.add(key);
  return key;
}

function releaseChannelMutationLock(channelId) {
  CHANNEL_MUTATION_LOCKS.delete(channelMutationKey(channelId));
}

async function runWithChannelMutationLock(channelId, context, fn) {
  const key = await waitChannelMutationLock(channelId, context);
  try {
    return await fn();
  } finally {
    releaseChannelMutationLock(key);
  }
}

function hasDiscordPermission(permissionCarrier, permissionBit, fallbackName) {
  if (!permissionCarrier?.permissions?.has) return false;
  return Boolean(
    permissionCarrier.permissions.has(permissionBit) ||
    (fallbackName ? permissionCarrier.permissions.has(fallbackName) : false)
  );
}

function hasManageChannelsOrAdmin(member) {
  return (
    hasDiscordPermission(member, PermissionFlagsBits.ManageChannels, 'ManageChannels') ||
    hasDiscordPermission(member, PermissionFlagsBits.Administrator, 'Administrator')
  );
}

function isTextLockChannel(channel) {
  return TEXT_CHANNEL_TYPES.has(channel?.type);
}

function ensureOverwriteApi(channel) {
  if (
    !channel?.permissionOverwrites?.edit ||
    !channel?.permissionOverwrites?.cache?.get ||
    !channel?.permissionOverwrites?.cache?.values
  ) {
    throw new Error('permission_overwrite_api_unavailable');
  }
}

function normalizeOverwriteType(rawType) {
  if (rawType === OverwriteType.Role || rawType === 'role' || rawType === 0) return 'role';
  if (rawType === OverwriteType.Member || rawType === 'member' || rawType === 1) return 'member';
  return null;
}

function readSendMessagesState(overwrite) {
  if (
    overwrite?.allow?.has?.(PermissionFlagsBits.SendMessages) ||
    overwrite?.allow?.has?.(SEND_MESSAGES_PERMISSION_NAME)
  ) {
    return OVERWRITE_STATE_ALLOW;
  }
  if (
    overwrite?.deny?.has?.(PermissionFlagsBits.SendMessages) ||
    overwrite?.deny?.has?.(SEND_MESSAGES_PERMISSION_NAME)
  ) {
    return OVERWRITE_STATE_DENY;
  }
  return OVERWRITE_STATE_INHERIT;
}

function sendMessagesStateToOverwriteValue(state) {
  if (state === OVERWRITE_STATE_ALLOW) return true;
  if (state === OVERWRITE_STATE_DENY) return false;
  return null;
}

function snapshotChannelSendMessagesOverwrites(channel) {
  const entries = [];
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    const targetId = String(overwrite?.id || '').trim();
    if (!targetId) continue;

    entries.push({
      targetId,
      overwriteType: normalizeOverwriteType(overwrite.type),
      state: readSendMessagesState(overwrite),
    });
  }
  return entries;
}

async function roleHasLockExemption(guild, roleId) {
  const role =
    guild?.roles?.cache?.get?.(roleId) ||
    (await guild?.roles?.fetch?.(roleId).catch(() => null));
  if (!role?.permissions?.has) return false;
  return (
    hasDiscordPermission(role, PermissionFlagsBits.ManageChannels, 'ManageChannels') ||
    hasDiscordPermission(role, PermissionFlagsBits.Administrator, 'Administrator')
  );
}

function isEveryoneSendMessagesDenied(channel, everyoneRoleId) {
  const overwrite = channel.permissionOverwrites.cache.get(everyoneRoleId);
  return readSendMessagesState(overwrite) === OVERWRITE_STATE_DENY;
}

function buildSnapshot({ guild, channel, everyoneRole }) {
  const overwriteEntries = snapshotChannelSendMessagesOverwrites(channel);
  const hasEveryoneEntry = overwriteEntries.some(
    (entry) => entry.targetId === String(everyoneRole.id)
  );
  if (!hasEveryoneEntry) {
    overwriteEntries.push({
      targetId: String(everyoneRole.id),
      overwriteType: 'role',
      state: readSendMessagesState(
        channel.permissionOverwrites.cache.get(String(everyoneRole.id))
      ),
    });
  }

  const snapshot = {
    guildId: String(guild?.id || ''),
    channelId: String(channel.id),
    everyoneRoleId: String(everyoneRole.id),
    capturedAt: Date.now(),
    overwriteEntries,
  };
  return snapshot;
}

async function loadPersistedLockSnapshot(guildId, channelId) {
  try {
    const persisted = await channelLockSnapshotRepository.getSnapshot(guildId, channelId);
    return persisted?.snapshot || null;
  } catch (err) {
    logError('channel_lock_snapshot_load_failed', err, {
      guildId: guildId || null,
      channelId: channelId || null,
    });
    throw err;
  }
}

async function persistLockSnapshot({ guild, channel, everyoneRole, snapshot }) {
  try {
    await channelLockSnapshotRepository.upsertSnapshot({
      guildId: String(guild?.id || ''),
      channelId: String(channel?.id || ''),
      everyoneRoleId: String(everyoneRole?.id || ''),
      snapshot,
    });
  } catch (err) {
    logError('channel_lock_snapshot_save_failed', err, {
      guildId: guild?.id || null,
      channelId: channel?.id || null,
    });
    throw err;
  }
}

async function maybeSaveLockSnapshot({ guild, channel, everyoneRole }) {
  const cachedSnapshot = CHANNEL_LOCK_SNAPSHOTS.get(channel.id) || null;
  const persistedSnapshot = cachedSnapshot || (await loadPersistedLockSnapshot(guild?.id, channel?.id));
  if (persistedSnapshot && isEveryoneSendMessagesDenied(channel, everyoneRole.id)) {
    CHANNEL_LOCK_SNAPSHOTS.set(channel.id, persistedSnapshot);
    return { captured: false, snapshot: persistedSnapshot };
  }

  const snapshot = buildSnapshot({ guild, channel, everyoneRole });
  await persistLockSnapshot({ guild, channel, everyoneRole, snapshot });
  CHANNEL_LOCK_SNAPSHOTS.set(channel.id, snapshot);
  return { captured: true, snapshot };
}

async function resolveUnlockSnapshot({ guild, channel }) {
  const cached = CHANNEL_LOCK_SNAPSHOTS.get(channel.id) || null;
  if (cached) return cached;

  const persisted = await loadPersistedLockSnapshot(guild?.id, channel?.id);
  if (persisted) {
    CHANNEL_LOCK_SNAPSHOTS.set(channel.id, persisted);
    return persisted;
  }
  return null;
}

async function clearPersistedSnapshot({ guild, channel }) {
  CHANNEL_LOCK_SNAPSHOTS.delete(channel.id);
  try {
    await channelLockSnapshotRepository.deleteSnapshot(guild?.id, channel?.id);
  } catch (err) {
    logError('channel_lock_snapshot_delete_failed', err, {
      guildId: guild?.id || null,
      channelId: channel?.id || null,
    });
  }
}

async function neutralizeAllowOverwrites({ guild, channel, everyoneRole, reason }) {
  const roleTargets = [];
  const memberTargets = [];
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    const overwriteType = normalizeOverwriteType(overwrite?.type);
    if (!overwriteType) continue;
    const roleId = String(overwrite?.id || '').trim();
    if (!roleId || roleId === String(everyoneRole.id)) continue;
    if (readSendMessagesState(overwrite) !== OVERWRITE_STATE_ALLOW) continue;

    if (overwriteType === 'role') {
      const exempt = await roleHasLockExemption(guild, roleId);
      if (exempt) continue;
      roleTargets.push(roleId);
      continue;
    }

    memberTargets.push(roleId);
  }

  for (const roleId of roleTargets) {
    await channel.permissionOverwrites.edit(
      roleId,
      { SendMessages: null },
      { reason }
    );
  }

  for (const memberId of memberTargets) {
    await channel.permissionOverwrites.edit(
      memberId,
      { SendMessages: null },
      { reason }
    );
  }

  return {
    neutralizedRoleCount: roleTargets.length,
    neutralizedMemberCount: memberTargets.length,
  };
}

async function verifyLockApplied(guild, channel, everyoneRoleId) {
  const refreshedChannel = await channel.fetch?.().catch(() => null);
  const targetChannel = refreshedChannel?.permissionOverwrites?.cache?.get ? refreshedChannel : channel;
  if (!isEveryoneSendMessagesDenied(targetChannel, everyoneRoleId)) return false;

  for (const overwrite of targetChannel.permissionOverwrites.cache.values()) {
    const overwriteType = normalizeOverwriteType(overwrite?.type);
    if (!overwriteType) continue;
    const targetId = String(overwrite?.id || '').trim();
    if (!targetId || targetId === String(everyoneRoleId)) continue;
    if (readSendMessagesState(overwrite) !== OVERWRITE_STATE_ALLOW) continue;

    if (overwriteType === 'role') {
      const exempt = await roleHasLockExemption(guild, targetId);
      if (exempt) continue;
    }

    return false;
  }

  return true;
}

async function applyChannelLock({ guild, channel, everyoneRole, reason }) {
  ensureOverwriteApi(channel);
  await maybeSaveLockSnapshot({ guild, channel, everyoneRole });

  await channel.permissionOverwrites.edit(
    everyoneRole,
    { SendMessages: false },
    { reason }
  );

  const neutralizeResult = await neutralizeAllowOverwrites({
    guild,
    channel,
    everyoneRole,
    reason,
  });

  const verified = await verifyLockApplied(guild, channel, everyoneRole.id);
  if (!verified) {
    throw new Error('text_lock_verification_failed');
  }

  return {
    neutralizedRoleCount: neutralizeResult.neutralizedRoleCount,
    neutralizedMemberCount: neutralizeResult.neutralizedMemberCount,
  };
}

async function restoreSnapshot({ guild, channel, snapshot, reason }) {
  for (const entry of snapshot.overwriteEntries || []) {
    const targetId = String(entry?.targetId || '').trim();
    if (!targetId) continue;

    const value = sendMessagesStateToOverwriteValue(entry.state);
    const target =
      entry.overwriteType === 'role'
        ? guild?.roles?.cache?.get?.(targetId) || targetId
        : targetId;

    await channel.permissionOverwrites.edit(
      target,
      { SendMessages: value },
      { reason }
    );
  }
}

async function applyChannelUnlock({ guild, channel, everyoneRole, reason }) {
  ensureOverwriteApi(channel);
  const snapshot = await resolveUnlockSnapshot({ guild, channel });
  if (snapshot) {
    await restoreSnapshot({
      guild,
      channel,
      snapshot,
      reason,
    });
    const verified = await verifyUnlockApplied(channel, everyoneRole.id, snapshot);
    if (!verified) {
      throw new Error('text_unlock_verification_failed');
    }
    await clearPersistedSnapshot({ guild, channel });
    return { restoredFromSnapshot: true };
  }

  if (isEveryoneSendMessagesDenied(channel, everyoneRole.id)) {
    await channel.permissionOverwrites.edit(
      everyoneRole,
      { SendMessages: null },
      { reason }
    );
  }
  const verified = await verifyUnlockApplied(channel, everyoneRole.id, null);
  if (!verified) {
    throw new Error('text_unlock_verification_failed');
  }
  return { restoredFromSnapshot: false };
}

async function verifyUnlockApplied(channel, everyoneRoleId, snapshot) {
  const refreshedChannel = await channel.fetch?.().catch(() => null);
  const targetChannel = refreshedChannel?.permissionOverwrites?.cache?.get ? refreshedChannel : channel;
  const cache = targetChannel.permissionOverwrites.cache;

  if (snapshot?.overwriteEntries?.length) {
    for (const entry of snapshot.overwriteEntries) {
      const overwrite = cache.get(entry.targetId);
      if (readSendMessagesState(overwrite) !== entry.state) return false;
    }
    return true;
  }

  return readSendMessagesState(cache.get(everyoneRoleId)) !== OVERWRITE_STATE_DENY;
}

function createStatusEmbed({ title, color, channel, targetType }) {
  const displayName =
    channel?.toString?.() ||
    (channel?.name ? `#${channel.name}` : `#${channel?.id || 'unknown'}`);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      {
        name: 'Hedef Kanal',
        value: displayName,
        inline: true,
      },
      {
        name: 'Tür',
        value: targetType,
        inline: true,
      }
    )
    .setTimestamp();
}

function createErrorEmbed(messageText) {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setDescription(messageText);
}

function createProgressEmbed(messageText) {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setDescription(messageText);
}

async function sendEmbedReply(message, embed) {
  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };

  if (typeof message.reply === 'function') {
    return message.reply(payload).catch(() => null);
  }

  if (typeof message.channel?.send === 'function') {
    return message.channel.send(payload).catch(() => null);
  }
  return null;
}

async function updateEmbedReply(message, replyMessage, embed) {
  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };

  if (typeof replyMessage?.edit === 'function') {
    const edited = await replyMessage.edit(payload).catch(() => null);
    if (edited) return edited;
  }
  return sendEmbedReply(message, embed);
}

async function createCommandFeedback(message, messageText) {
  if (typeof message?.channel?.sendTyping === 'function') {
    await Promise.resolve(message.channel.sendTyping()).catch(() => {});
  }
  return sendEmbedReply(message, createProgressEmbed(messageText));
}

function resolveLockCommandTarget(message) {
  const targetChannel = message?.channel || null;
  if (!targetChannel) return { ok: false, errorCode: 'channel_not_found' };
  if (!isTextLockChannel(targetChannel)) return { ok: false, errorCode: 'unsupported_channel_type' };

  return {
    ok: true,
    channel: targetChannel,
    targetType: 'Yazı Kanalı',
  };
}

function mapTargetErrorToMessage(errorCode) {
  if (errorCode === 'channel_not_found') {
    return 'Hedef kanal bulunamadı. ୭ ˚. !!';
  }
  return 'Bu komut yalnızca yazı kanallarında kullanılabilir. ୭ ˚. !!';
}

async function fetchAuthoritativeChannel(channel) {
  if (!channel) return null;
  return (await channel.fetch?.().catch(() => null)) || channel;
}

async function runLockCommand(ctx, options = {}) {
  const { message } = ctx;
  const skipActorPermission = options.skipActorPermission === true;

  if (!skipActorPermission && !hasManageChannelsOrAdmin(message.member)) {
    await sendEmbedReply(
      message,
      createErrorEmbed('Bu komutu kullanmak için Kanalları Yönet veya Yönetici yetkisi gerekiyor. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'actor_missing_manage_channels' };
  }

  const feedbackMessage = await createCommandFeedback(message, 'Kanal kilitleniyor...');
  const botMember = await resolveBotMember(message.guild);
  if (!hasManageChannelsOrAdmin(botMember)) {
    logSystem(
      `channel_lock_bot_missing_manage_channels guild=${message.guild?.id || 'unknown'} channel=${message.channel?.id || 'unknown'}`,
      'WARN'
    );
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed('Botun bu işlem için Kanalları Yönet yetkisine ihtiyacı var. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'bot_missing_manage_channels' };
  }

  const targetResult = resolveLockCommandTarget(message);
  if (!targetResult.ok) {
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed(mapTargetErrorToMessage(targetResult.errorCode))
    );
    return { ok: false, reasonCode: targetResult.errorCode };
  }

  const everyoneRole = message.guild?.roles?.everyone || null;
  if (!everyoneRole?.id) {
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed('@everyone rolü bulunamadı. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'everyone_role_missing' };
  }

  try {
    const result = await runWithChannelMutationLock(
      targetResult.channel.id,
      {
        action: 'lock',
        guildId: message.guild?.id || null,
        channelId: targetResult.channel.id,
        actorId: message.author?.id || null,
      },
      async () => {
        const authoritativeChannel = await fetchAuthoritativeChannel(targetResult.channel);
        const alreadyLocked = await verifyLockApplied(
          message.guild,
          authoritativeChannel,
          everyoneRole.id
        ).catch(() => false);
        if (alreadyLocked) {
          return {
            status: 'noop',
            channel: authoritativeChannel,
          };
        }

        await applyChannelLock({
          guild: message.guild,
          channel: authoritativeChannel,
          everyoneRole,
          reason: `prefix_lock_text_${message.author?.id || 'unknown'}`,
        });
        return {
          status: 'applied',
          channel: authoritativeChannel,
        };
      }
    );

    if (result?.status === 'noop') {
      await updateEmbedReply(
        message,
        feedbackMessage,
        createStatusEmbed({
          title: 'Kanal zaten kilitli. ୭ ˚. !!',
          color: 0xf59e0b,
          channel: result.channel || targetResult.channel,
          targetType: targetResult.targetType,
        })
      );
      return { ok: true, reasonCode: 'lock_noop' };
    }
  } catch (err) {
    if (String(err?.code || '') === 'CHANNEL_LOCK_MUTATION_TIMEOUT') {
      await updateEmbedReply(
        message,
        feedbackMessage,
        createErrorEmbed('Bu kanal üzerinde başka bir işlem çalışıyor. Lütfen tekrar deneyin. ୭ ˚. !!')
      );
      return { ok: false, reasonCode: 'lock_busy' };
    }
    logError('channel_lock_apply_failed', err, {
      guildId: message.guild?.id || null,
      channelId: targetResult.channel?.id || null,
      actorId: message.author?.id || null,
    });
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed('Kilit uygulanamadı. İzin ayarları doğrulanamadı. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'lock_apply_failed' };
  }

  await updateEmbedReply(
    message,
    feedbackMessage,
    createStatusEmbed({
      title: 'Kanal kilitlendi. ⋆˚࿔',
      color: 0xef4444,
      channel: targetResult.channel,
      targetType: targetResult.targetType,
    })
  );
  return { ok: true, reasonCode: 'lock_applied' };
}

async function runUnlockCommand(ctx, options = {}) {
  const { message } = ctx;
  const skipActorPermission = options.skipActorPermission === true;

  if (!skipActorPermission && !hasManageChannelsOrAdmin(message.member)) {
    await sendEmbedReply(
      message,
      createErrorEmbed('Bu komutu kullanmak için Kanalları Yönet veya Yönetici yetkisi gerekiyor. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'actor_missing_manage_channels' };
  }

  const feedbackMessage = await createCommandFeedback(message, 'Kanal kilidi kaldırılıyor...');
  const botMember = await resolveBotMember(message.guild);
  if (!hasManageChannelsOrAdmin(botMember)) {
    logSystem(
      `channel_unlock_bot_missing_manage_channels guild=${message.guild?.id || 'unknown'} channel=${message.channel?.id || 'unknown'}`,
      'WARN'
    );
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed('Botun bu işlem için Kanalları Yönet yetkisine ihtiyacı var. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'bot_missing_manage_channels' };
  }

  const targetResult = resolveLockCommandTarget(message);
  if (!targetResult.ok) {
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed(mapTargetErrorToMessage(targetResult.errorCode))
    );
    return { ok: false, reasonCode: targetResult.errorCode };
  }

  const everyoneRole = message.guild?.roles?.everyone || null;
  if (!everyoneRole?.id) {
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed('@everyone rolü bulunamadı. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'everyone_role_missing' };
  }

  try {
    const result = await runWithChannelMutationLock(
      targetResult.channel.id,
      {
        action: 'unlock',
        guildId: message.guild?.id || null,
        channelId: targetResult.channel.id,
        actorId: message.author?.id || null,
      },
      async () => {
        const authoritativeChannel = await fetchAuthoritativeChannel(targetResult.channel);
        const snapshot = await resolveUnlockSnapshot({
          guild: message.guild,
          channel: authoritativeChannel,
        });
        const alreadyUnlocked = await verifyUnlockApplied(
          authoritativeChannel,
          everyoneRole.id,
          snapshot
        ).catch(() => false);
        if (alreadyUnlocked) {
          if (snapshot) {
            await clearPersistedSnapshot({
              guild: message.guild,
              channel: authoritativeChannel,
            });
          }
          return {
            status: 'noop',
            channel: authoritativeChannel,
          };
        }

        await applyChannelUnlock({
          guild: message.guild,
          channel: authoritativeChannel,
          everyoneRole,
          reason: `prefix_unlock_text_${message.author?.id || 'unknown'}`,
        });
        return {
          status: 'applied',
          channel: authoritativeChannel,
        };
      }
    );

    if (result?.status === 'noop') {
      await updateEmbedReply(
        message,
        feedbackMessage,
        createStatusEmbed({
          title: 'Kanal zaten açık. ୭ ˚. !!',
          color: 0xf59e0b,
          channel: result.channel || targetResult.channel,
          targetType: targetResult.targetType,
        })
      );
      return { ok: true, reasonCode: 'unlock_noop' };
    }
  } catch (err) {
    if (String(err?.code || '') === 'CHANNEL_LOCK_MUTATION_TIMEOUT') {
      await updateEmbedReply(
        message,
        feedbackMessage,
        createErrorEmbed('Bu kanal üzerinde başka bir işlem çalışıyor. Lütfen tekrar deneyin. ୭ ˚. !!')
      );
      return { ok: false, reasonCode: 'unlock_busy' };
    }
    logError('channel_unlock_apply_failed', err, {
      guildId: message.guild?.id || null,
      channelId: targetResult.channel?.id || null,
      actorId: message.author?.id || null,
    });
    await updateEmbedReply(
      message,
      feedbackMessage,
      createErrorEmbed('Kanal kilidi kaldırılırken bir hata oluştu. ୭ ˚. !!')
    );
    return { ok: false, reasonCode: 'unlock_apply_failed' };
  }

  await updateEmbedReply(
    message,
    feedbackMessage,
    createStatusEmbed({
      title: 'Kanal kilidi kaldırıldı. ⋆˚࿔',
      color: 0x10b981,
      channel: targetResult.channel,
      targetType: targetResult.targetType,
    })
  );
  return { ok: true, reasonCode: 'unlock_applied' };
}

module.exports = {
  CHANNEL_LOCK_SNAPSHOTS,
  CHANNEL_MUTATION_LOCKS,
  hasManageChannelsOrAdmin,
  resolveLockCommandTarget,
  applyChannelLock,
  applyChannelUnlock,
  runLockCommand,
  runUnlockCommand,
};
