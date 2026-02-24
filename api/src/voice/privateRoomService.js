const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const privateVoiceRepository = require('../infrastructure/repositories/privateVoiceRepository');

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CONFIG_TTL_MS = 60 * 1000;
const ACTIVITY_TOUCH_THROTTLE_MS = 15 * 1000;
const TRANSIENT_DELETE_MS = 8000;

const EMOJI_SPEAKER = '\uD83D\uDD0A';
const EMOJI_TAG = '\uD83C\uDFF7\uFE0F';
const EMOJI_GROUP = '\uD83D\uDC65';
const EMOJI_PLUS = '\u2795';
const EMOJI_LOCK = '\uD83D\uDD12';
const EMOJI_UNLOCK = '\uD83D\uDD13';
const EMOJI_OK = '\u2705';
const EMOJI_FAIL = '\u274C';
const EMOJI_WARN = '\u26A0\uFE0F';

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
    message.delete().catch(() => {});
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

function createPrivateRoomService({ client, logSystem = () => {}, logError = () => {} }) {
  const roomsById = new Map();
  const roomIdByChannel = new Map();
  const configCache = new Map();
  // Deprecated path note: mention-based whitelist flow is kept for backward compatibility.
  // Current primary flow is UserSelect-based whitelist sync (pvru:sync:*).
  const mentionModeByOwner = new Map();
  const roomWhitelistLock = new Set();
  const lastActivityWriteAt = new Map();

  let cleanupTimer = null;

  function cacheRoom(room) {
    if (!room?.id || !room.voiceChannelId) return;
    const key = roomKey(room.id);
    roomsById.set(key, {
      ...room,
      whitelistMemberIds: uniqIds(room.whitelistMemberIds),
      locked: Boolean(room.locked),
      lastActiveAt: Number(room.lastActiveAt || Date.now()),
    });
    roomIdByChannel.set(room.voiceChannelId, key);
  }

  function removeRoomCache(room) {
    if (!room) return;
    const key = roomKey(room.id);
    roomsById.delete(key);
    if (room.voiceChannelId) roomIdByChannel.delete(room.voiceChannelId);
    lastActivityWriteAt.delete(key);
    roomWhitelistLock.delete(key);
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

  function canEnterLockedRoom(room, userId) {
    if (!room?.locked) return true;
    if (!userId) return false;
    if (room.ownerId === userId) return true;
    return (room.whitelistMemberIds || []).includes(userId);
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

  function panelEmbed(room) {
    const whitelist = uniqIds(room.whitelistMemberIds || []).filter((id) => id !== room.ownerId);
    const preview = whitelist.slice(0, 16).map((id) => `<@${id}>`).join(', ');
    const more = whitelist.length > 16 ? ` (+${whitelist.length - 16})` : '';
    const allowedLine = whitelist.length ? `${preview}${more}` : 'Yok';

    return new EmbedBuilder()
      .setTitle(`${EMOJI_SPEAKER} Oda Kontrol`)
      .setDescription(`Sahip: <@${room.ownerId}>\nIzin verilen Uyeler: ${allowedLine}`)
      .setColor(room.locked ? 0xef4444 : 0x10b981)
      .setTimestamp();
  }

  function panelComponents(room) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pvr:rename:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(EMOJI_TAG),
        new ButtonBuilder().setCustomId(`pvr:whitelist:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(EMOJI_GROUP),
        new ButtonBuilder().setCustomId(`pvr:limit:${room.id}`).setStyle(ButtonStyle.Secondary).setEmoji(EMOJI_PLUS),
        new ButtonBuilder()
          .setCustomId(`pvr:lock:${room.id}`)
          .setStyle(room.locked ? ButtonStyle.Danger : ButtonStyle.Success)
          .setEmoji(room.locked ? EMOJI_LOCK : EMOJI_UNLOCK)
      ),
    ];
  }

  async function syncPanelMessage(room) {
    const guild = client.guilds.cache.get(room.guildId) || (await client.guilds.fetch(room.guildId).catch(() => null));
    if (!guild) return;

    const voiceChannel =
      guild.channels.cache.get(room.voiceChannelId) || (await guild.channels.fetch(room.voiceChannelId).catch(() => null));
    if (!voiceChannel || !canUseVoiceChatText(voiceChannel)) return;

    const payload = {
      embeds: [panelEmbed(room)],
      components: panelComponents(room),
      allowedMentions: { parse: [] },
    };

    let message = null;
    if (room.panelMessageId) {
      message = await voiceChannel.messages.fetch(room.panelMessageId).catch(() => null);
    }

    if (message) {
      await message.edit(payload).catch((err) => {
        logError('private_room_panel_edit_failed', err, {
          guildId: room.guildId,
          channelId: room.voiceChannelId,
          panelMessageId: room.panelMessageId,
        });
      });
      return;
    }

    const sent = await voiceChannel.send(payload).catch((err) => {
      logError('private_room_panel_send_failed', err, {
        guildId: room.guildId,
        channelId: room.voiceChannelId,
      });
      return null;
    });
    if (!sent) return;

    const updated = await privateVoiceRepository.updateRoom(room.id, { panelMessageId: sent.id }).catch(() => null);
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
    if (!room?.locked) return;
    const guild = client.guilds.cache.get(room.guildId) || (await client.guilds.fetch(room.guildId).catch(() => null));
    if (!guild) return;

    const channel = guild.channels.cache.get(room.voiceChannelId) || (await guild.channels.fetch(room.voiceChannelId).catch(() => null));
    if (!isVoiceLike(channel)) return;

    const members = [...channel.members.values()];
    await Promise.all(
      members.map(async (member) => {
        if (canEnterLockedRoom(room, member.id)) return;
        await disconnectMember(member, 'Kilitli odaya giris izni yok');
      })
    );
  }

  async function deleteRoom(room, reason = 'cleanup') {
    if (!room) return;
    const guild = client.guilds.cache.get(room.guildId) || (await client.guilds.fetch(room.guildId).catch(() => null));
    const channel = guild
      ? guild.channels.cache.get(room.voiceChannelId) || (await guild.channels.fetch(room.voiceChannelId).catch(() => null))
      : null;

    if (channel && isVoiceLike(channel)) {
      await channel.delete(`private_room_${reason}`).catch((err) => {
        logError('private_room_channel_delete_failed', err, {
          roomId: room.id,
          guildId: room.guildId,
          channelId: room.voiceChannelId,
          reason,
        });
      });
    }

    await privateVoiceRepository.deleteRoomById(room.id).catch((err) => {
      logError('private_room_db_delete_failed', err, { roomId: room.id, guildId: room.guildId, reason });
    });
    removeRoomCache(room);
  }

  async function runInactivityCleanup() {
    const now = Date.now();
    for (const room of roomsById.values()) {
      const guild = client.guilds.cache.get(room.guildId) || (await client.guilds.fetch(room.guildId).catch(() => null));
      const channel = guild
        ? guild.channels.cache.get(room.voiceChannelId) || (await guild.channels.fetch(room.voiceChannelId).catch(() => null))
        : null;

      if (!channel || !isVoiceLike(channel)) {
        await privateVoiceRepository.deleteRoomById(room.id).catch(() => {});
        removeRoomCache(room);
        continue;
      }

      const empty = channel.members.size === 0;
      if (empty && now - Number(room.lastActiveAt || 0) >= THREE_DAYS_MS) {
        await deleteRoom(room, 'inactive_3d');
      }
    }

    for (const [key, session] of mentionModeByOwner.entries()) {
      if (!session || session.expiresAt <= now) mentionModeByOwner.delete(key);
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
    if (interaction.replied || interaction.deferred) return interaction.followUp(merged).catch(() => null);
    return interaction.reply(merged).catch(() => null);
  }

  async function requireOwner(interaction, room) {
    if (isRoomOwner(room, interaction.user.id)) return true;
    await tryAcknowledge(interaction, `${EMOJI_FAIL} Yetkin yok`);
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

    const rooms = await privateVoiceRepository.listAllRooms().catch(() => []);
    const byId = rooms.find((room) => room.guildId === guildId && String(room.id) === String(token));
    if (byId) {
      cacheRoom(byId);
      return byId;
    }

    return null;
  }

  async function resolveRoomFromCustomId(interaction, prefix) {
    const token = parseRoomId(interaction.customId, prefix);
    if (!token) return null;
    return hydrateRoomFromToken(interaction.guildId, token);
  }

  async function waitWhitelistLock(roomId) {
    const key = roomKey(roomId);
    const startedAt = Date.now();
    while (roomWhitelistLock.has(key)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (Date.now() - startedAt > 5000) break;
    }
    roomWhitelistLock.add(key);
  }

  function releaseWhitelistLock(roomId) {
    roomWhitelistLock.delete(roomKey(roomId));
  }

  async function addWhitelistMembers(room, actorId, userIds, source = 'select_add') {
    await waitWhitelistLock(room.id);
    try {
      const current = new Set(uniqIds(room.whitelistMemberIds || []));
      const added = [];
      const exists = [];
      const ignoredOwner = [];

      for (const userId of uniqIds(userIds)) {
        if (userId === room.ownerId) {
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

      let activeRoom = room;
      if (added.length > 0) {
        const updated = await privateVoiceRepository.updateRoom(room.id, {
          whitelistMemberIds: [...current],
          lastActiveAt: Date.now(),
        });
        if (updated) {
          cacheRoom(updated);
          activeRoom = updated;
        }

        await Promise.all(
          added.map((targetUserId) =>
            privateVoiceRepository
              .insertRoomLog({
                roomId: room.id,
                guildId: room.guildId,
                ownerId: actorId,
                actionType: 'WHITELIST_ADD',
                targetUserId,
                metadata: { source },
              })
              .catch(() => {})
          )
        );

        await syncPanelMessage(activeRoom);
        await disconnectUnauthorizedMembers(activeRoom);
      }

      return { room: activeRoom, added, exists, ignoredOwner };
    } finally {
      releaseWhitelistLock(room.id);
    }
  }

  async function removeWhitelistMembers(room, actorId, userIds, source = 'select_remove') {
    await waitWhitelistLock(room.id);
    try {
      const current = new Set(uniqIds(room.whitelistMemberIds || []));
      const removed = [];
      const missing = [];
      const ignoredOwner = [];

      for (const userId of uniqIds(userIds)) {
        if (userId === room.ownerId) {
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

      let activeRoom = room;
      if (removed.length > 0) {
        const updated = await privateVoiceRepository.updateRoom(room.id, {
          whitelistMemberIds: [...current],
          lastActiveAt: Date.now(),
        });
        if (updated) {
          cacheRoom(updated);
          activeRoom = updated;
        }

        await Promise.all(
          removed.map((targetUserId) =>
            privateVoiceRepository
              .insertRoomLog({
                roomId: room.id,
                guildId: room.guildId,
                ownerId: actorId,
                actionType: 'WHITELIST_REMOVE',
                targetUserId,
                metadata: { source },
              })
              .catch(() => {})
          )
        );

        await syncPanelMessage(activeRoom);
        await disconnectUnauthorizedMembers(activeRoom);
      }

      return { room: activeRoom, removed, missing, ignoredOwner };
    } finally {
      releaseWhitelistLock(room.id);
    }
  }

  function getWhitelistWithoutOwner(room) {
    return uniqIds(room.whitelistMemberIds || []).filter((id) => id !== room.ownerId);
  }

  function buildWhitelistPicker(room) {
    const current = getWhitelistWithoutOwner(room);
    const visible = current.slice(0, 25);

    const picker = new UserSelectMenuBuilder()
      .setCustomId(`pvru:sync:${room.id}`)
      .setPlaceholder('Whitelist uyelerini sec')
      .setMinValues(0)
      .setMaxValues(25);

    if (visible.length > 0) {
      picker.setDefaultUsers(...visible);
    }

    return {
      row: new ActionRowBuilder().addComponents(picker),
      hiddenCount: Math.max(0, current.length - visible.length),
    };
  }

  async function syncWhitelistMembers(room, actorId, selectedUserIds, source = 'select_sync') {
    await waitWhitelistLock(room.id);
    try {
      const desired = uniqIds(selectedUserIds || []).filter((id) => id !== room.ownerId);
      const current = getWhitelistWithoutOwner(room);

      const currentSet = new Set(current);
      const desiredSet = new Set(desired);

      const added = desired.filter((id) => !currentSet.has(id));
      const removed = current.filter((id) => !desiredSet.has(id));

      if (added.length === 0 && removed.length === 0) {
        return { room, added, removed };
      }

      const updated = await privateVoiceRepository.updateRoom(room.id, {
        whitelistMemberIds: desired,
        lastActiveAt: Date.now(),
      });
      const activeRoom = updated || { ...room, whitelistMemberIds: desired };
      if (updated) cacheRoom(updated);

      await Promise.all([
        ...added.map((targetUserId) =>
          privateVoiceRepository
            .insertRoomLog({
              roomId: room.id,
              guildId: room.guildId,
              ownerId: actorId,
              actionType: 'WHITELIST_ADD',
              targetUserId,
              metadata: { source },
            })
            .catch(() => {})
        ),
        ...removed.map((targetUserId) =>
          privateVoiceRepository
            .insertRoomLog({
              roomId: room.id,
              guildId: room.guildId,
              ownerId: actorId,
              actionType: 'WHITELIST_REMOVE',
              targetUserId,
              metadata: { source },
            })
            .catch(() => {})
        ),
      ]);

      await syncPanelMessage(activeRoom);
      await disconnectUnauthorizedMembers(activeRoom);
      return { room: activeRoom, added, removed };
    } finally {
      releaseWhitelistLock(room.id);
    }
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
        `${EMOJI_FAIL} <@${member.id}> oda acabilmek icin <@&${config.requiredRoleId}> rolune sahip olmalisin.`
      );
      return true;
    }

    const existingRoom = await privateVoiceRepository.getRoomByOwner(guild.id, member.id).catch((err) => {
      logError('private_room_lookup_owner_failed', err, { guildId: guild.id, ownerId: member.id });
      return null;
    });

    if (existingRoom) {
      const existingChannel =
        guild.channels.cache.get(existingRoom.voiceChannelId) ||
        (await guild.channels.fetch(existingRoom.voiceChannelId).catch(() => null));
      if (isVoiceLike(existingChannel)) {
        cacheRoom(existingRoom);
        await member.voice.setChannel(existingChannel, 'Mevcut odaya tasindi').catch(() => null);
        await touchRoomActivity(existingRoom, true);
        await syncPanelMessage(existingRoom);
        return true;
      }

      await privateVoiceRepository.deleteRoomById(existingRoom.id).catch(() => {});
      removeRoomCache(existingRoom);
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
        lastActiveAt: Date.now(),
      })
      .catch((err) => {
        logError('private_room_db_create_failed', err, { guildId: guild.id, ownerId: member.id, channelId: createdChannel.id });
        return null;
      });

    if (!createdRoom) {
      await createdChannel.delete('private_room_create_rollback').catch(() => {});
      return true;
    }

    cacheRoom(createdRoom);
    await member.voice.setChannel(createdChannel, 'Ozel oda olusturuldu').catch(() => null);
    await syncPanelMessage(createdRoom);
    return true;
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
        if (!canEnterLockedRoom(joinedRoom, newState.id)) {
          await disconnectMember(newState.member, 'Kilitli oda');
          return;
        }
        await touchRoomActivity(joinedRoom);
      }
    }

    if (oldChannelId) {
      const leftRoom = await getRoomByChannel(guild.id, oldChannelId);
      if (leftRoom) {
        const oldChannel = guild.channels.cache.get(oldChannelId) || (await guild.channels.fetch(oldChannelId).catch(() => null));
        if (isVoiceLike(oldChannel) && oldChannel.members.size > 0) {
          await touchRoomActivity(leftRoom);
        }
      }
    }
  }

  async function handleButtonInteraction(interaction) {
    if (!interaction.customId?.startsWith('pvr:')) return false;

    if (interaction.customId.startsWith('pvr:whitelist:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvr:whitelist:');
      if (!room) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const picker = buildWhitelistPicker(room);
      const info = picker.hiddenCount > 0 ? ` (${picker.hiddenCount} uye limit disi)` : '';
      await tryAcknowledge(interaction, { content: `Whitelist${info}`, components: [picker.row] });
      return true;
    }

    if (interaction.customId.startsWith('pvr:lock:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvr:lock:');
      if (!room) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const updated = await privateVoiceRepository
        .updateRoom(room.id, { locked: !room.locked, lastActiveAt: Date.now() })
        .catch((err) => {
          logError('private_room_lock_toggle_failed', err, { guildId: room.guildId, roomId: room.id });
          return null;
        });
      if (updated) cacheRoom(updated);
      const active = updated || { ...room, locked: !room.locked };
      await syncPanelMessage(active);
      await disconnectUnauthorizedMembers(active);
      await tryAcknowledge(interaction, active.locked ? `${EMOJI_LOCK} Oda kilitlendi` : `${EMOJI_UNLOCK} Oda acildi`);
      return true;
    }

    if (interaction.customId.startsWith('pvr:rename:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvr:rename:');
      if (!room) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const modal = new ModalBuilder().setCustomId(`pvrm:rename:${room.id}`).setTitle('Oda Adi');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Yeni oda adi')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        )
      );
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (interaction.customId.startsWith('pvr:limit:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvr:limit:');
      if (!room) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const modal = new ModalBuilder().setCustomId(`pvrm:limit:${room.id}`).setTitle('Kullanici Limiti');
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
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    await tryAcknowledge(interaction, `${EMOJI_FAIL} Gecersiz panel butonu`);
    return true;
  }

  async function handleStringSelectInteraction(interaction) {
    if (!interaction.customId?.startsWith('pvrs:')) return false;
    await tryAcknowledge(interaction, `${EMOJI_WARN} Bu menu kaldirildi. Sadece \uD83D\uDC65 butonundaki uye seciciyi kullan.`);
    return true;
  }

  async function handleUserSelectInteraction(interaction) {
    const syncMode = interaction.customId?.startsWith('pvru:sync:');
    const legacyAddMode = interaction.customId?.startsWith('pvru:add:');
    if (!syncMode && !legacyAddMode) return false;

    const room = await resolveRoomFromCustomId(interaction, syncMode ? 'pvru:sync:' : 'pvru:add:');
    if (!room) {
      await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
      return true;
    }
    if (!(await requireOwner(interaction, room))) return true;

    if (!syncMode) {
      const result = await addWhitelistMembers(room, interaction.user.id, interaction.values || [], 'select_add_legacy');
      const lines = [
        `${EMOJI_OK} ${result.added.length} kisi eklendi`,
        result.exists.length ? `${EMOJI_WARN} Zaten vardi: ${result.exists.map((id) => `<@${id}>`).join(', ')}` : null,
        result.ignoredOwner.length ? `${EMOJI_WARN} Owner listeden ayri tutulur` : null,
      ].filter(Boolean);
      await tryAcknowledge(interaction, lines.join('\n') || 'Degisiklik yok');
      return true;
    }

    const result = await syncWhitelistMembers(room, interaction.user.id, interaction.values || [], 'select_sync');
    const lines = [
      `${EMOJI_OK} Whitelist guncellendi`,
      `+${result.added.length} / -${result.removed.length}`,
    ];
    await tryAcknowledge(interaction, lines.join('\n'));
    return true;
  }

  async function handleModalInteraction(interaction) {
    if (!interaction.customId?.startsWith('pvrm:')) return false;

    if (interaction.customId.startsWith('pvrm:rename:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvrm:rename:');
      if (!room) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const nextName = String(interaction.fields.getTextInputValue('name') || '').trim().slice(0, 100);
      if (!nextName) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda adi bos olamaz`);
        return true;
      }

      const guild = interaction.guild;
      const channel = guild?.channels?.cache?.get(room.voiceChannelId) || (await guild?.channels?.fetch(room.voiceChannelId).catch(() => null));
      if (!isVoiceLike(channel)) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kanali bulunamadi`);
        return true;
      }

      await channel.setName(nextName, `private_room_rename_${interaction.user.id}`).catch((err) => {
        logError('private_room_rename_failed', err, { guildId: room.guildId, channelId: room.voiceChannelId });
      });

      await privateVoiceRepository.updateRoom(room.id, { lastActiveAt: Date.now() }).catch(() => {});
      await syncPanelMessage(room);
      await tryAcknowledge(interaction, `${EMOJI_OK} Oda adi guncellendi`);
      return true;
    }

    if (interaction.customId.startsWith('pvrm:limit:')) {
      const room = await resolveRoomFromCustomId(interaction, 'pvrm:limit:');
      if (!room) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kaydi bulunamadi`);
        return true;
      }
      if (!(await requireOwner(interaction, room))) return true;

      const raw = String(interaction.fields.getTextInputValue('limit') || '').trim();
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} 0-99 arasi deger gir`);
        return true;
      }

      const guild = interaction.guild;
      const channel = guild?.channels?.cache?.get(room.voiceChannelId) || (await guild?.channels?.fetch(room.voiceChannelId).catch(() => null));
      if (!isVoiceLike(channel)) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Oda kanali bulunamadi`);
        return true;
      }

      await channel.setUserLimit(limit, `private_room_limit_${interaction.user.id}`).catch((err) => {
        logError('private_room_limit_failed', err, { guildId: room.guildId, channelId: room.voiceChannelId, limit });
      });

      await privateVoiceRepository.updateRoom(room.id, { lastActiveAt: Date.now() }).catch(() => {});
      await tryAcknowledge(interaction, `${EMOJI_OK} Limit guncellendi: ${limit}`);
      return true;
    }

    await tryAcknowledge(interaction, `${EMOJI_FAIL} Gecersiz modal`);
    return true;
  }

  async function handleInteraction(interaction) {
    if (!interaction?.inGuild?.() || !interaction.guildId) return;

    try {
      let handled = false;
      if (interaction.isButton()) handled = await handleButtonInteraction(interaction);
      else if (interaction.isStringSelectMenu()) handled = await handleStringSelectInteraction(interaction);
      else if (interaction.isUserSelectMenu()) handled = await handleUserSelectInteraction(interaction);
      else if (interaction.isModalSubmit()) handled = await handleModalInteraction(interaction);

      if (!handled && isPanelMessageInteraction(interaction)) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Bu panel guncel degil. Odaya yeniden girerek paneli yenile.`);
      }
    } catch (err) {
      logError('private_room_interaction_failed', err, {
        guildId: interaction.guildId,
        customId: interaction.customId,
        type: interaction.type,
      });
      if (interaction.isRepliable?.()) {
        await tryAcknowledge(interaction, `${EMOJI_FAIL} Islem sirasinda hata olustu`);
      }
    }
  }

  async function handleMessageCreate(message) {
    if (!message?.guild || !message?.author || message.author.bot) return false;

    const key = `${message.guild.id}:${message.author.id}`;
    const session = mentionModeByOwner.get(key);
    if (!session) return false;

    if (Date.now() > session.expiresAt) {
      mentionModeByOwner.delete(key);
      await sendTransient(message.channel, '\u23F1\uFE0F Whitelist @ modu sure asimina ugradi.');
      return false;
    }

    if (message.channelId !== session.channelId) return false;

    const room = await hydrateRoomFromToken(message.guild.id, session.roomId);
    if (!room) {
      mentionModeByOwner.delete(key);
      await sendTransient(message.channel, `${EMOJI_FAIL} Oda kaydi bulunamadi.`);
      return true;
    }

    if (!isRoomOwner(room, message.author.id)) {
      mentionModeByOwner.delete(key);
      await sendTransient(message.channel, `${EMOJI_FAIL} Sadece owner islem yapabilir.`);
      return true;
    }

    const content = String(message.content || '').trim();
    if (!content) return true;

    if (/^iptal$/i.test(content)) {
      mentionModeByOwner.delete(key);
      await sendTransient(message.channel, `${EMOJI_OK} Whitelist islemi iptal edildi.`);
      await safeDeleteMessage(message, 1500);
      return true;
    }

    const sign = content[0];
    const mentioned = uniqIds([...message.mentions.users.keys()]);
    if ((sign !== '+' && sign !== '-') || mentioned.length === 0) {
      await sendTransient(message.channel, `${EMOJI_WARN} Format: + @uye1 @uye2 veya - @uye1 @uye2`);
      return true;
    }

    let response = 'Degisiklik yok';
    if (sign === '+') {
      const result = await addWhitelistMembers(room, message.author.id, mentioned, 'mention_add');
      response = [
        `${EMOJI_OK} Eklendi: ${result.added.map((id) => `<@${id}>`).join(', ') || '-'}`,
        result.exists.length ? `${EMOJI_WARN} Zaten vardi: ${result.exists.map((id) => `<@${id}>`).join(', ')}` : null,
        result.ignoredOwner.length ? `${EMOJI_WARN} Owner ekleme/cikarma disi` : null,
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      const result = await removeWhitelistMembers(room, message.author.id, mentioned, 'mention_remove');
      response = [
        `${EMOJI_OK} Cikarildi: ${result.removed.map((id) => `<@${id}>`).join(', ') || '-'}`,
        result.missing.length ? `${EMOJI_WARN} Zaten yoktu: ${result.missing.map((id) => `<@${id}>`).join(', ')}` : null,
        result.ignoredOwner.length ? `${EMOJI_WARN} Owner whitelistten cikarilamaz` : null,
      ]
        .filter(Boolean)
        .join('\n');
    }

    mentionModeByOwner.delete(key);
    await sendTransient(message.channel, response);
    await safeDeleteMessage(message, 1500);
    return true;
  }

  async function bootstrap() {
    const rooms = await privateVoiceRepository.listAllRooms().catch((err) => {
      logError('private_room_bootstrap_list_failed', err);
      return [];
    });

    let loaded = 0;
    for (const room of rooms) {
      const guild = client.guilds.cache.get(room.guildId) || (await client.guilds.fetch(room.guildId).catch(() => null));
      if (!guild) {
        await privateVoiceRepository.deleteRoomById(room.id).catch(() => {});
        continue;
      }
      const channel = guild.channels.cache.get(room.voiceChannelId) || (await guild.channels.fetch(room.voiceChannelId).catch(() => null));
      if (!isVoiceLike(channel)) {
        await privateVoiceRepository.deleteRoomById(room.id).catch(() => {});
        continue;
      }
      cacheRoom(room);
      loaded += 1;
      if (!room.panelMessageId) await syncPanelMessage(room).catch(() => {});
      if (room.locked) await disconnectUnauthorizedMembers(room).catch(() => {});
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
    mentionModeByOwner.clear();
    roomWhitelistLock.clear();
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
