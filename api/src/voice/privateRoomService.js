const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  OverwriteType,
} = require('discord.js');
const privateVoiceRepository = require('../infrastructure/repositories/privateVoiceRepository');
const { getPrivateRoomPanelEmojis } = require('../config/static');

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CONFIG_TTL_MS = 60 * 1000;
const ACTIVITY_TOUCH_THROTTLE_MS = 15 * 1000;
const TRANSIENT_DELETE_MS = 8000;
const DEFAULT_WHITELIST_LOCK_TIMEOUT_MS = 5_000;
const WHITELIST_LOCK_TIMEOUT_MS = Math.max(
  25,
  Number(process.env.PRIVATE_ROOM_LOCK_TIMEOUT_MS || DEFAULT_WHITELIST_LOCK_TIMEOUT_MS)
);

const EMOJI_SPEAKER = '\uD83D\uDD0A';
const EMOJI_LOCK = '\uD83D\uDD12';
const EMOJI_UNLOCK = '\uD83D\uDD13';
const EMOJI_OK = '\u2705';
const EMOJI_FAIL = '\u274C';
const EMOJI_WARN = '\u26A0\uFE0F';
const CONNECT_PERMISSION = 'Connect';
const VIEW_CHANNEL_PERMISSION = 'ViewChannel';
const OVERWRITE_CONNECT_ALLOW = 'allow';
const OVERWRITE_CONNECT_DENY = 'deny';
const OVERWRITE_CONNECT_INHERIT = 'inherit';
const INTERACTION_ACK_MODE_KEY = '__privateRoomAckMode';

function toId(raw) {
  const clean = String(raw || '').trim().replace(/[^\d]/g, '');
  return clean || null;
}

function roomKey(raw) {
  return String(raw || '');
}

function uniqIds(ids = []) {
  return [...new Set(ids.map((x) => toId(x)).filter(Boolean))];
}

function isVoiceLike(channel) {
  return Boolean(channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice));
}

function canUseVoiceChatText(channel) {
  try {
    return Boolean(channel?.isTextBased?.() && channel?.send);
  } catch {
    return false;
  }
}

async function safeDeleteMessage(message, delayMs = TRANSIENT_DELETE_MS) {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => { });
  }, delayMs).unref();
}

