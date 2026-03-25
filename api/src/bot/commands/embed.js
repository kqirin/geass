'use strict';

const { randomBytes } = require('node:crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const BTN_OPEN = 'em_btn_open';
const MOD_ID = 'em_mod_submit';
const EMBED_FLOW_TTL_MS = 15 * 60 * 1000;
const pendingEmbedFlows = new Map();

function parseHexColor(raw) {
  if (!raw || !raw.trim()) return null;
  const hex = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  return parseInt(hex, 16);
}

function isValidUrl(raw) {
  if (!raw || !raw.trim()) return true;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasManageMessagesPermission(subject) {
  const permissions =
    subject?.memberPermissions ||
    subject?.member?.permissions ||
    null;
  return Boolean(permissions?.has?.(PermissionFlagsBits.ManageMessages));
}

function botCanSendEmbed(channel, botMember) {
  if (!botMember) return false;
  const perms = channel.permissionsFor(botMember);
  if (!perms) return false;
  return (
    perms.has(PermissionFlagsBits.SendMessages) &&
    perms.has(PermissionFlagsBits.EmbedLinks)
  );
}

async function replyError(interaction, text) {
  const payload = { content: text, flags: 64 };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

function prunePendingFlows(now = Date.now()) {
  for (const [token, state] of pendingEmbedFlows.entries()) {
    const expired = now - Number(state?.createdAt || 0) > EMBED_FLOW_TTL_MS;
    const consumed = Number(state?.consumedAt || 0) > 0;
    if (expired || consumed) pendingEmbedFlows.delete(token);
  }
}

function createPendingFlow({ actorId, channelId, normalContent }) {
  prunePendingFlows();
  const token = randomBytes(12).toString('hex');
  pendingEmbedFlows.set(token, {
    actorId: String(actorId || '').trim(),
    channelId: String(channelId || '').trim(),
    normalContent: String(normalContent || '').slice(0, 2000),
    createdAt: Date.now(),
    consumedAt: 0,
  });
  return token;
}

function getPendingFlow(token) {
  prunePendingFlows();
  return pendingEmbedFlows.get(String(token || '').trim()) || null;
}

function consumePendingFlow(token) {
  const key = String(token || '').trim();
  const state = pendingEmbedFlows.get(key);
  if (!state) return;
  state.consumedAt = Date.now();
  pendingEmbedFlows.set(key, state);
  prunePendingFlows();
}

async function validateInteractionActor(interaction, token) {
  const flow = getPendingFlow(token);
  if (!flow) {
    await replyError(interaction, 'Bu embed oturumu artık geçerli değil. Komutu yeniden başlatın. ୭ ˚. !!');
    return null;
  }

  if (flow.actorId !== String(interaction?.user?.id || '').trim()) {
    await replyError(interaction, 'Bu işlemi yalnızca komutu başlatan yetkili tamamlayabilir. ୭ ˚. !!');
    return null;
  }

  if (!hasManageMessagesPermission(interaction)) {
    await replyError(interaction, 'Bu işlemi tamamlamak için Mesajları Yönet izni gerekiyor. ୭ ˚. !!');
    return null;
  }

  return flow;
}

async function run(ctx) {
  const { message, cleanArgs } = ctx;

  if (!hasManageMessagesPermission(message)) {
    return message
      .reply({
        content: 'Bu komutu kullanmak için **Mesajları Yönet** iznine ihtiyacınız var. ୭ ˚. !!',
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }

  const mentionedChannel = message.mentions?.channels?.first();
  const targetChannel = mentionedChannel || message.channel;

  if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
    return message
      .reply({
        content: 'Geçerli bir metin kanalı belirtin. Örnek: `.embed #kanal` ୭ ˚. !!',
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }

  const botMember = message.guild.members.me;
  if (!botCanSendEmbed(targetChannel, botMember)) {
    return message
      .reply({
        content: `Botun **${targetChannel.toString()}** kanalında mesaj gönderme veya embed paylaşma izni yok. ୭ ˚. !!`,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }

  const normalContent = cleanArgs
    .filter((a) => !a.match(/^<#\d+>$/))
    .join(' ')
    .trim()
    .slice(0, 2000) || '';

  const flowToken = createPendingFlow({
    actorId: message.author.id,
    channelId: targetChannel.id,
    normalContent,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BTN_OPEN}:${flowToken}`)
      .setLabel('Embed Oluştur')
      .setStyle(ButtonStyle.Primary)
  );

  const previewEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(
      `**Hedef kanal:** ${targetChannel.toString()}\n` +
      (normalContent
        ? `**Mesaj içeriği:** ${normalContent.slice(0, 120)}${normalContent.length > 120 ? '...' : ''}`
        : '') +
      '\n\nAşağıdaki butona tıklayarak embed ayrıntılarını girin.'
    );

  await message
    .reply({ embeds: [previewEmbed], components: [row], allowedMentions: { parse: [] } })
    .catch(() => {});
}

async function handleInteraction(interaction) {
  const cid = interaction.customId || '';

  if (interaction.isButton() && cid.startsWith(`${BTN_OPEN}:`)) {
    const token = cid.slice(BTN_OPEN.length + 1);
    const flow = await validateInteractionActor(interaction, token);
    if (!flow) return;

    const modal = new ModalBuilder()
      .setCustomId(`${MOD_ID}:${token}`)
      .setTitle('Embed Oluşturucu');

    const titleInput = new TextInputBuilder()
      .setCustomId('em_title')
      .setLabel('Başlık (opsiyonel)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256);

    const urlInput = new TextInputBuilder()
      .setCustomId('em_url')
      .setLabel('Başlık bağlantısı (opsiyonel)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(512);

    const colorInput = new TextInputBuilder()
      .setCustomId('em_color')
      .setLabel('Renk (hex, örnek: #5865F2)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(7)
      .setPlaceholder('#5865F2');

    const imageInput = new TextInputBuilder()
      .setCustomId('em_image')
      .setLabel('Görsel URL (opsiyonel)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(512);

    const descInput = new TextInputBuilder()
      .setCustomId('em_desc')
      .setLabel('Açıklama metni (opsiyonel)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(urlInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(imageInput),
      new ActionRowBuilder().addComponents(descInput),
    );

    await interaction.showModal(modal).catch(() => {});
    return;
  }

  if (interaction.isModalSubmit() && cid.startsWith(`${MOD_ID}:`)) {
    const token = cid.slice(MOD_ID.length + 1);
    const flow = await validateInteractionActor(interaction, token);
    if (!flow) return;

    await interaction.deferReply({ flags: 64 }).catch(() => {});

    const guild = interaction.guild;
    if (!guild) return replyError(interaction, 'Sunucu bilgisi alınamadı. ୭ ˚. !!');

    const targetChannel = await guild.channels.fetch(flow.channelId).catch(() => null);
    if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
      return replyError(interaction, 'Hedef kanal artık mevcut değil veya geçerli bir metin kanalı değil. ୭ ˚. !!');
    }

    const botMember = guild.members.me;
    if (!botCanSendEmbed(targetChannel, botMember)) {
      return replyError(interaction, `Botun **${targetChannel.toString()}** kanalında mesaj gönderme veya embed paylaşma izni yok. ୭ ˚. !!`);
    }

    const rawTitle = interaction.fields.getTextInputValue('em_title').trim();
    const rawUrl = interaction.fields.getTextInputValue('em_url').trim();
    const rawColor = interaction.fields.getTextInputValue('em_color').trim();
    const rawImage = interaction.fields.getTextInputValue('em_image').trim();
    const rawDesc = interaction.fields.getTextInputValue('em_desc').trim();

    const colorResult = parseHexColor(rawColor);
    if (colorResult === false) {
      return replyError(interaction, `Geçersiz renk biçimi: \`${rawColor}\`. Örnek: \`#5865F2\` ୭ ˚. !!`);
    }
    if (!isValidUrl(rawUrl)) {
      return replyError(interaction, `Geçersiz başlık bağlantısı: \`${rawUrl}\`. Geçerli bir HTTP/HTTPS URL girin. ୭ ˚. !!`);
    }
    if (!isValidUrl(rawImage)) {
      return replyError(interaction, `Geçersiz görsel URL'si: \`${rawImage}\`. Geçerli bir HTTP/HTTPS URL girin. ୭ ˚. !!`);
    }

    if (!rawTitle && !rawDesc && !rawImage) {
      return replyError(interaction, 'En az bir alan doldurun: Başlık, Açıklama veya Görsel URL\'si. ୭ ˚. !!');
    }

    const embed = new EmbedBuilder();
    if (colorResult !== null) embed.setColor(colorResult);
    if (rawTitle) {
      embed.setTitle(rawTitle.slice(0, 256));
      if (rawUrl) embed.setURL(rawUrl);
    }
    if (rawDesc) embed.setDescription(rawDesc.slice(0, 4096));
    if (rawImage) embed.setImage(rawImage);

    try {
      const sendPayload = { embeds: [embed], allowedMentions: { parse: [] } };
      if (flow.normalContent) sendPayload.content = flow.normalContent.slice(0, 2000);
      await targetChannel.send(sendPayload);
      consumePendingFlow(token);
    } catch (err) {
      return replyError(interaction, `Mesaj gönderilemedi: ${err?.message || 'Bilinmeyen hata'}. ୭ ˚. !!`);
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setDescription(`Embed **${targetChannel.toString()}** kanalına gönderildi. ⋆˚࿔`);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [successEmbed] }).catch(() => {});
    }
  }
}

module.exports = {
  run,
  handleInteraction,
  __internal: {
    clearPendingFlows() {
      pendingEmbedFlows.clear();
    },
  },
};
