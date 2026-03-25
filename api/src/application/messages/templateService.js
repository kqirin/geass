const { EmbedBuilder } = require('discord.js');
const { TEMPLATE_MODES, getSystemDefaultTemplate } = require('./catalog');
const { repairMojibakeText } = require('./encoding');

const MAX_TEMPLATE_CONTENT_LEN = 2000;
const MAX_TEMPLATE_TITLE_LEN = 256;
const FALLBACK_COLOR = '#BD37FB';
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

function normalizeColor(input, fallback = FALLBACK_COLOR) {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const color = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeTemplateRecord(rawTemplate, fallbackTemplate) {
  const fallback = fallbackTemplate || getSystemDefaultTemplate('warn', 'systemError');
  const input = rawTemplate && typeof rawTemplate === 'object' ? rawTemplate : {};
  const mode = TEMPLATE_MODES.has(input.mode) ? input.mode : fallback.mode;
  const contentRaw = typeof input.content === 'string' ? input.content : fallback.content;
  const embedTitleRaw =
    typeof input.embedTitle === 'string'
      ? input.embedTitle
      : Object.prototype.hasOwnProperty.call(fallback, 'embedTitle')
        ? fallback.embedTitle
        : '';

  return {
    mode: mode || 'embed',
    content: repairMojibakeText(String(contentRaw || '')).slice(0, MAX_TEMPLATE_CONTENT_LEN),
    embedTitle: repairMojibakeText(String(embedTitleRaw || '')).slice(0, MAX_TEMPLATE_TITLE_LEN),
    color: normalizeColor(input.color, normalizeColor(fallback.color, FALLBACK_COLOR)),
    withIcon: Object.prototype.hasOwnProperty.call(input, 'withIcon')
      ? Boolean(input.withIcon)
      : Boolean(fallback.withIcon),
  };
}

function renderTemplateText(text, context = {}) {
  const source = repairMojibakeText(String(text || ''));
  const rendered = source.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    if (!Object.prototype.hasOwnProperty.call(context, key)) return full;
    const value = context[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });

  return rendered
    .replace(/(^|\s)\(\s*\)(?=\s|$)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ \n/g, '\n');
}

function resolveTemplate({ commandName, templateKey }) {
  const fallback = getSystemDefaultTemplate(commandName, templateKey);
  return normalizeTemplateRecord(fallback, fallback);
}

function toColorInt(hexColor) {
  const color = normalizeColor(hexColor, FALLBACK_COLOR);
  return parseInt(color.slice(1), 16);
}

function getCommandUserIconUrl(message) {
  return (
    message.member?.displayAvatarURL?.({ dynamic: true, size: 256 }) ||
    message.author?.displayAvatarURL?.({ dynamic: true, size: 256 }) ||
    null
  );
}

function getCommandUserName(message) {
  return (
    message.member?.displayName ||
    message.author?.globalName ||
    message.author?.username ||
    'Yetkili'
  );
}

function hasTargetReference(targetUserOrId) {
  if (targetUserOrId === null || targetUserOrId === undefined) return false;
  if (typeof targetUserOrId === 'string') return targetUserOrId.trim().length > 0;
  if (typeof targetUserOrId === 'number') return Number.isFinite(targetUserOrId);
  return true;
}

function unwrapUserLike(entity) {
  if (!entity || typeof entity !== 'object') return entity;
  if (entity.user && typeof entity.user.displayAvatarURL === 'function') return entity.user;
  return entity;
}

function getAvatarUrlFromUserLike(entity) {
  const userLike = unwrapUserLike(entity);
  if (!userLike || typeof userLike.displayAvatarURL !== 'function') return null;
  return userLike.displayAvatarURL({ dynamic: true, size: 256 });
}

function getUserIdFromUserLike(entity) {
  if (entity === null || entity === undefined) return null;

  if (typeof entity === 'string' || typeof entity === 'number') {
    const rawId = String(entity).trim();
    return rawId || null;
  }

  if (typeof entity !== 'object') return null;

  if (entity.user?.id) {
    const userId = String(entity.user.id).trim();
    return userId || null;
  }

  if (entity.id) {
    const userId = String(entity.id).trim();
    return userId || null;
  }

  return null;
}