async function sendTransient(channel, content) {
  if (!canUseVoiceChatText(channel)) return;
  const sent = await channel
    .send({
      content,
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
  await safeDeleteMessage(sent);
}

function createPrivateRoomService({ client, logSystem = () => { }, logError = () => { } }) {
  const roomsById = new Map();
  const roomIdByChannel = new Map();
  const configCache = new Map();
  const roomWhitelistLock = new Set();
  const roomOwnerLock = new Set();
  const lastActivityWriteAt = new Map();
  const lockOverwriteStateByRoom = new Map();

  let cleanupTimer = null;

  function cloneLockSnapshot(snapshot) {
    return privateVoiceRepository.normalizeLockSnapshot(snapshot);
  }

  function cloneVisibilitySnapshot(snapshot) {
    return privateVoiceRepository.normalizeVisibilitySnapshot(snapshot);
  }

  function snapshotToLockState(snapshot) {
    const normalized = cloneLockSnapshot(snapshot);
    if (!normalized) return null;
    return {
      everyoneRoleId: normalized.everyoneRoleId,
      everyoneConnectStateBeforeLock: normalized.everyoneConnectStateBeforeLock,
      memberConnectStatesBeforeLock: new Map(Object.entries(normalized.memberConnectStatesBeforeLock || {})),
      roleConnectStatesBeforeLock: new Map(Object.entries(normalized.roleConnectStatesBeforeLock || {})),
      managedAllowMemberIds: new Set(normalized.managedAllowMemberIds || []),
      managedDenyMemberIds: new Set(normalized.managedDenyMemberIds || []),
      managedAllowRoleIds: new Set(normalized.managedAllowRoleIds || []),
      managedDenyRoleIds: new Set(normalized.managedDenyRoleIds || []),
      fallbackMode: Boolean(normalized.fallbackMode),
    };
  }

  function lockStateToSnapshot(state) {
    if (!state?.everyoneRoleId) return null;
    return cloneLockSnapshot({
      everyoneRoleId: state.everyoneRoleId,
      everyoneConnectStateBeforeLock: state.everyoneConnectStateBeforeLock,
      memberConnectStatesBeforeLock: Object.fromEntries(state.memberConnectStatesBeforeLock || []),
      roleConnectStatesBeforeLock: Object.fromEntries(state.roleConnectStatesBeforeLock || []),
      managedAllowMemberIds: [...(state.managedAllowMemberIds || [])],
      managedDenyMemberIds: [...(state.managedDenyMemberIds || [])],
      managedAllowRoleIds: [...(state.managedAllowRoleIds || [])],
      managedDenyRoleIds: [...(state.managedDenyRoleIds || [])],
      fallbackMode: Boolean(state.fallbackMode),
    });
  }

  function snapshotsEqual(left, right) {
    return JSON.stringify(cloneLockSnapshot(left)) === JSON.stringify(cloneLockSnapshot(right));
  }

  function snapshotToVisibilityState(snapshot) {
    const normalized = cloneVisibilitySnapshot(snapshot);
    if (!normalized) return null;
    return {
      everyoneRoleId: normalized.everyoneRoleId,
      everyoneViewStateBeforeHide: normalized.everyoneViewStateBeforeHide,
      roleViewStatesBeforeHide: new Map(Object.entries(normalized.roleViewStatesBeforeHide || {})),
      managedDenyRoleIds: new Set(normalized.managedDenyRoleIds || []),
    };
  }

  function visibilityStateToSnapshot(state) {
    if (!state?.everyoneRoleId) return null;
    return cloneVisibilitySnapshot({
      everyoneRoleId: state.everyoneRoleId,
      everyoneViewStateBeforeHide: state.everyoneViewStateBeforeHide,
      roleViewStatesBeforeHide: Object.fromEntries(state.roleViewStatesBeforeHide || []),
      managedDenyRoleIds: [...(state.managedDenyRoleIds || [])],
    });
  }

  function visibilitySnapshotsEqual(left, right) {
    return JSON.stringify(cloneVisibilitySnapshot(left)) === JSON.stringify(cloneVisibilitySnapshot(right));
  }

  function cacheRoom(room) {
    if (!room?.id || !room.voiceChannelId) return;
    const key = roomKey(room.id);
    const permitMemberIds = uniqIds(room.permitMemberIds || room.whitelistMemberIds || []).filter(
      (id) => id !== room.ownerId
    );
    const normalizedRoom = {
      ...room,
      lockSnapshot: cloneLockSnapshot(room.lockSnapshot),
      visibilitySnapshot: cloneVisibilitySnapshot(room.visibilitySnapshot),
      whitelistMemberIds: permitMemberIds,
      permitMemberIds,
      permitRoleIds: uniqIds(room.permitRoleIds || []),
      rejectMemberIds: uniqIds(room.rejectMemberIds || []).filter((id) => id !== room.ownerId),
      rejectRoleIds: uniqIds(room.rejectRoleIds || []),
      locked: Boolean(room.locked),
      lastActiveAt: Number(room.lastActiveAt || Date.now()),
    };
    roomsById.set(key, normalizedRoom);
    if (normalizedRoom.lockSnapshot) {
      lockOverwriteStateByRoom.set(key, snapshotToLockState(normalizedRoom.lockSnapshot));
    } else {
      lockOverwriteStateByRoom.delete(key);
    }
    roomIdByChannel.set(room.voiceChannelId, key);
  }

  function removeRoomCache(room) {
    if (!room) return;
    const key = roomKey(room.id);
    roomsById.delete(key);
    if (room.voiceChannelId) roomIdByChannel.delete(room.voiceChannelId);
    lastActivityWriteAt.delete(key);
    roomWhitelistLock.delete(key);
    lockOverwriteStateByRoom.delete(key);
  }

  function getRoomByIdCached(roomId) {
    return roomsById.get(roomKey(roomId)) || null;
  }

  async function getGuildConfig(guildId) {
    const cached = configCache.get(guildId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt <= CONFIG_TTL_MS) return cached.value;
    const value = await privateVoiceRepository.getGuildConfig(guildId);
    configCache.set(guildId, { fetchedAt: now, value });
    return value;
  }

  function invalidateConfig(guildId) {
    if (guildId) configCache.delete(guildId);
  }

  function isRoomOwner(room, userId) {
    return room?.ownerId && room.ownerId === userId;
  }

  function getPermitMemberIds(room) {
    return uniqIds(room?.permitMemberIds || room?.whitelistMemberIds || []).filter((id) => id !== room?.ownerId);
  }

  function getPermitRoleIds(room) {
    return uniqIds(room?.permitRoleIds || []);
  }

  function getRejectMemberIds(room) {
    return uniqIds(room?.rejectMemberIds || []).filter((id) => id !== room?.ownerId);
  }

  function getRejectRoleIds(room) {
    return uniqIds(room?.rejectRoleIds || []);
  }

  function normalizeRoomAccessLists(room) {
    if (!room) return room;
    const permitMemberIds = getPermitMemberIds(room);
    return {
      ...room,
      whitelistMemberIds: permitMemberIds,
      permitMemberIds,
      permitRoleIds: getPermitRoleIds(room),
      rejectMemberIds: getRejectMemberIds(room),
      rejectRoleIds: getRejectRoleIds(room),
    };
  }

  function getMemberRoleIds(member) {
    const rolesCache = member?.roles?.cache;
    if (!rolesCache) return [];
    if (typeof rolesCache.keys === 'function') {
      return uniqIds([...rolesCache.keys()]).filter((id) => id !== member?.guild?.id);
    }
    if (typeof rolesCache.forEach === 'function') {
      const out = [];
      rolesCache.forEach((role, roleId) => {
        out.push(String(role?.id || roleId || ''));
      });
      return uniqIds(out).filter((id) => id !== member?.guild?.id);
    }
    return [];
  }

  function resolveRoomAccessDecision(room, { userId = null, roleIds = [] } = {}) {
    const normalizedRoom = normalizeRoomAccessLists(room);
    const targetUserId = toId(userId);
    const memberRoleIds = new Set(uniqIds(roleIds));

    if (targetUserId && normalizedRoom?.ownerId === targetUserId) {
      return { allowed: true, source: 'owner' };
    }

    if (targetUserId && getRejectMemberIds(normalizedRoom).includes(targetUserId)) {
      return { allowed: false, source: 'reject_member' };
    }

    const matchedRejectRoleIds = getRejectRoleIds(normalizedRoom).filter((roleId) => memberRoleIds.has(roleId));
    if (matchedRejectRoleIds.length > 0) {
      return { allowed: false, source: 'reject_role', matchedRoleIds: matchedRejectRoleIds };
    }

    if (!normalizedRoom?.locked) {
      return { allowed: true, source: 'public' };
    }

    if (targetUserId && getPermitMemberIds(normalizedRoom).includes(targetUserId)) {
      return { allowed: true, source: 'permit_member' };
    }

    const matchedPermitRoleIds = getPermitRoleIds(normalizedRoom).filter((roleId) => memberRoleIds.has(roleId));
    if (matchedPermitRoleIds.length > 0) {
      return { allowed: true, source: 'permit_role', matchedRoleIds: matchedPermitRoleIds };
    }

    return { allowed: false, source: 'locked_default' };
  }

  function canMemberAccessRoom(room, member) {
    return resolveRoomAccessDecision(room, {
      userId: member?.id,
      roleIds: getMemberRoleIds(member),
    }).allowed;
  }

  function roomNeedsRuntimeEnforcement(room) {
    const normalizedRoom = normalizeRoomAccessLists(room);
    return Boolean(
      normalizedRoom?.locked ||
        getRejectMemberIds(normalizedRoom).length > 0 ||
        getRejectRoleIds(normalizedRoom).length > 0
    );
  }

  function roomNeedsManagedAccess(room) {
    const normalizedRoom = normalizeRoomAccessLists(room);
    return Boolean(
      normalizedRoom?.locked ||
        getRejectMemberIds(normalizedRoom).length > 0 ||
        getRejectRoleIds(normalizedRoom).length > 0 ||
        getPermitRoleIds(normalizedRoom).length > 0
    );
  }

  function canEnterLockedRoom(room, userId, roleIds = []) {
    return resolveRoomAccessDecision(room, { userId, roleIds }).allowed;
  }

  async function disconnectMember(member, reason = 'Ozel oda erisim iznin yok') {
    try {
      if (!member?.voice?.channelId) return;
      if (typeof member.voice.disconnect === 'function') {
        await member.voice.disconnect(reason);
        return;
      }
      await member.voice.setChannel(null, reason);
    } catch (err) {
      logError('private_room_member_disconnect_failed', err, {
        guildId: member?.guild?.id,
        userId: member?.id,
      });
    }
  }

  function readViewChannelState(overwrite) {
    if (overwrite?.allow?.has?.(VIEW_CHANNEL_PERMISSION)) return OVERWRITE_CONNECT_ALLOW;
    if (overwrite?.deny?.has?.(VIEW_CHANNEL_PERMISSION)) return OVERWRITE_CONNECT_DENY;
    return OVERWRITE_CONNECT_INHERIT;
  }

  function viewOverwriteStateToValue(state) {
    if (state === OVERWRITE_CONNECT_ALLOW) return true;
    if (state === OVERWRITE_CONNECT_DENY) return false;
    return null;
  }

  function getOverwriteEntries(channel) {
    const cache = channel?.permissionOverwrites?.cache;
    if (cache?.entries && typeof cache.entries === 'function') {
      return [...cache.entries()];
    }
    if (channel?.overwriteStateById?.entries && typeof channel.overwriteStateById.entries === 'function') {
      return [...channel.overwriteStateById.entries()];
    }
    return [];
  }

  function getRoleOverwriteTargets(guild, channel, everyoneRoleId) {
    return getOverwriteEntries(channel)
      .map(([targetId, overwrite]) => {
        const resolvedTargetId = String(targetId || overwrite?.id || '').trim();
        if (!resolvedTargetId || resolvedTargetId === everyoneRoleId) return null;
        const isRole =
          overwrite?.type === OverwriteType.Role ||
          guild?.roles?.cache?.has?.(resolvedTargetId) === true;
        if (!isRole) return null;
        return {
          roleId: resolvedTargetId,
          role: guild?.roles?.cache?.get?.(resolvedTargetId) || resolvedTargetId,
          overwrite,
        };
      })
      .filter(Boolean);
  }

  function getMemberOverwriteTargets(guild, channel, everyoneRoleId) {
    return getOverwriteEntries(channel)
      .map(([targetId, overwrite]) => {
        const resolvedTargetId = String(targetId || overwrite?.id || '').trim();
        if (!resolvedTargetId || resolvedTargetId === everyoneRoleId) return null;
        const isRole =
          overwrite?.type === OverwriteType.Role ||
          guild?.roles?.cache?.has?.(resolvedTargetId) === true;
        if (isRole) return null;
        return {
          memberId: resolvedTargetId,
          overwrite,
        };
      })
      .filter(Boolean);
  }

  function getPanelRuntimeState(room) {
    const normalizedRoom = normalizeRoomAccessLists(room);
    const actualLocked = Boolean(normalizedRoom?.locked);
    const actualVisible = !normalizedRoom?.visibilitySnapshot;

    return {
      locked: actualLocked,
      lockedLabel: actualLocked ? 'Kilitli' : 'Açık',
      visibilityLabel: actualVisible ? 'Görünür' : 'Gizli',
      visibility: actualVisible,
    };
  }

  function panelEmbed(room, guild, channel) {
    const permitSubjects = [
      ...getPermitMemberIds(room).map((id) => `<@${id}>`),
      ...getPermitRoleIds(room).map((id) => `<@&${id}>`),
    ];
    const preview = permitSubjects.slice(0, 16).join(', ');
    const more = permitSubjects.length > 16 ? ` (+${permitSubjects.length - 16})` : '';
    const allowedLine = permitSubjects.length ? `${preview}${more}` : 'Yok';
    const runtimeState = getPanelRuntimeState(room);

    const desc =
      `Oda Kontrol\n\n` +
      `Adı Değiştir | Kilitle | Kilidi Aç\n` +
      `Limit | Gizle | Göster\n` +
      `Devret | İzin Verilenler | Engellenenler | Kanalı Sil\n\n` +
      `Oda Sahibi: <@${room.ownerId}>\n` +
      `İzin Verilen Üyeler: ${allowedLine}\n` +
      `Kilit Durumu: ${runtimeState.lockedLabel}\n` +
      `Görünürlük Durumu: ${runtimeState.visibilityLabel}`;

    const embed = new EmbedBuilder()
      .setTitle('Oda Kontrol')
      .setDescription(desc)
      .setColor(runtimeState.locked ? 0xef4444 : 0x10b981)
      .setFooter({ text: 'Ses kanalını yönetmek için aşağıdaki butonları kullanın.' })
      .setTimestamp();

    if (typeof guild?.members?.me?.displayAvatarURL === 'function') {
      embed.setThumbnail(guild.members.me.displayAvatarURL());
    } else if (typeof client?.user?.displayAvatarURL === 'function') {
      embed.setThumbnail(client.user.displayAvatarURL());
    }

    return embed;
  }

  function panelComponents(room) {
    const emojis = getPrivateRoomPanelEmojis(room?.guildId);
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pvr:rename:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.rename),
        new ButtonBuilder().setCustomId(`pvr:lockon:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.lockOn),
        new ButtonBuilder().setCustomId(`pvr:lockoff:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.lockOff),
        new ButtonBuilder().setCustomId(`pvr:hide:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.hide),
        new ButtonBuilder().setCustomId(`pvr:show:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.show)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pvr:limit:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.limit),
        new ButtonBuilder().setCustomId(`pvr:allow:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.allow),
        new ButtonBuilder().setCustomId(`pvr:remove:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.remove),
        new ButtonBuilder().setCustomId(`pvr:transfer:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(emojis.transfer),
        new ButtonBuilder().setCustomId(`pvr:delete:${room.id}`).setStyle(ButtonStyle.Danger).setEmoji(emojis.delete)
      )
    ];
  }

  async function syncPanelMessage(room) {
    const { guild, channel: voiceChannel } = await resolveRoomChannel(room, { action: 'sync_panel_message' });
    if (!guild) return;
    if (!voiceChannel || !canUseVoiceChatText(voiceChannel)) return;

    const payload = {
      embeds: [panelEmbed(room, guild, voiceChannel)],
      components: panelComponents(room),
      allowedMentions: { parse: [] },
    };

    let message = null;
    if (room.panelMessageId) {
      message = await voiceChannel.messages.fetch(room.panelMessageId).catch(() => null);
    }

    if (message) {
      const edited = await message.edit(payload).catch((err) => {
        logError('private_room_panel_edit_failed', err, {
          guildId: room.guildId,
          channelId: room.voiceChannelId,
          panelMessageId: room.panelMessageId,
        });
        return null;
      });
      if (edited) return;
    }

    const sent = await voiceChannel.send(payload).catch((err) => {
      logError('private_room_panel_send_failed', err, {
        guildId: room.guildId,
        channelId: room.voiceChannelId,
      });
      return null;
    });
    if (!sent) return;

    const updated = await privateVoiceRepository.updateRoom(room.id, { panelMessageId: sent.id }).catch((err) => {
      logError('private_room_panel_message_id_persist_failed', err, {
        guildId: room.guildId,
        roomId: room.id,
        channelId: room.voiceChannelId,
        panelMessageId: sent.id,
      });
      return null;
    });
    if (updated) cacheRoom(updated);
  }

  async function getRoomByChannel(guildId, voiceChannelId) {
    if (!guildId || !voiceChannelId) return null;
    const cachedRoomId = roomIdByChannel.get(voiceChannelId);
    if (cachedRoomId) {
      const cachedRoom = roomsById.get(cachedRoomId);
      if (cachedRoom?.guildId === guildId) return cachedRoom;
    }
    const dbRoom = await privateVoiceRepository.getRoomByChannel(guildId, voiceChannelId).catch((err) => {
      logError('private_room_lookup_by_channel_failed', err, { guildId, voiceChannelId });
      return null;
    });
    if (dbRoom) cacheRoom(dbRoom);
    return dbRoom;
  }

  async function touchRoomActivity(room, force = false) {
    if (!room) return room;
    const key = roomKey(room.id);
    const now = Date.now();
    if (!force) {
      const last = Number(lastActivityWriteAt.get(key) || 0);
      if (now - last < ACTIVITY_TOUCH_THROTTLE_MS) return room;
    }

    const updated = await privateVoiceRepository.updateRoom(room.id, { lastActiveAt: now }).catch((err) => {
      logError('private_room_touch_failed', err, { roomId: room.id, guildId: room.guildId });
      return null;
    });
    if (updated) {
      cacheRoom(updated);
      lastActivityWriteAt.set(key, now);
      return updated;
    }
    return room;
  }

  async function disconnectUnauthorizedMembers(room) {
    if (!roomNeedsRuntimeEnforcement(room)) return;
    const { guild, channel } = await resolveRoomChannel(room, { action: 'disconnect_unauthorized_members' });
    if (!guild || !channel) return;
    if (!isVoiceLike(channel)) return;

    const members = [...channel.members.values()];
    await Promise.all(
      members.map(async (member) => {
        if (canMemberAccessRoom(room, member)) return;
        await disconnectMember(member, 'Oda erisim iznin yok');
      })
    );
  }

  async function deleteRoom(room, reason = 'cleanup') {
    if (!room) return;
    const { guild, channel, guildStatus, channelStatus } = await resolveRoomChannel(room, {
      action: 'delete_room',
      reason,
    });

    if (guildStatus === 'unavailable' || channelStatus === 'unavailable') {
      return false;
    }

    let channelDeleteFailed = false;
    if (channel && isVoiceLike(channel)) {
      await channel.delete(`private_room_${reason}`).catch((err) => {
        channelDeleteFailed = true;
        logError('private_room_channel_delete_failed', err, {
          roomId: room.id,
          guildId: room.guildId,
          channelId: room.voiceChannelId,
          reason,
        });
        return null;
      });
      if (channelDeleteFailed) return false;
    }

    const deletedFromDb = await privateVoiceRepository.deleteRoomById(room.id).catch((err) => {
      logError('private_room_db_delete_failed', err, { roomId: room.id, guildId: room.guildId, reason });
      return null;
    });
    if (deletedFromDb === null) return false;
    removeRoomCache(room);
    return true;
  }

  async function runInactivityCleanup() {
    const now = Date.now();
    for (const room of roomsById.values()) {
      const { channel, guildStatus, channelStatus } = await resolveRoomChannel(room, {
        action: 'inactivity_cleanup',
      });

      if (guildStatus === 'missing' || channelStatus === 'missing') {
        await privateVoiceRepository.deleteRoomById(room.id).catch(() => { });
        removeRoomCache(room);
        continue;
      }

      if (guildStatus === 'unavailable' || channelStatus === 'unavailable' || !channel || !isVoiceLike(channel)) {
        continue;
      }

      const empty = channel.members.size === 0;
      if (empty && now - Number(room.lastActiveAt || 0) >= THREE_DAYS_MS) {
        await deleteRoom(room, 'inactive_3d');
      }
    }

  }

  function parseRoomId(customId, prefix) {
    if (!customId || !customId.startsWith(prefix)) return null;
    return customId.slice(prefix.length) || null;
  }

  function isPanelMessageInteraction(interaction) {
    const message = interaction?.message;
    if (!message || message.author?.id !== client.user?.id) return false;
    const embed = message.embeds?.[0];
    if (!embed?.title) return false;
    return String(embed.title).includes('Oda Kontrol');
  }

  async function tryAcknowledge(interaction, payload) {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    const merged = { ephemeral: true, ...body };
    const ackMode = interaction?.[INTERACTION_ACK_MODE_KEY] || null;
    if (interaction.deferred && ackMode === 'reply' && typeof interaction.editReply === 'function') {
      return interaction.editReply(body).catch(() => null);
    }
    if (interaction.replied || interaction.deferred) return interaction.followUp(merged).catch(() => null);
    return interaction.reply(merged).catch(() => null);
  }

  async function deferInteractionReply(interaction) {
    if (!interaction || interaction.replied || interaction.deferred) return interaction?.deferred === true;
    if (typeof interaction.deferReply !== 'function') return false;

    await interaction.deferReply({ ephemeral: true }).catch(() => { });
    if (!interaction.deferred) return false;
    interaction[INTERACTION_ACK_MODE_KEY] = 'reply';
    return true;
  }

  async function deferInteractionUpdate(interaction) {
    if (!interaction || interaction.replied || interaction.deferred) return interaction?.deferred === true;
    if (typeof interaction.deferUpdate !== 'function') return false;

    await interaction.deferUpdate().catch(() => { });
    if (!interaction.deferred) return false;
    interaction[INTERACTION_ACK_MODE_KEY] = 'update';
    return true;
  }

  async function requireOwner(interaction, room) {
    if (isRoomOwner(room, interaction.user.id)) return true;
    await tryAcknowledge(interaction, 'Bu işlem yalnızca oda sahibi tarafından kullanılabilir. ୭ ˚. !!');
    return false;
  }

  async function hydrateRoomFromToken(guildId, token) {
    if (!guildId || !token) return null;

    const cachedById = getRoomByIdCached(token);
    if (cachedById?.guildId === guildId) return cachedById;

    const mappedRoomId = roomIdByChannel.get(token);
    if (mappedRoomId) {
      const mappedRoom = getRoomByIdCached(mappedRoomId);
      if (mappedRoom?.guildId === guildId) return mappedRoom;
    }

    const byChannel = await getRoomByChannel(guildId, token);
    if (byChannel) return byChannel;

    return null;
  }

  async function resolveRoomFromCustomId(interaction, prefix) {
    const token = parseRoomId(interaction.customId, prefix);
    if (!token) return null;
    return hydrateRoomFromToken(interaction.guildId, token);
  }

  async function resolveRoomFromCustomIdCached(interaction, prefix) {
    const token = parseRoomId(interaction.customId, prefix);
    if (!token) return null;

    const cachedById = getRoomByIdCached(token);
    if (cachedById?.guildId === interaction.guildId) return cachedById;

    const mappedRoomId = roomIdByChannel.get(token);
    if (!mappedRoomId) return null;

    const mappedRoom = getRoomByIdCached(mappedRoomId);
    if (mappedRoom?.guildId === interaction.guildId) return mappedRoom;
    return null;
  }

  function isAuthoritativePanelInteraction(interaction, room) {
    const messageId = String(interaction?.message?.id || '').trim();
    if (!messageId) return true;

    const panelMessageId = String(room?.panelMessageId || '').trim();
    if (!panelMessageId) return false;
    return messageId === panelMessageId;
  }

  async function requireCurrentPanel(interaction, room) {
    if (isAuthoritativePanelInteraction(interaction, room)) return true;
    await tryAcknowledge(interaction, 'Bu panel güncel değil. Odaya yeniden girerek paneli yenileyin. ୭ ˚. !!');
    return false;
  }

  async function waitWhitelistLock(roomId, context = {}) {
    const key = roomKey(roomId);
    const startedAt = Date.now();

    while (roomWhitelistLock.has(key)) {
      if (Date.now() - startedAt >= WHITELIST_LOCK_TIMEOUT_MS) {
        const err = new Error('private_room_whitelist_lock_timeout');
        err.code = 'PRIVATE_ROOM_LOCK_TIMEOUT';
        logError('private_room_whitelist_lock_timeout', err, {
          roomId: key,
          timeoutMs: WHITELIST_LOCK_TIMEOUT_MS,
          waitedMs: Date.now() - startedAt,
          context,
        });
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    roomWhitelistLock.add(key);
  }

  async function waitOwnerLock(guildId, ownerId, context = {}) {
    const key = `${toId(guildId) || guildId}:${toId(ownerId) || ownerId}`;
    const startedAt = Date.now();

    while (roomOwnerLock.has(key)) {
      if (Date.now() - startedAt >= WHITELIST_LOCK_TIMEOUT_MS) {
        const err = new Error('private_room_owner_lock_timeout');
        err.code = 'PRIVATE_ROOM_OWNER_LOCK_TIMEOUT';
        logError('private_room_owner_lock_timeout', err, {
          ownerKey: key,
          timeoutMs: WHITELIST_LOCK_TIMEOUT_MS,
          waitedMs: Date.now() - startedAt,
          context,
        });
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    roomOwnerLock.add(key);
    return key;
  }

  function releaseOwnerLock(lockKey) {
    if (!lockKey) return;
    roomOwnerLock.delete(lockKey);
  }

  function readConnectOverwriteState(overwrite) {
    if (overwrite?.allow?.has?.(CONNECT_PERMISSION)) return OVERWRITE_CONNECT_ALLOW;
    if (overwrite?.deny?.has?.(CONNECT_PERMISSION)) return OVERWRITE_CONNECT_DENY;
    return OVERWRITE_CONNECT_INHERIT;
  }

  function connectOverwriteStateToValue(state) {
    if (state === OVERWRITE_CONNECT_ALLOW) return true;
    if (state === OVERWRITE_CONNECT_DENY) return false;
    return null;
  }

  function isDiscordMissingResourceError(err) {
    const numericCode = Number(err?.code || err?.rawError?.code || 0);
    if (numericCode === 10003 || numericCode === 10004 || numericCode === 10008) return true;

    const status = Number(err?.status || err?.httpStatus || err?.rawError?.status || 0);
    if (status === 404) return true;

    const message = String(err?.message || '').toLowerCase();
    return message.includes('unknown channel') || message.includes('unknown guild') || message.includes('unknown message');
  }

  async function resolveGuildReference(guildId, context = {}) {
    const normalizedGuildId = String(guildId || '').trim();
    if (!normalizedGuildId) return { guild: null, status: 'missing' };

    const cachedGuild = client.guilds.cache.get(normalizedGuildId);
    if (cachedGuild) return { guild: cachedGuild, status: 'ok' };

    try {
      const fetchedGuild = await client.guilds.fetch(normalizedGuildId);
      return fetchedGuild ? { guild: fetchedGuild, status: 'ok' } : { guild: null, status: 'missing' };
    } catch (err) {
      if (isDiscordMissingResourceError(err)) {
        return { guild: null, status: 'missing' };
      }
      logError('private_room_guild_fetch_failed', err, {
        guildId: normalizedGuildId,
        ...context,
      });
      return { guild: null, status: 'unavailable' };
    }
  }

  async function resolveChannelReference(guild, channelId, context = {}) {
    const normalizedChannelId = String(channelId || '').trim();
    if (!guild || !normalizedChannelId) return { channel: null, status: 'missing' };

    const cachedChannel = guild.channels?.cache?.get?.(normalizedChannelId) || null;
    if (cachedChannel) return { channel: cachedChannel, status: 'ok' };

    try {
      const fetchedChannel = await guild.channels?.fetch?.(normalizedChannelId);
      return fetchedChannel ? { channel: fetchedChannel, status: 'ok' } : { channel: null, status: 'missing' };
    } catch (err) {
      if (isDiscordMissingResourceError(err)) {
        return { channel: null, status: 'missing' };
      }
      logError('private_room_channel_fetch_failed', err, {
        guildId: guild?.id || null,
        channelId: normalizedChannelId,
        ...context,
      });
      return { channel: null, status: 'unavailable' };
    }
  }

  async function resolveRoomChannel(room, context = {}) {
    if (!room?.guildId || !room?.voiceChannelId) return { guild: null, channel: null };
    const guildResult = await resolveGuildReference(room.guildId, {
      roomId: room.id,
      channelId: room.voiceChannelId,
      ...context,
    });
    if (!guildResult.guild) {
      return {
        guild: null,
        channel: null,
        guildStatus: guildResult.status,
        channelStatus: guildResult.status === 'missing' ? 'missing' : 'unavailable',
      };
    }

    const channelResult = await resolveChannelReference(guildResult.guild, room.voiceChannelId, {
      roomId: room.id,
      ...context,
    });
    return {
      guild: guildResult.guild,
      channel: channelResult.channel,
      guildStatus: guildResult.status,
      channelStatus: channelResult.status,
    };
  }

  async function resolveBotGuildMember(guild) {
    if (!guild?.members) return null;
    if (guild.members.me) return guild.members.me;

    if (typeof guild.members.fetchMe === 'function') {
      const me = await guild.members.fetchMe().catch(() => null);
      if (me) return me;
    }

    if (client?.user?.id && typeof guild.members.fetch === 'function') {
      return guild.members.fetch(client.user.id).catch(() => null);
    }

    return null;
  }

  async function canManageChannelOverwrites(guild, channel, room) {
    if (!channel?.permissionOverwrites?.edit || !channel?.permissionOverwrites?.cache?.get) {
      const err = new Error('permission_overwrite_api_unavailable');
      logError('private_room_permission_overwrite_unavailable', err, {
        guildId: room?.guildId || guild?.id || null,
        roomId: room?.id || null,
        channelId: room?.voiceChannelId || channel?.id || null,
      });
      return false;
    }

    const botMember = await resolveBotGuildMember(guild);
    if (botMember?.permissions?.has && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      const err = new Error('bot_missing_manage_channels');
      err.code = 'BOT_MISSING_MANAGE_CHANNELS';
      logError('private_room_manage_channels_missing', err, {
        guildId: guild?.id || room?.guildId || null,
        roomId: room?.id || null,
        channelId: channel?.id || room?.voiceChannelId || null,
      });
      return false;
    }

    return true;
  }

  async function editViewOverwrite({
    channel,
    target,
    targetId: _targetId,
    value,
    type,
    room,
    action,
  }) {
    await channel.permissionOverwrites.edit(target, { ViewChannel: value }, {
      reason: `private_room_visibility_${action}_${room?.id || 'unknown'}`,
      type,
    });
  }

  async function rollbackViewOverwriteChanges(channel, room, changes) {
    for (const change of [...(changes || [])].reverse()) {
      try {
        await editViewOverwrite({
          channel,
          target: change.target,
          targetId: change.targetId,
          value: viewOverwriteStateToValue(change.previousState),
          type: change.type,
          room,
          action: `rollback_${change.action}`,
        });
      } catch (err) {
        logError('private_room_visibility_rollback_failed', err, {
          guildId: room?.guildId || null,
          roomId: room?.id || null,
          channelId: room?.voiceChannelId || channel?.id || null,
          targetId: change.targetId,
          action: change.action,
        });
      }
    }
  }

  async function verifyHiddenRoomOverwrites(channel, state) {
    const refreshed = (await channel.fetch?.().catch(() => null)) || channel;
    const cache = refreshed?.permissionOverwrites?.cache;
    if (!cache?.get || !state?.everyoneRoleId) return false;
    if (readViewChannelState(cache.get(state.everyoneRoleId)) !== OVERWRITE_CONNECT_DENY) return false;

    for (const roleId of state.managedDenyRoleIds || []) {
      if (readViewChannelState(cache.get(roleId)) !== OVERWRITE_CONNECT_DENY) return false;
    }

    return true;
  }

  async function verifyVisibleRoomOverwrites(channel, state) {
    const refreshed = (await channel.fetch?.().catch(() => null)) || channel;
    const cache = refreshed?.permissionOverwrites?.cache;
    if (!cache?.get || !state?.everyoneRoleId) return false;

    const previousEveryoneState =
      state.everyoneViewStateBeforeHide || OVERWRITE_CONNECT_INHERIT;
    if (readViewChannelState(cache.get(state.everyoneRoleId)) !== previousEveryoneState) {
      return false;
    }

    for (const roleId of state.managedDenyRoleIds || []) {
      const previousState =
        state.roleViewStatesBeforeHide.get(roleId) || OVERWRITE_CONNECT_INHERIT;
      if (readViewChannelState(cache.get(roleId)) !== previousState) {
        return false;
      }
    }

    return true;
  }

  async function persistRoomVisibilitySnapshot(room, state, extraPatch = {}) {
    const nextSnapshot = visibilityStateToSnapshot(state);
    if (visibilitySnapshotsEqual(room?.visibilitySnapshot, nextSnapshot) && !Object.keys(extraPatch || {}).length) {
      return room;
    }

    const updated = await privateVoiceRepository.updateRoom(room.id, {
      visibilitySnapshot: nextSnapshot,
      ...extraPatch,
    }).catch((err) => {
      logError('private_room_visibility_persist_failed', err, {
        guildId: room?.guildId || null,
        roomId: room?.id || null,
        action: state ? 'hide_sync' : 'show_restore',
      });
      throw err;
    });

    const activeRoom = updated || {
      ...room,
      visibilitySnapshot: nextSnapshot,
    };
    cacheRoom(activeRoom);
    return activeRoom;
  }

  async function syncRoomVisibilityOverwrites(room, mode) {
    const { guild, channel } = await resolveRoomChannel(room);
    if (!guild || !isVoiceLike(channel)) {
      const err = new Error('private_room_channel_unavailable');
      err.code = 'PRIVATE_ROOM_CHANNEL_UNAVAILABLE';
      throw err;
    }
    if (!(await canManageChannelOverwrites(guild, channel, room))) {
      const err = new Error('private_room_manage_channels_missing');
      err.code = 'PRIVATE_ROOM_MANAGE_CHANNELS_MISSING';
      throw err;
    }

    const everyoneRole = guild.roles?.everyone || null;
    const everyoneRoleId = String(everyoneRole?.id || guild.id || '').trim();
    if (!everyoneRoleId) {
      const err = new Error('private_room_everyone_role_missing');
      err.code = 'PRIVATE_ROOM_EVERYONE_ROLE_MISSING';
      throw err;
    }

    const overwriteCache = channel.permissionOverwrites.cache;
    const isShow = mode === 'show';
    const appliedChanges = [];

    if (!isShow) {
      const baseState = snapshotToVisibilityState(room.visibilitySnapshot) || {
        everyoneRoleId,
        everyoneViewStateBeforeHide: readViewChannelState(overwriteCache.get(everyoneRoleId)),
        roleViewStatesBeforeHide: new Map(),
        managedDenyRoleIds: new Set(),
      };
      const state = {
        everyoneRoleId,
        everyoneViewStateBeforeHide: baseState.everyoneViewStateBeforeHide,
        roleViewStatesBeforeHide: new Map(baseState.roleViewStatesBeforeHide || []),
        managedDenyRoleIds: new Set(baseState.managedDenyRoleIds || []),
      };

      const roleTargets = getRoleOverwriteTargets(guild, channel, everyoneRoleId);
      for (const roleTarget of roleTargets) {
        const currentRoleState = readViewChannelState(roleTarget.overwrite);
        if (currentRoleState === OVERWRITE_CONNECT_ALLOW) {
          if (!state.roleViewStatesBeforeHide.has(roleTarget.roleId)) {
            state.roleViewStatesBeforeHide.set(roleTarget.roleId, currentRoleState);
          }
          state.managedDenyRoleIds.add(roleTarget.roleId);
        }
      }

      const currentEveryoneState = readViewChannelState(overwriteCache.get(everyoneRoleId));
      if (currentEveryoneState !== OVERWRITE_CONNECT_DENY) {
        await editViewOverwrite({
          channel,
          target: everyoneRole || everyoneRoleId,
          targetId: everyoneRoleId,
          value: false,
          type: OverwriteType.Role,
          room,
          action: 'everyone_hide',
        });
        appliedChanges.push({
          target: everyoneRole || everyoneRoleId,
          targetId: everyoneRoleId,
          previousState: currentEveryoneState,
          type: OverwriteType.Role,
          action: 'everyone_hide',
        });
      }

      for (const roleId of state.managedDenyRoleIds) {
        const currentState = readViewChannelState(overwriteCache.get(roleId));
        if (currentState === OVERWRITE_CONNECT_DENY) continue;

        await editViewOverwrite({
          channel,
          target: guild.roles?.cache?.get?.(roleId) || roleId,
          targetId: roleId,
          value: false,
          type: OverwriteType.Role,
          room,
          action: 'role_hide_deny',
        });
        appliedChanges.push({
          target: guild.roles?.cache?.get?.(roleId) || roleId,
          targetId: roleId,
          previousState: currentState,
          type: OverwriteType.Role,
          action: 'role_hide_deny',
        });
      }

      if (!(await verifyHiddenRoomOverwrites(channel, state))) {
        await rollbackViewOverwriteChanges(channel, room, appliedChanges);
        const err = new Error('private_room_visibility_verification_failed');
        err.code = 'PRIVATE_ROOM_VISIBILITY_VERIFICATION_FAILED';
        throw err;
      }

      const changed = appliedChanges.length > 0 || !room.visibilitySnapshot;
      const updatedRoom = await persistRoomVisibilitySnapshot(room, state, changed ? { lastActiveAt: Date.now() } : {});
      return { room: updatedRoom, changed, state: OVERWRITE_CONNECT_DENY };
    }

    const state = snapshotToVisibilityState(room.visibilitySnapshot);
    if (!state?.everyoneRoleId) {
      const err = new Error('private_room_visibility_snapshot_missing');
      err.code = 'PRIVATE_ROOM_VISIBILITY_SNAPSHOT_MISSING';
      throw err;
    }

    const previousEveryoneState =
      state.everyoneViewStateBeforeHide || OVERWRITE_CONNECT_INHERIT;
    const currentEveryoneState = readViewChannelState(overwriteCache.get(state.everyoneRoleId || everyoneRoleId));
    if (currentEveryoneState !== previousEveryoneState) {
      await editViewOverwrite({
        channel,
        target: everyoneRole || state.everyoneRoleId || everyoneRoleId,
        targetId: state.everyoneRoleId || everyoneRoleId,
        value: viewOverwriteStateToValue(previousEveryoneState),
        type: OverwriteType.Role,
        room,
        action: 'everyone_show_restore',
      });
      appliedChanges.push({
        target: everyoneRole || state.everyoneRoleId || everyoneRoleId,
        targetId: state.everyoneRoleId || everyoneRoleId,
        previousState: currentEveryoneState,
        type: OverwriteType.Role,
        action: 'everyone_show_restore',
      });
    }

    for (const roleId of state.managedDenyRoleIds || []) {
      const previousState =
        state.roleViewStatesBeforeHide.get(roleId) || OVERWRITE_CONNECT_INHERIT;
      const currentState = readViewChannelState(overwriteCache.get(roleId));
      if (currentState === previousState) continue;

      await editViewOverwrite({
        channel,
        target: guild.roles?.cache?.get?.(roleId) || roleId,
        targetId: roleId,
        value: viewOverwriteStateToValue(previousState),
        type: OverwriteType.Role,
        room,
        action: 'role_show_restore',
      });
      appliedChanges.push({
        target: guild.roles?.cache?.get?.(roleId) || roleId,
        targetId: roleId,
        previousState: currentState,
        type: OverwriteType.Role,
        action: 'role_show_restore',
      });
    }

    if (!(await verifyVisibleRoomOverwrites(channel, state))) {
      await rollbackViewOverwriteChanges(channel, room, appliedChanges);
      const err = new Error('private_room_visibility_verification_failed');
      err.code = 'PRIVATE_ROOM_VISIBILITY_VERIFICATION_FAILED';
      throw err;
    }

    const updated = await privateVoiceRepository.updateRoom(room.id, {
      visibilitySnapshot: null,
      lastActiveAt: Date.now(),
    }).catch((err) => {
      logError('private_room_visibility_persist_failed', err, {
        guildId: room.guildId,
        roomId: room.id,
        action: 'show_restore',
      });
      return null;
    });

    if (!updated) {
      await rollbackViewOverwriteChanges(channel, room, appliedChanges);
      const err = new Error('private_room_visibility_persist_failed');
      err.code = 'PRIVATE_ROOM_VISIBILITY_PERSIST_FAILED';
      throw err;
    }

    cacheRoom(updated);
    return { room: updated, changed: appliedChanges.length > 0 || Boolean(room.visibilitySnapshot), state: previousEveryoneState };
  }

  function getDesiredAllowedMemberIds(room) {
    return uniqIds([room?.ownerId, ...getPermitMemberIds(room)]);
  }

  function getDesiredAllowedRoleIds(room) {
    return getPermitRoleIds(room);
  }

  function getDesiredDeniedMemberIds(room) {
    return getRejectMemberIds(room);
  }

  function getDesiredDeniedRoleIds(room) {
    return getRejectRoleIds(room);
  }

  async function editConnectOverwrite({
    channel,
    target,
    targetId: _targetId,
    value,
    type,
    room,
    action,
  }) {
    await channel.permissionOverwrites.edit(target, { Connect: value }, {
      reason: `private_room_lock_${action}_${room?.id || 'unknown'}`,
      type,
    });
  }

  async function persistRoomLockSnapshot(room, state, { persist = true } = {}) {
    const nextSnapshot = lockStateToSnapshot(state);
    if (snapshotsEqual(room?.lockSnapshot, nextSnapshot)) {
      if (nextSnapshot) lockOverwriteStateByRoom.set(roomKey(room.id), snapshotToLockState(nextSnapshot));
      else lockOverwriteStateByRoom.delete(roomKey(room.id));
      return {
        ...room,
        lockSnapshot: nextSnapshot,
      };
    }

    if (!persist) {
      if (nextSnapshot) lockOverwriteStateByRoom.set(roomKey(room.id), snapshotToLockState(nextSnapshot));
      else lockOverwriteStateByRoom.delete(roomKey(room.id));
      return {
        ...room,
        lockSnapshot: nextSnapshot,
      };
    }

    const updated = await privateVoiceRepository.updateRoom(room.id, {
      lockSnapshot: nextSnapshot,
    }).catch((err) => {
      logError('private_room_lock_snapshot_persist_failed', err, {
        guildId: room?.guildId || null,
        roomId: room?.id || null,
      });
      throw err;
    });

    const activeRoom = updated || {
      ...room,
      lockSnapshot: nextSnapshot,
    };
    cacheRoom(activeRoom);
    return activeRoom;
  }

  function logOverwriteFailure(room, channel, targetId, value, action, err) {
    logError('private_room_lock_overwrite_edit_failed', err, {
      guildId: room?.guildId || null,
      roomId: room?.id || null,
      channelId: room?.voiceChannelId || channel?.id || null,
      targetId: String(targetId || ''),
      connectValue: value,
      action,
    });
  }

  async function rollbackOverwriteChanges(channel, room, changes) {
    for (const change of [...(changes || [])].reverse()) {
      try {
        await editConnectOverwrite({
          channel,
          target: change.target,
          targetId: change.targetId,
          value: connectOverwriteStateToValue(change.previousState),
          type: change.type,
          room,
          action: `rollback_${change.action}`,
        });
      } catch (err) {
        logError('private_room_lock_overwrite_rollback_failed', err, {
          guildId: room?.guildId || null,
          roomId: room?.id || null,
          channelId: room?.voiceChannelId || channel?.id || null,
          targetId: change.targetId,
          action: change.action,
        });
      }
    }
  }

  async function verifyConnectOverwritePlan(channel, {
    everyoneRoleId,
    everyoneExpectedState,
    desiredMemberStates,
    desiredRoleStates,
    restoredMemberStates = new Map(),
    restoredRoleStates = new Map(),
  }) {
    const refreshed = (await channel.fetch?.().catch(() => null)) || channel;
    const cache = refreshed?.permissionOverwrites?.cache;
    if (!cache?.get || !everyoneRoleId) return false;
    if (readConnectOverwriteState(cache.get(everyoneRoleId)) !== everyoneExpectedState) return false;

    for (const [memberId, expectedState] of desiredMemberStates || []) {
      if (readConnectOverwriteState(cache.get(memberId)) !== expectedState) return false;
    }

    for (const [roleId, expectedState] of desiredRoleStates || []) {
      if (readConnectOverwriteState(cache.get(roleId)) !== expectedState) return false;
    }

    for (const [memberId, expectedState] of restoredMemberStates || []) {
      if (readConnectOverwriteState(cache.get(memberId)) !== expectedState) return false;
    }

    for (const [roleId, expectedState] of restoredRoleStates || []) {
      if (readConnectOverwriteState(cache.get(roleId)) !== expectedState) return false;
    }

    return true;
  }

  async function syncRoomAccessOverwrites(room, { persistSnapshot = true } = {}) {
    if (!room?.id || !room?.guildId || !room?.voiceChannelId) {
      const err = new Error('private_room_invalid_room_reference');
      err.code = 'PRIVATE_ROOM_INVALID_ROOM_REFERENCE';
      throw err;
    }

    const { guild, channel } = await resolveRoomChannel(room);
    if (!guild || !isVoiceLike(channel)) {
      const err = new Error('private_room_channel_unavailable');
      err.code = 'PRIVATE_ROOM_CHANNEL_UNAVAILABLE';
      throw err;
    }
    if (!(await canManageChannelOverwrites(guild, channel, room))) {
      const err = new Error('private_room_manage_channels_missing');
      err.code = 'PRIVATE_ROOM_MANAGE_CHANNELS_MISSING';
      throw err;
    }

    const everyoneRole = guild.roles?.everyone || null;
    const everyoneRoleId = String(everyoneRole?.id || guild.id || '').trim();
    if (!everyoneRoleId) {
      const err = new Error('private_room_everyone_role_missing');
      err.code = 'PRIVATE_ROOM_EVERYONE_ROLE_MISSING';
      throw err;
    }

    const key = roomKey(room.id);
    const overwriteCache = channel.permissionOverwrites.cache;
    const normalizedRoom = normalizeRoomAccessLists(room);
    const needsManagedAccess = roomNeedsManagedAccess(normalizedRoom);

    let baseState = lockOverwriteStateByRoom.get(key) || snapshotToLockState(normalizedRoom.lockSnapshot);
    if (!baseState && needsManagedAccess && normalizedRoom.captureLockSnapshot === 'fallback') {
      baseState = {
        everyoneRoleId,
        everyoneConnectStateBeforeLock: OVERWRITE_CONNECT_INHERIT,
        memberConnectStatesBeforeLock: new Map(),
        roleConnectStatesBeforeLock: new Map(),
        managedAllowMemberIds: new Set(),
        managedDenyMemberIds: new Set(),
        managedAllowRoleIds: new Set(),
        managedDenyRoleIds: new Set(),
        fallbackMode: true,
      };
    } else if (!baseState && needsManagedAccess) {
      baseState = {
        everyoneRoleId,
        everyoneConnectStateBeforeLock: readConnectOverwriteState(overwriteCache.get(everyoneRoleId)),
        memberConnectStatesBeforeLock: new Map(),
        roleConnectStatesBeforeLock: new Map(),
        managedAllowMemberIds: new Set(),
        managedDenyMemberIds: new Set(),
        managedAllowRoleIds: new Set(),
        managedDenyRoleIds: new Set(),
        fallbackMode: false,
      };
    }

    if (!baseState?.everyoneRoleId) {
      if (!needsManagedAccess) {
        lockOverwriteStateByRoom.delete(key);
        return { ok: true, room: { ...normalizedRoom, lockSnapshot: null }, snapshot: null };
      }
      const err = new Error('private_room_access_snapshot_missing');
      err.code = normalizedRoom.locked
        ? 'PRIVATE_ROOM_LOCK_SNAPSHOT_MISSING'
        : 'PRIVATE_ROOM_UNLOCK_SNAPSHOT_MISSING';
      throw err;
    }

    const state = {
      everyoneRoleId,
      everyoneConnectStateBeforeLock: baseState.everyoneConnectStateBeforeLock,
      memberConnectStatesBeforeLock: new Map(baseState.memberConnectStatesBeforeLock || []),
      roleConnectStatesBeforeLock: new Map(baseState.roleConnectStatesBeforeLock || []),
      managedAllowMemberIds: new Set(baseState.managedAllowMemberIds || []),
      managedDenyMemberIds: new Set(baseState.managedDenyMemberIds || []),
      managedAllowRoleIds: new Set(baseState.managedAllowRoleIds || []),
      managedDenyRoleIds: new Set(baseState.managedDenyRoleIds || []),
      fallbackMode: Boolean(baseState.fallbackMode),
    };

    const desiredMemberStates = new Map();
    const desiredRoleStates = new Map();
    const desiredAllowedMemberIds = new Set(getDesiredAllowedMemberIds(normalizedRoom));
    const desiredDeniedMemberIds = new Set(getDesiredDeniedMemberIds(normalizedRoom));
    const desiredAllowedRoleIds = new Set(getDesiredAllowedRoleIds(normalizedRoom));
    const desiredDeniedRoleIds = new Set(getDesiredDeniedRoleIds(normalizedRoom));

    if (normalizedRoom.locked) {
      for (const memberId of desiredAllowedMemberIds) {
        if (desiredDeniedMemberIds.has(memberId)) continue;
        desiredMemberStates.set(memberId, OVERWRITE_CONNECT_ALLOW);
      }

      for (const roleId of desiredAllowedRoleIds) {
        if (desiredDeniedRoleIds.has(roleId)) continue;
        desiredRoleStates.set(roleId, OVERWRITE_CONNECT_ALLOW);
      }

      for (const memberTarget of getMemberOverwriteTargets(guild, channel, everyoneRoleId)) {
        const currentState = readConnectOverwriteState(memberTarget.overwrite);
        if (currentState === OVERWRITE_CONNECT_ALLOW && !desiredMemberStates.has(memberTarget.memberId)) {
          desiredMemberStates.set(memberTarget.memberId, OVERWRITE_CONNECT_DENY);
        }
      }

      for (const roleTarget of getRoleOverwriteTargets(guild, channel, everyoneRoleId)) {
        const currentState = readConnectOverwriteState(roleTarget.overwrite);
        if (currentState === OVERWRITE_CONNECT_ALLOW && !desiredRoleStates.has(roleTarget.roleId)) {
          desiredRoleStates.set(roleTarget.roleId, OVERWRITE_CONNECT_DENY);
        }
      }
    }

    for (const memberId of desiredDeniedMemberIds) {
      desiredMemberStates.set(memberId, OVERWRITE_CONNECT_DENY);
    }

    for (const roleId of desiredDeniedRoleIds) {
      desiredRoleStates.set(roleId, OVERWRITE_CONNECT_DENY);
    }

    for (const memberId of desiredMemberStates.keys()) {
      if (!state.memberConnectStatesBeforeLock.has(memberId)) {
        state.memberConnectStatesBeforeLock.set(
          memberId,
          state.fallbackMode
            ? OVERWRITE_CONNECT_INHERIT
            : readConnectOverwriteState(overwriteCache.get(memberId))
        );
      }
    }

    for (const roleId of desiredRoleStates.keys()) {
      if (!state.roleConnectStatesBeforeLock.has(roleId)) {
        state.roleConnectStatesBeforeLock.set(
          roleId,
          state.fallbackMode
            ? OVERWRITE_CONNECT_INHERIT
            : readConnectOverwriteState(overwriteCache.get(roleId))
        );
      }
    }

    const appliedChanges = [];
    const restoredMemberStates = new Map();
    const restoredRoleStates = new Map();
    const everyoneExpectedState = normalizedRoom.locked
      ? OVERWRITE_CONNECT_DENY
      : state.everyoneConnectStateBeforeLock || OVERWRITE_CONNECT_INHERIT;

    const currentEveryoneState = readConnectOverwriteState(overwriteCache.get(everyoneRoleId));
    if (currentEveryoneState !== everyoneExpectedState) {
      try {
        await editConnectOverwrite({
          channel,
          target: everyoneRole || everyoneRoleId,
          targetId: everyoneRoleId,
          value: connectOverwriteStateToValue(everyoneExpectedState),
          type: OverwriteType.Role,
          room: normalizedRoom,
          action: normalizedRoom.locked ? 'everyone_deny' : 'everyone_restore',
        });
        appliedChanges.push({
          target: everyoneRole || everyoneRoleId,
          targetId: everyoneRoleId,
          previousState: currentEveryoneState,
          type: OverwriteType.Role,
          action: normalizedRoom.locked ? 'everyone_deny' : 'everyone_restore',
        });
      } catch (err) {
        logOverwriteFailure(
          normalizedRoom,
          channel,
          everyoneRoleId,
          connectOverwriteStateToValue(everyoneExpectedState),
          normalizedRoom.locked ? 'everyone_deny' : 'everyone_restore',
          err
        );
        throw err;
      }
    }

    for (const [memberId, desiredState] of desiredMemberStates) {
      const currentState = readConnectOverwriteState(overwriteCache.get(memberId));
      if (currentState === desiredState) continue;

      try {
        await editConnectOverwrite({
          channel,
          target: memberId,
          targetId: memberId,
          value: connectOverwriteStateToValue(desiredState),
          type: OverwriteType.Member,
          room: normalizedRoom,
          action: desiredState === OVERWRITE_CONNECT_ALLOW ? 'member_allow' : 'member_deny',
        });
        appliedChanges.push({
          target: memberId,
          targetId: memberId,
          previousState: currentState,
          type: OverwriteType.Member,
          action: desiredState === OVERWRITE_CONNECT_ALLOW ? 'member_allow' : 'member_deny',
        });
      } catch (err) {
        logOverwriteFailure(
          normalizedRoom,
          channel,
          memberId,
          connectOverwriteStateToValue(desiredState),
          desiredState === OVERWRITE_CONNECT_ALLOW ? 'member_allow' : 'member_deny',
          err
        );
        await rollbackOverwriteChanges(channel, normalizedRoom, appliedChanges);
        throw err;
      }
    }

    for (const [roleId, desiredState] of desiredRoleStates) {
      const currentState = readConnectOverwriteState(overwriteCache.get(roleId));
      if (currentState === desiredState) continue;

      try {
        await editConnectOverwrite({
          channel,
          target: guild.roles?.cache?.get?.(roleId) || roleId,
          targetId: roleId,
          value: connectOverwriteStateToValue(desiredState),
          type: OverwriteType.Role,
          room: normalizedRoom,
          action: desiredState === OVERWRITE_CONNECT_ALLOW ? 'role_allow' : 'role_deny',
        });
        appliedChanges.push({
          target: guild.roles?.cache?.get?.(roleId) || roleId,
          targetId: roleId,
          previousState: currentState,
          type: OverwriteType.Role,
          action: desiredState === OVERWRITE_CONNECT_ALLOW ? 'role_allow' : 'role_deny',
        });
      } catch (err) {
        logOverwriteFailure(
          normalizedRoom,
          channel,
          roleId,
          connectOverwriteStateToValue(desiredState),
          desiredState === OVERWRITE_CONNECT_ALLOW ? 'role_allow' : 'role_deny',
          err
        );
        await rollbackOverwriteChanges(channel, normalizedRoom, appliedChanges);
        throw err;
      }
    }

    const previousManagedMemberIds = new Set([
      ...(state.managedAllowMemberIds || []),
      ...(state.managedDenyMemberIds || []),
    ]);
    for (const memberId of previousManagedMemberIds) {
      if (desiredMemberStates.has(memberId)) continue;
      const previousState =
        state.memberConnectStatesBeforeLock.get(memberId) || OVERWRITE_CONNECT_INHERIT;
      const currentState = readConnectOverwriteState(overwriteCache.get(memberId));
      if (currentState === previousState) continue;

      try {
        await editConnectOverwrite({
          channel,
          target: memberId,
          targetId: memberId,
          value: connectOverwriteStateToValue(previousState),
          type: OverwriteType.Member,
          room: normalizedRoom,
          action: 'member_restore',
        });
        appliedChanges.push({
          target: memberId,
          targetId: memberId,
          previousState: currentState,
          type: OverwriteType.Member,
          action: 'member_restore',
        });
        restoredMemberStates.set(memberId, previousState);
      } catch (err) {
        logOverwriteFailure(
          normalizedRoom,
          channel,
          memberId,
          connectOverwriteStateToValue(previousState),
          'member_restore',
          err
        );
        await rollbackOverwriteChanges(channel, normalizedRoom, appliedChanges);
        throw err;
      }
    }

    const previousManagedRoleIds = new Set([
      ...(state.managedAllowRoleIds || []),
      ...(state.managedDenyRoleIds || []),
    ]);
    for (const roleId of previousManagedRoleIds) {
      if (desiredRoleStates.has(roleId)) continue;
      const previousState =
        state.roleConnectStatesBeforeLock.get(roleId) || OVERWRITE_CONNECT_INHERIT;
      const currentState = readConnectOverwriteState(overwriteCache.get(roleId));
      if (currentState === previousState) continue;

      try {
        await editConnectOverwrite({
          channel,
          target: guild.roles?.cache?.get?.(roleId) || roleId,
          targetId: roleId,
          value: connectOverwriteStateToValue(previousState),
          type: OverwriteType.Role,
          room: normalizedRoom,
          action: 'role_restore',
        });
        appliedChanges.push({
          target: guild.roles?.cache?.get?.(roleId) || roleId,
          targetId: roleId,
          previousState: currentState,
          type: OverwriteType.Role,
          action: 'role_restore',
        });
        restoredRoleStates.set(roleId, previousState);
      } catch (err) {
        logOverwriteFailure(
          normalizedRoom,
          channel,
          roleId,
          connectOverwriteStateToValue(previousState),
          'role_restore',
          err
        );
        await rollbackOverwriteChanges(channel, normalizedRoom, appliedChanges);
        throw err;
      }
    }

    if (!(await verifyConnectOverwritePlan(channel, {
      everyoneRoleId,
      everyoneExpectedState,
      desiredMemberStates,
      desiredRoleStates,
      restoredMemberStates,
      restoredRoleStates,
    }))) {
      await rollbackOverwriteChanges(channel, normalizedRoom, appliedChanges);
      const err = new Error('private_room_access_verification_failed');
      err.code = normalizedRoom.locked
        ? 'PRIVATE_ROOM_LOCK_VERIFICATION_FAILED'
        : 'PRIVATE_ROOM_UNLOCK_VERIFICATION_FAILED';
      throw err;
    }

    state.managedAllowMemberIds = new Set(
      [...desiredMemberStates.entries()]
        .filter(([, desiredState]) => desiredState === OVERWRITE_CONNECT_ALLOW)
        .map(([memberId]) => memberId)
    );
    state.managedDenyMemberIds = new Set(
      [...desiredMemberStates.entries()]
        .filter(([, desiredState]) => desiredState === OVERWRITE_CONNECT_DENY)
        .map(([memberId]) => memberId)
    );
    state.managedAllowRoleIds = new Set(
      [...desiredRoleStates.entries()]
        .filter(([, desiredState]) => desiredState === OVERWRITE_CONNECT_ALLOW)
        .map(([roleId]) => roleId)
    );
    state.managedDenyRoleIds = new Set(
      [...desiredRoleStates.entries()]
        .filter(([, desiredState]) => desiredState === OVERWRITE_CONNECT_DENY)
        .map(([roleId]) => roleId)
    );

    const hasManagedState =
      state.managedAllowMemberIds.size > 0 ||
      state.managedDenyMemberIds.size > 0 ||
      state.managedAllowRoleIds.size > 0 ||
      state.managedDenyRoleIds.size > 0 ||
      normalizedRoom.locked;

    if (!hasManagedState) {
      const updatedRoom = await persistRoomLockSnapshot(normalizedRoom, null, { persist: persistSnapshot });
      return { ok: true, room: updatedRoom, snapshot: null };
    }

    lockOverwriteStateByRoom.set(key, state);
    const updatedRoom = await persistRoomLockSnapshot(normalizedRoom, state, { persist: persistSnapshot });
    return { ok: true, room: updatedRoom, snapshot: lockStateToSnapshot(state) };
  }

  async function syncLockedRoomOverwrites(room, options = {}) {
    return syncRoomAccessOverwrites(room, options);
  }

  function releaseWhitelistLock(roomId) {
    roomWhitelistLock.delete(roomKey(roomId));
  }

  async function runWithRoomMutationLock(roomId, context, fn) {
    await waitWhitelistLock(roomId, context);
    try {
      return await fn();
    } finally {
      releaseWhitelistLock(roomId);
    }
  }

  async function insertRoomAccessLogs(room, entries = []) {
    await Promise.all(
      (entries || []).map((entry) =>
        privateVoiceRepository
          .insertRoomLog({
            roomId: room.id,
            guildId: room.guildId,
            ownerId: entry.ownerId,
            actionType: entry.actionType,
            targetUserId: entry.targetUserId || null,
            metadata: entry.metadata || null,
          })
          .catch((err) => {
            logError('private_room_log_insert_failed', err, {
              roomId: room.id,
              guildId: room.guildId,
              action: entry.actionType,
              targetUserId: entry.targetUserId || null,
              metadata: entry.metadata || null,
            });
          })
      )
    );
  }

  async function commitRoomAccessMutation(room, actorId, context, buildNextRoom, logEntries = []) {
    return runWithRoomMutationLock(room.id, context, async () => {
      const baseRoom = normalizeRoomAccessLists(
        (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
      );
      const previousRoom = {
        ...baseRoom,
        lockSnapshot: cloneLockSnapshot(baseRoom.lockSnapshot),
      };
      const nextRoom = normalizeRoomAccessLists(await buildNextRoom(baseRoom));

      let syncResult = null;
      try {
        syncResult = await syncRoomAccessOverwrites(
          {
            ...nextRoom,
            lockSnapshot: cloneLockSnapshot(previousRoom.lockSnapshot),
            captureLockSnapshot:
              !previousRoom.lockSnapshot && roomNeedsManagedAccess(nextRoom) ? true : false,
          },
          { persistSnapshot: false }
        );
      } catch (err) {
        throw err;
      }

      const updated = await privateVoiceRepository
        .updateRoom(baseRoom.id, {
          ownerId: nextRoom.ownerId,
          locked: Boolean(nextRoom.locked),
          whitelistMemberIds: getPermitMemberIds(nextRoom),
          permitRoleIds: getPermitRoleIds(nextRoom),
          rejectMemberIds: getRejectMemberIds(nextRoom),
          rejectRoleIds: getRejectRoleIds(nextRoom),
          lockSnapshot: cloneLockSnapshot(syncResult?.snapshot || null),
          lastActiveAt: Date.now(),
        })
        .catch((err) => {
          logError('private_room_access_state_persist_failed', err, {
            guildId: baseRoom.guildId,
            roomId: baseRoom.id,
            context,
          });
          return null;
        });

      if (!updated) {
        await syncRoomAccessOverwrites(
          {
            ...previousRoom,
            captureLockSnapshot: previousRoom.lockSnapshot ? false : 'fallback',
          },
          { persistSnapshot: false }
        ).catch((err) => {
          logError('private_room_access_state_rollback_failed', err, {
            guildId: baseRoom.guildId,
            roomId: baseRoom.id,
            context,
          });
        });
        return null;
      }

      const activeRoom = normalizeRoomAccessLists(updated);
      cacheRoom(activeRoom);
      await insertRoomAccessLogs(activeRoom, logEntries);
      await syncPanelMessage(activeRoom);
      await disconnectUnauthorizedMembers(activeRoom);
      return activeRoom;
    });
  }

  async function addWhitelistMembers(room, actorId, userIds, source = 'select_add') {
    const baseRoom = normalizeRoomAccessLists(
      (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
    );
    const current = new Set(getPermitMemberIds(baseRoom));
    const added = [];
    const exists = [];
    const ignoredOwner = [];

    for (const userId of uniqIds(userIds)) {
      if (userId === baseRoom.ownerId) {
        ignoredOwner.push(userId);
        continue;
      }
      if (current.has(userId)) {
        exists.push(userId);
        continue;
      }
      current.add(userId);
      added.push(userId);
    }

    let activeRoom = baseRoom;
    if (added.length > 0) {
      activeRoom = await commitRoomAccessMutation(
        baseRoom,
        actorId,
        {
          action: 'permit_member_add',
          source,
          actorId,
        },
        async (roomState) => ({
          ...roomState,
          permitMemberIds: [...current],
        }),
        added.map((targetUserId) => ({
          ownerId: actorId,
          actionType: 'WHITELIST_ADD',
          targetUserId,
          metadata: { source },
        }))
      );
    }

    return { room: activeRoom || baseRoom, added, exists, ignoredOwner, failed: added.length > 0 && !activeRoom };
  }

  async function removeWhitelistMembers(room, actorId, userIds, source = 'select_remove') {
    const baseRoom = normalizeRoomAccessLists(
      (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
    );
    const current = new Set(getPermitMemberIds(baseRoom));
    const removed = [];
    const missing = [];
    const ignoredOwner = [];

    for (const userId of uniqIds(userIds)) {
      if (userId === baseRoom.ownerId) {
        ignoredOwner.push(userId);
        continue;
      }
      if (!current.has(userId)) {
        missing.push(userId);
        continue;
      }
      current.delete(userId);
      removed.push(userId);
    }

    let activeRoom = baseRoom;
    if (removed.length > 0) {
      activeRoom = await commitRoomAccessMutation(
        baseRoom,
        actorId,
        {
          action: 'permit_member_remove',
          source,
          actorId,
        },
        async (roomState) => ({
          ...roomState,
          permitMemberIds: [...current],
        }),
        removed.map((targetUserId) => ({
          ownerId: actorId,
          actionType: 'WHITELIST_REMOVE',
          targetUserId,
          metadata: { source },
        }))
      );
    }

    return { room: activeRoom || baseRoom, removed, missing, ignoredOwner, failed: removed.length > 0 && !activeRoom };
  }

  function getWhitelistWithoutOwner(room) {
    return getPermitMemberIds(room);
  }

  function buildUserPicker(customId, placeholder, ids = []) {
    const visible = uniqIds(ids).slice(0, 25);
    const picker = new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(0)
      .setMaxValues(25);

    if (visible.length > 0) {
      picker.setDefaultUsers(...visible);
    }

    return {
      row: new ActionRowBuilder().addComponents(picker),
      visibleCount: visible.length,
      hiddenCount: Math.max(0, uniqIds(ids).length - visible.length),
    };
  }

  function buildRolePicker(customId, placeholder, ids = []) {
    const visible = uniqIds(ids).slice(0, 25);
    const picker = new RoleSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(0)
      .setMaxValues(25);

    if (visible.length > 0) {
      picker.setDefaultRoles(...visible);
    }

    return {
      row: new ActionRowBuilder().addComponents(picker),
      visibleCount: visible.length,
      hiddenCount: Math.max(0, uniqIds(ids).length - visible.length),
    };
  }

  function buildWhitelistPicker(room) {
    return buildUserPicker(`pvru:permit:${room.id}`, 'İzin verilecek üyeleri seç', getWhitelistWithoutOwner(room));
  }

  function getRejectMembers(room) {
    return getRejectMemberIds(room);
  }

  function getRejectRoles(room) {
    return getRejectRoleIds(room);
  }

  function buildRejectUserPicker(room) {
    return buildUserPicker(`pvru:reject:${room.id}`, 'Engellenecek üyeleri seç', getRejectMembers(room));
  }

  function buildPermitRolePicker(room) {
    return buildRolePicker(`pvrr:permit:${room.id}`, 'İzin verilecek rolleri seç', getPermitRoleIds(room));
  }

  function buildRejectRolePicker(room) {
    return buildRolePicker(`pvrr:reject:${room.id}`, 'Engellenecek rolleri seç', getRejectRoles(room));
  }

  async function syncWhitelistMembers(room, actorId, selectedUserIds, source = 'select_sync') {
    const baseRoom = normalizeRoomAccessLists(
      (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
    );
    const current = getWhitelistWithoutOwner(baseRoom);
    const visibleCurrent = current.slice(0, 25);
    const hiddenCurrent = current.slice(25);
    const selected = uniqIds(selectedUserIds || []).filter((id) => id !== baseRoom.ownerId);
    const preserveHiddenMembers = hiddenCurrent.length > 0;
    const desired = preserveHiddenMembers ? uniqIds([...selected, ...hiddenCurrent]) : selected;

    const currentSet = new Set(current);
    const desiredSet = new Set(desired);

    const added = desired.filter((id) => !currentSet.has(id));
    const removablePool = preserveHiddenMembers ? visibleCurrent : current;
    const removed = removablePool.filter((id) => !desiredSet.has(id));

    if (added.length === 0 && removed.length === 0) {
      return { room: baseRoom, added, removed, preservedHiddenCount: hiddenCurrent.length };
    }

    const activeRoom = await commitRoomAccessMutation(
      baseRoom,
      actorId,
      {
        action: 'permit_member_sync',
        source,
        actorId,
      },
      async (roomState) => ({
        ...roomState,
        permitMemberIds: desired,
      }),
      [
        ...added.map((targetUserId) => ({
          ownerId: actorId,
          actionType: 'WHITELIST_ADD',
          targetUserId,
          metadata: { source },
        })),
        ...removed.map((targetUserId) => ({
          ownerId: actorId,
          actionType: 'WHITELIST_REMOVE',
          targetUserId,
          metadata: { source },
        })),
      ]
    );

    return {
      room: activeRoom || baseRoom,
      added,
      removed,
      preservedHiddenCount: hiddenCurrent.length,
      failed: !activeRoom,
    };
  }

  async function syncRejectMembers(room, actorId, selectedUserIds, source = 'select_reject_sync') {
    const baseRoom = normalizeRoomAccessLists(
      (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
    );
    const current = getRejectMembers(baseRoom);
    const visibleCurrent = current.slice(0, 25);
    const hiddenCurrent = current.slice(25);
    const selected = uniqIds(selectedUserIds || []).filter((id) => id !== baseRoom.ownerId);
    const preserveHiddenMembers = hiddenCurrent.length > 0;
    const desired = preserveHiddenMembers ? uniqIds([...selected, ...hiddenCurrent]) : selected;

    const currentSet = new Set(current);
    const desiredSet = new Set(desired);
    const added = desired.filter((id) => !currentSet.has(id));
    const removablePool = preserveHiddenMembers ? visibleCurrent : current;
    const removed = removablePool.filter((id) => !desiredSet.has(id));

    if (added.length === 0 && removed.length === 0) {
      return { room: baseRoom, added, removed, preservedHiddenCount: hiddenCurrent.length };
    }

    const activeRoom = await commitRoomAccessMutation(
      baseRoom,
      actorId,
      {
        action: 'reject_member_sync',
        source,
        actorId,
      },
      async (roomState) => ({
        ...roomState,
        rejectMemberIds: desired,
      }),
      [
        ...added.map((targetUserId) => ({
          ownerId: actorId,
          actionType: 'REJECT_MEMBER_ADD',
          targetUserId,
          metadata: { source },
        })),
        ...removed.map((targetUserId) => ({
          ownerId: actorId,
          actionType: 'REJECT_MEMBER_REMOVE',
          targetUserId,
          metadata: { source },
        })),
      ]
    );

    return {
      room: activeRoom || baseRoom,
      added,
      removed,
      preservedHiddenCount: hiddenCurrent.length,
      failed: !activeRoom,
    };
  }

  async function syncPermitRoles(room, actorId, selectedRoleIds, source = 'select_permit_role_sync') {
    const baseRoom = normalizeRoomAccessLists(
      (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
    );
    const current = getPermitRoleIds(baseRoom);
    const visibleCurrent = current.slice(0, 25);
    const hiddenCurrent = current.slice(25);
    const selected = uniqIds(selectedRoleIds || []);
    const preserveHiddenRoles = hiddenCurrent.length > 0;
    const desired = preserveHiddenRoles ? uniqIds([...selected, ...hiddenCurrent]) : selected;

    const currentSet = new Set(current);
    const desiredSet = new Set(desired);
    const added = desired.filter((id) => !currentSet.has(id));
    const removablePool = preserveHiddenRoles ? visibleCurrent : current;
    const removed = removablePool.filter((id) => !desiredSet.has(id));

    if (added.length === 0 && removed.length === 0) {
      return { room: baseRoom, added, removed, preservedHiddenCount: hiddenCurrent.length };
    }

    const activeRoom = await commitRoomAccessMutation(
      baseRoom,
      actorId,
      {
        action: 'permit_role_sync',
        source,
        actorId,
      },
      async (roomState) => ({
        ...roomState,
        permitRoleIds: desired,
      }),
      [
        ...added.map((roleId) => ({
          ownerId: actorId,
          actionType: 'PERMIT_ROLE_ADD',
          metadata: { source, roleId },
        })),
        ...removed.map((roleId) => ({
          ownerId: actorId,
          actionType: 'PERMIT_ROLE_REMOVE',
          metadata: { source, roleId },
        })),
      ]
    );

    return {
      room: activeRoom || baseRoom,
      added,
      removed,
      preservedHiddenCount: hiddenCurrent.length,
      failed: !activeRoom,
    };
  }

  async function syncRejectRoles(room, actorId, selectedRoleIds, source = 'select_reject_role_sync') {
    const baseRoom = normalizeRoomAccessLists(
      (getRoomByIdCached(room.id) || (await hydrateRoomFromToken(room.guildId, room.id))) || room
    );
    const current = getRejectRoles(baseRoom);
    const visibleCurrent = current.slice(0, 25);
    const hiddenCurrent = current.slice(25);
    const selected = uniqIds(selectedRoleIds || []);
    const preserveHiddenRoles = hiddenCurrent.length > 0;
    const desired = preserveHiddenRoles ? uniqIds([...selected, ...hiddenCurrent]) : selected;

    const currentSet = new Set(current);
    const desiredSet = new Set(desired);
    const added = desired.filter((id) => !currentSet.has(id));
    const removablePool = preserveHiddenRoles ? visibleCurrent : current;
    const removed = removablePool.filter((id) => !desiredSet.has(id));

    if (added.length === 0 && removed.length === 0) {
      return { room: baseRoom, added, removed, preservedHiddenCount: hiddenCurrent.length };
    }

    const activeRoom = await commitRoomAccessMutation(
      baseRoom,
      actorId,
      {
        action: 'reject_role_sync',
        source,
        actorId,
      },
      async (roomState) => ({
        ...roomState,
        rejectRoleIds: desired,
      }),
      [
        ...added.map((roleId) => ({
          ownerId: actorId,
          actionType: 'REJECT_ROLE_ADD',
          metadata: { source, roleId },
        })),
        ...removed.map((roleId) => ({
          ownerId: actorId,
          actionType: 'REJECT_ROLE_REMOVE',
          metadata: { source, roleId },
        })),
      ]
    );

    return {
      room: activeRoom || baseRoom,
      added,
      removed,
      preservedHiddenCount: hiddenCurrent.length,
      failed: !activeRoom,
    };
  }

  async function ensureRoomForHubMember(newState) {
    if (!newState?.guild || !newState.channelId || !newState.member) return false;

    const guild = newState.guild;
    const config = await getGuildConfig(guild.id);
    if (!config?.enabled || !config.hubChannelId || !config.requiredRoleId) return false;
    if (newState.channelId !== config.hubChannelId) return false;

    const member = newState.member;
    if (member.user?.bot) return true;

    if (!member.roles?.cache?.has(config.requiredRoleId)) {
      await disconnectMember(member, 'Kalici Oda Izni rolun yok');
      await sendTransient(
        newState.channel,
        `<@${member.id}>, oda oluşturabilmek için <@&${config.requiredRoleId}> rolüne sahip olmalısın. ୭ ˚. !!`
      );
      return true;
    }

    const ownerLockKey = await waitOwnerLock(guild.id, member.id, {
      action: 'ensure_room_for_hub_member',
      channelId: newState.channelId,
    });
    try {
      const existingRoom = await privateVoiceRepository.getRoomByOwner(guild.id, member.id).catch((err) => {
        logError('private_room_lookup_owner_failed', err, { guildId: guild.id, ownerId: member.id });
        return null;
      });

      if (existingRoom) {
        const {
          channel: existingChannel,
          guildStatus: existingGuildStatus,
          channelStatus: existingChannelStatus,
        } = await resolveRoomChannel(existingRoom, {
          action: 'ensure_existing_room',
          ownerId: member.id,
        });
        if (isVoiceLike(existingChannel)) {
          cacheRoom(existingRoom);
          let moveFailed = false;
          await member.voice.setChannel(existingChannel, 'Mevcut odaya tasindi').catch((err) => {
            moveFailed = true;
            logError('private_room_existing_room_move_failed', err, {
              guildId: guild.id,
              ownerId: member.id,
              roomId: existingRoom.id,
              channelId: existingRoom.voiceChannelId,
            });
          });
          if (moveFailed) {
            await sendTransient(
              newState.channel,
              'Mevcut odanıza taşınılamadı. Lütfen tekrar deneyin. ୭ ˚. !!'
            );
            return true;
          }
          await touchRoomActivity(existingRoom, true);
          await syncPanelMessage(existingRoom);
          return true;
        }

        if (existingGuildStatus === 'missing' || existingChannelStatus === 'missing') {
          await privateVoiceRepository.deleteRoomById(existingRoom.id).catch(() => { });
          removeRoomCache(existingRoom);
        } else {
          await sendTransient(
            newState.channel,
            'Mevcut odanıza şu anda erişilemiyor. Lütfen tekrar deneyin. ୭ ˚. !!'
          );
          return true;
        }
      }

      const hubChannel = newState.channel;
      const parentId = config.categoryId || hubChannel.parentId || null;
      const channelName = `${member.displayName || member.user.username} - oda`.slice(0, 100);

      const createdChannel = await guild.channels
        .create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: parentId || undefined,
          bitrate: hubChannel.bitrate || undefined,
          userLimit: 0,
          reason: `private_room_create_${member.id}`,
        })
        .catch((err) => {
          logError('private_room_channel_create_failed', err, { guildId: guild.id, ownerId: member.id });
          return null;
        });

      if (!createdChannel) return true;

      const createdRoom = await privateVoiceRepository
        .createRoom({
          guildId: guild.id,
          ownerId: member.id,
          voiceChannelId: createdChannel.id,
          panelMessageId: null,
          locked: false,
          whitelistMemberIds: [],
          permitRoleIds: [],
          rejectMemberIds: [],
          rejectRoleIds: [],
          lastActiveAt: Date.now(),
        })
        .catch((err) => {
          logError('private_room_db_create_failed', err, { guildId: guild.id, ownerId: member.id, channelId: createdChannel.id });
          return null;
        });

      if (!createdRoom) {
        await createdChannel.delete('private_room_create_rollback').catch(() => { });
        return true;
      }

      cacheRoom(createdRoom);
      let moveFailed = false;
      await member.voice.setChannel(createdChannel, 'Ozel oda olusturuldu').catch((err) => {
        moveFailed = true;
        logError('private_room_initial_move_failed', err, {
          guildId: guild.id,
          ownerId: member.id,
          roomId: createdRoom.id,
          channelId: createdChannel.id,
        });
      });
      if (moveFailed) {
        await deleteRoom(createdRoom, 'create_move_rollback').catch(() => { });
        await sendTransient(
          newState.channel,
          'Oda oluşturuldu ancak taşıma işlemi tamamlanamadı. İşlem geri alındı, lütfen tekrar deneyin. ୭ ˚. !!'
        );
        return true;
      }
      await syncPanelMessage(createdRoom);
      return true;
    } finally {
      releaseOwnerLock(ownerLockKey);
    }
  }

  async function handleVoiceStateUpdate(oldState, newState) {
    if (!newState?.guild && !oldState?.guild) return;
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const oldChannelId = oldState?.channelId || null;
    const newChannelId = newState?.channelId || null;
    if (oldChannelId === newChannelId) return;

    if (newChannelId) {
      await ensureRoomForHubMember(newState).catch((err) => {
        logError('private_room_hub_handler_failed', err, { guildId: guild.id, userId: newState?.id });
      });
    }

    if (newChannelId) {
      const joinedRoom = await getRoomByChannel(guild.id, newChannelId);
      if (joinedRoom) {
        if (!canMemberAccessRoom(joinedRoom, newState.member)) {
          await disconnectMember(newState.member, 'Oda erisim iznin yok');
          return;
        }
        await touchRoomActivity(joinedRoom);
      }
    }

    if (oldChannelId) {
      const leftRoom = await getRoomByChannel(guild.id, oldChannelId);
      if (leftRoom) {
        const { channel: oldChannel } = await resolveChannelReference(guild, oldChannelId, {
          action: 'touch_left_room',
          roomId: leftRoom.id,
        });
        if (isVoiceLike(oldChannel)) {
          await touchRoomActivity(leftRoom, oldChannel.members.size === 0);
        }
      }
    }
  }

  async function handleButtonInteraction(interaction) {
    if (!interaction.customId?.startsWith('pvr:')) return false;

    const [, buttonAction = '', roomToken = ''] = String(interaction.customId || '').split(':');
    if (['lockon', 'lockoff', 'hide', 'show', 'delete'].includes(buttonAction)) {
      await deferInteractionUpdate(interaction);
    } else if (['allow', 'remove'].includes(buttonAction)) {
      await deferInteractionReply(interaction);
    }

    const buttonNeedsRoom = [
      'allow',
      'remove',
      'lockon',
      'lockoff',
      'hide',
      'show',
      'transfer',
      'delete',
      'rename',
      'limit',
    ].includes(buttonAction) && roomToken;
    const roomFromButton = buttonNeedsRoom
      ? buttonAction === 'rename' || buttonAction === 'limit'
        ? await resolveRoomFromCustomIdCached(interaction, `pvr:${buttonAction}:`)
        : await hydrateRoomFromToken(interaction.guildId, roomToken)
      : null;

    if (buttonNeedsRoom && !roomFromButton) {
      await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
      return true;
    }
    if (buttonNeedsRoom && !(await requireCurrentPanel(interaction, roomFromButton))) return true;

    if (interaction.customId.startsWith('pvr:allow:')) {
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, 'pvr:allow:'));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const userPicker = buildWhitelistPicker(room);
      const rolePicker = buildPermitRolePicker(room);
      const hiddenParts = [
        userPicker.hiddenCount > 0 ? `${userPicker.hiddenCount} üye` : null,
        rolePicker.hiddenCount > 0 ? `${rolePicker.hiddenCount} rol` : null,
      ].filter(Boolean);
      const info = hiddenParts.length > 0 ? ` (${hiddenParts.join(' / ')} seçicide görünmüyor)` : '';
      await tryAcknowledge(interaction, {
        content: `İzin Verilenler${info}`,
        components: [userPicker.row, rolePicker.row],
      });
      return true;
    }

    if (interaction.customId.startsWith('pvr:remove:')) {
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, 'pvr:remove:'));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const userPicker = buildRejectUserPicker(room);
      const rolePicker = buildRejectRolePicker(room);
      const hiddenParts = [
        userPicker.hiddenCount > 0 ? `${userPicker.hiddenCount} üye` : null,
        rolePicker.hiddenCount > 0 ? `${rolePicker.hiddenCount} rol` : null,
      ].filter(Boolean);
      const info = hiddenParts.length > 0 ? ` (${hiddenParts.join(' / ')} seçicide görünmüyor)` : '';
      await tryAcknowledge(
        interaction,
        {
          content: `Engellenenler${info}`,
          components: [userPicker.row, rolePicker.row],
        }
      );
      return true;
    }

    if (interaction.customId.startsWith('pvr:lockon:') || interaction.customId.startsWith('pvr:lockoff:')) {
      const mode = interaction.customId.split(':')[1];
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, `pvr:${mode}:`));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const { guild, channel } = await resolveRoomChannel(room);
      if (!guild || !isVoiceLike(channel)) {
        await tryAcknowledge(interaction, 'Oda kanalı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await canManageChannelOverwrites(guild, channel, room))) {
        await tryAcknowledge(interaction, 'Bot bu odanın izinlerini yönetemiyor. ୭ ˚. !!');
        return true;
      }

      const targetLock = mode === 'lockon';
      if (room.locked === targetLock) {
        await tryAcknowledge(interaction, targetLock ? 'Oda zaten kilitli. ୭ ˚. !!' : 'Oda zaten açık. ୭ ˚. !!');
        return true;
      }

      let mutationResult = null;
      try {
        mutationResult = await runWithRoomMutationLock(
          room.id,
          {
            action: targetLock ? 'lock_on' : 'lock_off',
            source: 'button',
            actorId: interaction.user.id,
          },
          async () => {
            const lockedStateSource = getRoomByIdCached(room.id) || room;
            if (Boolean(lockedStateSource.locked) === targetLock) {
              return {
                room: lockedStateSource,
                changed: false,
                persisted: true,
              };
            }
            const lockSnapshot = cloneLockSnapshot(lockedStateSource.lockSnapshot || room.lockSnapshot);
            const permissionRoom = {
              ...lockedStateSource,
              lockSnapshot,
              locked: targetLock,
              captureLockSnapshot: targetLock === true,
            };

            const syncResult = await syncLockedRoomOverwrites(permissionRoom, { persistSnapshot: false });

            const persisted = await privateVoiceRepository
              .updateRoom(room.id, {
                locked: targetLock,
                lockSnapshot: targetLock
                  ? cloneLockSnapshot(syncResult?.snapshot || (getRoomByIdCached(room.id) || permissionRoom).lockSnapshot)
                  : null,
                lastActiveAt: Date.now(),
              })
              .catch((err) => {
                logError('private_room_lock_toggle_failed', err, {
                  guildId: room.guildId,
                  roomId: room.id,
                  targetLock,
                });
                return null;
              });

            if (!persisted) {
              const rollbackRoom = {
                ...room,
                lockSnapshot,
                locked: !targetLock,
              };
              await syncLockedRoomOverwrites(rollbackRoom).catch((err) => {
                logError('private_room_lock_toggle_rollback_failed', err, {
                  guildId: room.guildId,
                  roomId: room.id,
                  targetLock,
                });
              });
              return {
                room: lockedStateSource,
                changed: false,
                persisted: false,
              };
            }

            cacheRoom(persisted);
            await syncPanelMessage(persisted);
            await disconnectUnauthorizedMembers(persisted);
            return {
              room: persisted,
              changed: true,
              persisted: true,
            };
          }
        );
      } catch (err) {
        if (String(err?.code || '') === 'PRIVATE_ROOM_LOCK_TIMEOUT') {
          await tryAcknowledge(interaction, 'Oda işlemi şu anda meşgul. Lütfen tekrar deneyin. ୭ ˚. !!');
          return true;
        }
        throw err;
      }

      if (!mutationResult?.persisted) {
        await tryAcknowledge(interaction, 'Oda kilit durumu kaydedilemedi. ୭ ˚. !!');
        return true;
      }

      const updated = mutationResult.room || room;
      if (!mutationResult.changed) {
        await tryAcknowledge(interaction, targetLock ? 'Oda zaten kilitli. ୭ ˚. !!' : 'Oda zaten açık. ୭ ˚. !!');
        return true;
      }

      await tryAcknowledge(interaction, updated.locked ? 'Oda kilitlendi. ⋆˚࿔' : 'Oda kilidi kaldırıldı. ⋆˚࿔');
      return true;
    }

    if (interaction.customId.startsWith('pvr:hide:') || interaction.customId.startsWith('pvr:show:')) {
      const mode = interaction.customId.split(':')[1];
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, `pvr:${mode}:`));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      let activeRoom = room;
      try {
        const visibilityResult = await runWithRoomMutationLock(
          room.id,
          {
            action: mode === 'show' ? 'visibility_show' : 'visibility_hide',
            source: 'button',
            actorId: interaction.user.id,
          },
          async () => syncRoomVisibilityOverwrites(getRoomByIdCached(room.id) || room, mode)
        );
        activeRoom = visibilityResult?.room || room;
        if (!visibilityResult?.changed) {
          await tryAcknowledge(
            interaction,
            mode === 'show' ? 'Oda zaten görünür. ୭ ˚. !!' : 'Oda zaten gizli. ୭ ˚. !!'
          );
          return true;
        }
      } catch (err) {
        if (String(err?.code || '') === 'PRIVATE_ROOM_LOCK_TIMEOUT') {
          await tryAcknowledge(interaction, 'Oda işlemi şu anda meşgul. Lütfen tekrar deneyin. ୭ ˚. !!');
          return true;
        }
        logError('private_room_visibility_failed', err, {
          guildId: room.guildId,
          roomId: room.id,
          channelId: room.voiceChannelId,
          mode,
        });
        await tryAcknowledge(interaction, 'Görünürlük durumu güncellenemedi. ୭ ˚. !!');
        return true;
      }

      await syncPanelMessage(activeRoom);
      await tryAcknowledge(interaction, mode === 'show' ? 'Oda görünür duruma getirildi. ⋆˚࿔' : 'Oda gizlendi. ⋆˚࿔');
      return true;
    }

    if (interaction.customId.startsWith('pvr:transfer:')) {
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, 'pvr:transfer:'));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const picker = new UserSelectMenuBuilder()
        .setCustomId(`pvru:transfer:${room.id}`)
        .setPlaceholder('Devredilecek üyeyi seç')
        .setMinValues(1)
        .setMaxValues(1);

      await tryAcknowledge(interaction, { content: 'Oda Devri', components: [new ActionRowBuilder().addComponents(picker)] });
      return true;
    }

    if (interaction.customId.startsWith('pvr:delete:')) {
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, 'pvr:delete:'));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      let deleted = false;
      try {
        deleted = await runWithRoomMutationLock(
          room.id,
          {
            action: 'manual_delete',
            source: 'button',
            actorId: interaction.user.id,
          },
          async () => deleteRoom(getRoomByIdCached(room.id) || room, 'manual_button')
        );
      } catch (err) {
        if (String(err?.code || '') === 'PRIVATE_ROOM_LOCK_TIMEOUT') {
          await tryAcknowledge(interaction, 'Oda işlemi şu anda meşgul. Lütfen tekrar deneyin. ୭ ˚. !!');
          return true;
        }
        throw err;
      }
      if (!deleted) {
        await tryAcknowledge(interaction, 'Oda kanalı silinemedi. ୭ ˚. !!');
        return true;
      }
      await tryAcknowledge(interaction, 'Oda silindi. ⋆˚࿔');
      return true;
    }

    if (interaction.customId.startsWith('pvr:rename:')) {
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, 'pvr:rename:'));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const modal = new ModalBuilder().setCustomId(`pvrm:rename:${room.id}`).setTitle('Oda Adı');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Yeni oda adı')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        )
      );
      await interaction.showModal(modal).catch(() => { });
      return true;
    }

    if (interaction.customId.startsWith('pvr:limit:')) {
      const room = roomFromButton || (await resolveRoomFromCustomId(interaction, 'pvr:limit:'));
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const modal = new ModalBuilder().setCustomId(`pvrm:limit:${room.id}`).setTitle('Kullanıcı Limiti');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('limit')
            .setLabel('0-99 (0 = limitsiz)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2)
            .setValue('0')
        )
      );
      await interaction.showModal(modal).catch(() => { });
      return true;
    }

    await tryAcknowledge(interaction, 'Geçersiz panel butonu. ୭ ˚. !!');
    return true;
  }

  async function handleStringSelectInteraction(interaction) {
    if (!interaction.customId?.startsWith('pvrs:')) return false;
    await tryAcknowledge(interaction, 'Bu menü kaldırıldı. Lütfen paneldeki üye seçiciyi kullanın. ୭ ˚. !!');
    return true;
  }

  async function handleUserSelectInteraction(interaction) {
    const permitMode = interaction.customId?.startsWith('pvru:permit:');
    const rejectMode = interaction.customId?.startsWith('pvru:reject:');
    const syncMode = interaction.customId?.startsWith('pvru:sync:');
    const legacyAddMode = interaction.customId?.startsWith('pvru:add:');
    const transferMode = interaction.customId?.startsWith('pvru:transfer:');

    if (!permitMode && !rejectMode && !syncMode && !legacyAddMode && !transferMode) return false;
    await deferInteractionReply(interaction);

    const resolveId = permitMode
      ? 'pvru:permit:'
      : rejectMode
        ? 'pvru:reject:'
        : syncMode
          ? 'pvru:sync:'
          : legacyAddMode
            ? 'pvru:add:'
            : 'pvru:transfer:';
    const room = await resolveRoomFromCustomId(interaction, resolveId);
    if (!room) {
      await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
      return true;
    }
    if (!(await requireOwner(interaction, room))) return true;

    if (transferMode) {
      const targetId = interaction.values?.[0];
      if (!targetId || targetId === room.ownerId) {
        await tryAcknowledge(interaction, 'Geçerli bir yeni sahip seçin. ୭ ˚. !!');
        return true;
      }

      const guild = interaction.guild;
      const roomChannel =
        guild?.channels?.cache?.get(room.voiceChannelId) ||
        (await guild?.channels?.fetch(room.voiceChannelId).catch(() => null));
      if (!isVoiceLike(roomChannel)) {
        await tryAcknowledge(interaction, 'Oda kanalı bulunamadı. ୭ ˚. !!');
        return true;
      }

      const targetMember =
        guild?.members?.cache?.get?.(targetId) ||
        (await guild?.members?.fetch?.(targetId).catch(() => null));
      if (!targetMember) {
        await tryAcknowledge(interaction, 'Hedef üye bulunamadı. ୭ ˚. !!');
        return true;
      }

      if (String(targetMember.voice?.channelId || '') !== String(room.voiceChannelId)) {
        await tryAcknowledge(interaction, 'Sahiplik yalnızca odadaki bir üyeye devredilebilir. ୭ ˚. !!');
        return true;
      }

      const config = await getGuildConfig(room.guildId);
      if (config?.requiredRoleId && !targetMember.roles?.cache?.has?.(config.requiredRoleId)) {
        await tryAcknowledge(interaction, 'Hedef üye gerekli role sahip değil. ୭ ˚. !!');
        return true;
      }

      const ownerLockKey = await waitOwnerLock(room.guildId, targetId, {
        action: 'transfer_owner_target_guard',
        roomId: room.id,
        actorId: interaction.user.id,
      });
      try {
        const targetRoom = await privateVoiceRepository.getRoomByOwner(room.guildId, targetId).catch((err) => {
          logError('private_room_transfer_target_lookup_failed', err, {
            guildId: room.guildId,
            roomId: room.id,
            targetId,
          });
          return null;
        });
        if (targetRoom) {
          await tryAcknowledge(interaction, 'Hedef kişinin zaten aktif bir odası var. ୭ ˚. !!');
          return true;
        }

        const activeRoom =
          (await commitRoomAccessMutation(
            room,
            interaction.user.id,
            {
              action: 'transfer_owner',
              source: 'user_select_transfer',
              actorId: interaction.user.id,
              targetId,
            },
            async (roomState) => ({
              ...roomState,
              ownerId: targetId,
            }),
            [
              {
                ownerId: interaction.user.id,
                actionType: 'OWNER_TRANSFER',
                targetUserId: targetId,
                metadata: { source: 'user_select_transfer', previousOwnerId: room.ownerId },
              },
            ]
          )) || null;
        if (!activeRoom) {
          await tryAcknowledge(interaction, 'Devir işlemi tamamlanamadı. ୭ ˚. !!');
          return true;
        }
        await tryAcknowledge(interaction, `Oda sahipliği <@${targetId}> kullanıcısına devredildi. ⋆˚࿔`);
      } catch (err) {
        logError('private_room_transfer_failed', err, { guildId: room.guildId, roomId: room.id });
        await tryAcknowledge(interaction, 'Devir işlemi tamamlanamadı. ୭ ˚. !!');
      } finally {
        releaseOwnerLock(ownerLockKey);
      }
      return true;
    }

    if (legacyAddMode) {
      const result = await addWhitelistMembers(room, interaction.user.id, interaction.values || [], 'select_add_legacy');
      if (result.failed) {
        await tryAcknowledge(interaction, 'İzin Verilenler güncellenemedi. ୭ ˚. !!');
        return true;
      }
      const lines = [
        'İzin Verilenler güncellendi.',
        `Eklenen üye sayısı: ${result.added.length}`,
        result.exists.length ? `Zaten ekli olanlar: ${result.exists.map((id) => `<@${id}>`).join(', ')}` : null,
        result.ignoredOwner.length ? 'Oda sahibi listede tutulmaz.' : null,
        '⋆˚࿔',
      ].filter(Boolean);
      await tryAcknowledge(interaction, lines.join('\n') || 'Değişiklik yapılmadı. ⋆˚࿔');
      return true;
    }

    const result = rejectMode
      ? await syncRejectMembers(room, interaction.user.id, interaction.values || [], 'select_reject_sync')
      : await syncWhitelistMembers(
        room,
        interaction.user.id,
        interaction.values || [],
        permitMode ? 'select_permit_sync' : 'select_sync'
      );
    if (result.failed) {
      await tryAcknowledge(interaction, `${rejectMode ? 'Engellenenler' : 'İzin Verilenler'} güncellenemedi. ୭ ˚. !!`);
      return true;
    }
    const lines = [
      `${rejectMode ? 'Engellenenler' : 'İzin Verilenler'} güncellendi.`,
      `Eklenen: ${result.added.length} | Kaldırılan: ${result.removed.length}`,
      result.preservedHiddenCount > 0 ? `Görünmeyen ${result.preservedHiddenCount} üye korundu.` : null,
      '⋆˚࿔',
    ];
    await tryAcknowledge(interaction, lines.join('\n'));
    return true;
  }

  async function handleRoleSelectInteraction(interaction) {
    const permitMode = interaction.customId?.startsWith('pvrr:permit:');
    const rejectMode = interaction.customId?.startsWith('pvrr:reject:');
    if (!permitMode && !rejectMode) return false;
    await deferInteractionReply(interaction);

    const room = await resolveRoomFromCustomId(interaction, permitMode ? 'pvrr:permit:' : 'pvrr:reject:');
    if (!room) {
      await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
      return true;
    }
    if (!(await requireOwner(interaction, room))) return true;

    const result = permitMode
      ? await syncPermitRoles(room, interaction.user.id, interaction.values || [], 'select_permit_role_sync')
      : await syncRejectRoles(room, interaction.user.id, interaction.values || [], 'select_reject_role_sync');
    if (result.failed) {
      await tryAcknowledge(interaction, `${permitMode ? 'İzin verilen roller' : 'Engellenen roller'} güncellenemedi. ୭ ˚. !!`);
      return true;
    }
    const lines = [
      `${permitMode ? 'İzin verilen roller' : 'Engellenen roller'} güncellendi.`,
      `Eklenen: ${result.added.length} | Kaldırılan: ${result.removed.length}`,
      result.preservedHiddenCount > 0 ? `Görünmeyen ${result.preservedHiddenCount} rol korundu.` : null,
      '⋆˚࿔',
    ];
    await tryAcknowledge(interaction, lines.join('\n'));
    return true;
  }

  async function handleModalInteraction(interaction) {
    if (!interaction.customId?.startsWith('pvrm:')) return false;
    await deferInteractionReply(interaction);

    if (interaction.customId.startsWith('pvrm:rename:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvrm:rename:');
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const nextName = String(interaction.fields.getTextInputValue('name') || '').trim().slice(0, 100);
      if (!nextName) {
        await tryAcknowledge(interaction, 'Oda adı boş olamaz. ୭ ˚. !!');
        return true;
      }

      let activeRoom = room;
      try {
        activeRoom = await runWithRoomMutationLock(
          room.id,
          {
            action: 'rename',
            source: 'modal',
            actorId: interaction.user.id,
          },
          async () => {
            const activeState = getRoomByIdCached(room.id) || room;
            const { channel } = await resolveRoomChannel(activeState, {
              action: 'rename',
              actorId: interaction.user.id,
            });
            if (!isVoiceLike(channel)) return null;

            let renameFailed = false;
            await channel.setName(nextName, `private_room_rename_${interaction.user.id}`).catch((err) => {
              renameFailed = true;
              logError('private_room_rename_failed', err, {
                guildId: activeState.guildId,
                roomId: activeState.id,
                channelId: activeState.voiceChannelId,
              });
            });
            if (renameFailed) return null;

            const updated =
              (await privateVoiceRepository.updateRoom(activeState.id, { lastActiveAt: Date.now() }).catch(() => null)) || activeState;
            if (updated?.id) cacheRoom(updated);
            await syncPanelMessage(updated);
            return updated;
          }
        );
      } catch (err) {
        if (String(err?.code || '') === 'PRIVATE_ROOM_LOCK_TIMEOUT') {
          await tryAcknowledge(interaction, 'Oda işlemi şu anda meşgul. Lütfen tekrar deneyin. ୭ ˚. !!');
          return true;
        }
        throw err;
      }
      if (!activeRoom) {
        await tryAcknowledge(interaction, 'Oda adı güncellenemedi. ୭ ˚. !!');
        return true;
      }

      await tryAcknowledge(interaction, 'Oda adı güncellendi. ⋆˚࿔');
      return true;
    }

    if (interaction.customId.startsWith('pvrm:limit:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvrm:limit:');
      if (!room) {
        await tryAcknowledge(interaction, 'Oda kaydı bulunamadı. ୭ ˚. !!');
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const raw = String(interaction.fields.getTextInputValue('limit') || '').trim();
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await tryAcknowledge(interaction, '0-99 arasında bir değer girin. ୭ ˚. !!');
        return true;
      }

      let activeRoom = room;
      try {
        activeRoom = await runWithRoomMutationLock(
          room.id,
          {
            action: 'limit',
            source: 'modal',
            actorId: interaction.user.id,
          },
          async () => {
            const activeState = getRoomByIdCached(room.id) || room;
            const { channel } = await resolveRoomChannel(activeState, {
              action: 'limit',
              actorId: interaction.user.id,
            });
            if (!isVoiceLike(channel)) return null;

            let limitFailed = false;
            await channel.setUserLimit(limit, `private_room_limit_${interaction.user.id}`).catch((err) => {
              limitFailed = true;
              logError('private_room_limit_failed', err, {
                guildId: activeState.guildId,
                roomId: activeState.id,
                channelId: activeState.voiceChannelId,
                limit,
              });
            });
            if (limitFailed) return null;

            const updated =
              (await privateVoiceRepository.updateRoom(activeState.id, { lastActiveAt: Date.now() }).catch(() => null)) || activeState;
            if (updated?.id) cacheRoom(updated);
            await syncPanelMessage(updated);
            return updated;
          }
        );
      } catch (err) {
        if (String(err?.code || '') === 'PRIVATE_ROOM_LOCK_TIMEOUT') {
          await tryAcknowledge(interaction, 'Oda işlemi şu anda meşgul. Lütfen tekrar deneyin. ୭ ˚. !!');
          return true;
        }
        throw err;
      }
      if (!activeRoom) {
        await tryAcknowledge(interaction, 'Limit güncellenemedi. ୭ ˚. !!');
        return true;
      }

      await tryAcknowledge(interaction, `Limit güncellendi: ${limit}. ⋆˚࿔`);
      return true;
    }

    await tryAcknowledge(interaction, 'Geçersiz modal. ୭ ˚. !!');
    return true;
  }

  async function handleInteraction(interaction) {
    if (!interaction?.inGuild?.() || !interaction.guildId) return;

    try {
      let handled = false;
      if (interaction.isButton()) handled = await handleButtonInteraction(interaction);
      else if (interaction.isStringSelectMenu()) handled = await handleStringSelectInteraction(interaction);
      else if (interaction.isUserSelectMenu()) handled = await handleUserSelectInteraction(interaction);
      else if (interaction.isRoleSelectMenu?.()) handled = await handleRoleSelectInteraction(interaction);
      else if (interaction.isModalSubmit()) handled = await handleModalInteraction(interaction);

      if (!handled && isPanelMessageInteraction(interaction)) {
        await tryAcknowledge(interaction, 'Bu panel güncel değil. Odaya yeniden girerek paneli yenileyin. ୭ ˚. !!');
      }
    } catch (err) {
      logError('private_room_interaction_failed', err, {
        guildId: interaction.guildId,
        customId: interaction.customId,
        type: interaction.type,
      });
      if (interaction.isRepliable?.()) {
        await tryAcknowledge(interaction, 'İşlem sırasında bir hata oluştu. ୭ ˚. !!');
      }
    }
  }

  async function handleMessageCreate(message) {
    return false;
  }

  async function bootstrap() {
    const rooms = await privateVoiceRepository.listAllRooms().catch((err) => {
      logError('private_room_bootstrap_list_failed', err);
      return [];
    });

    let loaded = 0;
    for (const room of rooms) {
      const { guild, channel, guildStatus, channelStatus } = await resolveRoomChannel(room, {
        action: 'bootstrap',
      });
      if (guildStatus === 'missing' || channelStatus === 'missing') {
        await privateVoiceRepository.deleteRoomById(room.id).catch(() => { });
        continue;
      }

      cacheRoom(room);
      loaded += 1;
      if (guildStatus === 'unavailable' || channelStatus === 'unavailable' || !isVoiceLike(channel)) {
        continue;
      }
      if (room.visibilitySnapshot) {
        await syncRoomVisibilityOverwrites(room, 'hide').catch((err) => {
          logError('private_room_bootstrap_visibility_sync_failed', err, {
            guildId: room.guildId,
            roomId: room.id,
            channelId: room.voiceChannelId,
          });
        });
      }
      await syncPanelMessage(room).catch((err) => {
        logError('private_room_bootstrap_panel_sync_failed', err, {
          guildId: room.guildId,
          roomId: room.id,
          channelId: room.voiceChannelId,
        });
      });
      if (roomNeedsManagedAccess(room) || room.lockSnapshot) {
        await syncLockedRoomOverwrites({
          ...room,
          captureLockSnapshot: room.lockSnapshot ? false : 'fallback',
        }).catch((err) => {
          logError('private_room_bootstrap_lock_sync_failed', err, {
            guildId: room.guildId,
            roomId: room.id,
            channelId: room.voiceChannelId,
          });
        });
      }
      if (roomNeedsRuntimeEnforcement(room)) {
        await disconnectUnauthorizedMembers(room).catch((err) => {
          logError('private_room_bootstrap_disconnect_failed', err, {
            guildId: room.guildId,
            roomId: room.id,
            channelId: room.voiceChannelId,
          });
        });
      }
    }

    await runInactivityCleanup().catch((err) => logError('private_room_cleanup_bootstrap_failed', err));
    if (!cleanupTimer) {
      cleanupTimer = setInterval(() => {
        runInactivityCleanup().catch((err) => logError('private_room_cleanup_tick_failed', err));
      }, CLEANUP_INTERVAL_MS);
      cleanupTimer.unref?.();
    }

    return loaded;
  }

  function shutdown() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    roomWhitelistLock.clear();
    roomOwnerLock.clear();
    lockOverwriteStateByRoom.clear();
    roomsById.clear();
    roomIdByChannel.clear();
    configCache.clear();
    logSystem('Ozel oda servisi durduruldu', 'INFO');
  }

  return {
    bootstrap,
    shutdown,
    invalidateConfig,
    handleVoiceStateUpdate,
    handleInteraction,
    handleMessageCreate,
  };
}

module.exports = { createPrivateRoomService };