async function resolveTargetAvatarUrl(message, targetUserOrId) {
  const directAvatar = getAvatarUrlFromUserLike(targetUserOrId);
  if (directAvatar) return directAvatar;

  const userId = getUserIdFromUserLike(targetUserOrId);
  if (!DISCORD_SNOWFLAKE_REGEX.test(String(userId || '').trim())) return null;
  if (typeof message?.client?.users?.fetch !== 'function') return null;

  const fetchedUser = await message.client.users.fetch(userId).catch(() => null);
  return getAvatarUrlFromUserLike(fetchedUser);
}

async function setTargetAvatar(embed, message, targetUserOrId, fallbackIconUser, authorText) {
  if (hasTargetReference(targetUserOrId)) {
    const targetIconURL = await resolveTargetAvatarUrl(message, targetUserOrId);
    if (targetIconURL) {
      embed.setAuthor({ name: authorText, iconURL: targetIconURL });
      return;
    }

    // Target avatar could not be resolved; avoid showing executor avatar.
    embed.setAuthor({ name: authorText });
    return;
  }

  const fallbackIconURL = getAvatarUrlFromUserLike(fallbackIconUser) || getCommandUserIconUrl(message);
  if (fallbackIconURL) {
    embed.setAuthor({ name: authorText, iconURL: fallbackIconURL });
    return;
  }

  embed.setAuthor({ name: authorText });
}

async function sendPayload(message, payload, { asReply = true, deleteAfterMs = 0, allowReplyFallback = false } = {}) {
  const sendAsReply = asReply === true && typeof message.reply === 'function';
  const sender = sendAsReply ? message.reply.bind(message) : message.channel?.send?.bind(message.channel);
  if (typeof sender !== 'function') throw new Error('template_send_unavailable');

  let sentMessage = null;
  try {
    sentMessage = await sender(payload);
  } catch (err) {
    if (sendAsReply && allowReplyFallback && typeof message.channel?.send === 'function') {
      sentMessage = await message.channel.send(payload);
    } else {
      throw err;
    }
  }

  const ttl = Number(deleteAfterMs || 0);
  if (Number.isFinite(ttl) && ttl > 0 && typeof sentMessage?.delete === 'function') {
    setTimeout(() => {
      sentMessage.delete().catch(() => {});
    }, ttl).unref?.();
  }

  return sentMessage;
}

function createTemplateSender() {
  async function sendTemplate({
    message,
    commandName,
    templateKey,
    context = {},
    iconUser = null,
    targetUserOrId = null,
    asReply = true,
    deleteAfterMs = 0,
    allowReplyFallback = false,
  }) {
    const template = resolveTemplate({ commandName, templateKey });
    const renderedContent = renderTemplateText(template.content, context).trim();
    const renderedTitle = renderTemplateText(template.embedTitle, context).trim();
    const fallbackContent = renderTemplateText(getSystemDefaultTemplate(commandName, templateKey).content, context).trim();

    if (template.mode === 'normal') {
      const content = renderedContent || fallbackContent;
      return sendPayload(
        message,
        {
          content: content || ' ',
          allowedMentions: { parse: [] },
        },
        { asReply, deleteAfterMs, allowReplyFallback }
      );
    }

    const embed = new EmbedBuilder().setColor(toColorInt(template.color));
    const bodyText = renderedContent || fallbackContent || '\u200B';
    if (template.withIcon) {
      const authorText = bodyText.slice(0, MAX_TEMPLATE_TITLE_LEN) || getCommandUserName(message);
      await setTargetAvatar(embed, message, targetUserOrId, iconUser, authorText);

      const remainder = bodyText.length > MAX_TEMPLATE_TITLE_LEN ? bodyText.slice(MAX_TEMPLATE_TITLE_LEN).trim() : '';
      const lines = [];
      if (renderedTitle) lines.push(`**${renderedTitle}**`);
      if (remainder) lines.push(remainder);
      if (lines.length > 0) embed.setDescription(lines.join('\n'));
    } else {
      if (renderedTitle) embed.setTitle(renderedTitle);
      embed.setDescription(bodyText);
    }

    return sendPayload(
      message,
      {
        embeds: [embed],
        allowedMentions: { parse: [] },
      },
      { asReply, deleteAfterMs, allowReplyFallback }
    );
  }

  return {
    sendTemplate,
  };
}

module.exports = {
  createTemplateSender,
};
