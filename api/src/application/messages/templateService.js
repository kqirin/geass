const { EmbedBuilder } = require('discord.js');
const {
  TEMPLATE_SCOPE_GLOBAL,
  TEMPLATE_SCOPE_COMMAND,
  TEMPLATE_MODES,
  getCommandTemplateKeys,
  getTemplateKeyMetaForGlobal,
  getSystemDefaultTemplate,
} = require('./catalog');

const MAX_TEMPLATE_CONTENT_LEN = 2000;
const MAX_TEMPLATE_TITLE_LEN = 256;
const FALLBACK_COLOR = '#BD37FB';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeColor(input, fallback = FALLBACK_COLOR) {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const color = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeTemplateRecord(rawTemplate, fallbackTemplate) {
  const fallback = fallbackTemplate || getSystemDefaultTemplate('warn', 'systemError');

  if (typeof rawTemplate === 'string') {
    return {
      mode: 'embed',
      content: rawTemplate.slice(0, MAX_TEMPLATE_CONTENT_LEN),
      embedTitle: fallback.embedTitle || '',
      color: normalizeColor(fallback.color, FALLBACK_COLOR),
      withIcon: Boolean(fallback.withIcon),
    };
  }

  const input = isObject(rawTemplate) ? rawTemplate : {};
  const mode = TEMPLATE_MODES.has(input.mode) ? input.mode : fallback.mode;
  const contentRaw = typeof input.content === 'string' ? input.content : fallback.content;
  const embedTitleRaw =
    typeof input.embedTitle === 'string' ? input.embedTitle : Object.prototype.hasOwnProperty.call(fallback, 'embedTitle') ? fallback.embedTitle : '';

  return {
    mode: mode || 'embed',
    content: String(contentRaw || '').slice(0, MAX_TEMPLATE_CONTENT_LEN),
    embedTitle: String(embedTitleRaw || '').slice(0, MAX_TEMPLATE_TITLE_LEN),
    color: normalizeColor(input.color, normalizeColor(fallback.color, FALLBACK_COLOR)),
    withIcon: Object.prototype.hasOwnProperty.call(input, 'withIcon')
      ? Boolean(input.withIcon)
      : Boolean(fallback.withIcon),
  };
}

function renderTemplateText(text, context = {}) {
  const source = String(text || '');
  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    if (!Object.prototype.hasOwnProperty.call(context, key)) return full;
    const value = context[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

function resolveTemplate({ cache, guildId, commandName, templateKey }) {
  const fallback = getSystemDefaultTemplate(commandName, templateKey);
  const commandTemplates = cache.getMessageTemplates(guildId, TEMPLATE_SCOPE_COMMAND, commandName) || {};
  const globalTemplates = cache.getMessageTemplates(guildId, TEMPLATE_SCOPE_GLOBAL, '') || {};

  if (Object.prototype.hasOwnProperty.call(commandTemplates, templateKey)) {
    return normalizeTemplateRecord(commandTemplates[templateKey], fallback);
  }

  if (Object.prototype.hasOwnProperty.call(globalTemplates, templateKey)) {
    return normalizeTemplateRecord(globalTemplates[templateKey], fallback);
  }

  return normalizeTemplateRecord(fallback, fallback);
}

function resolveTemplatesForScope({ cache, guildId, scope, commandName = '' }) {
  const normalizedCommand = String(commandName || '').trim().toLowerCase();
  const templateKeys =
    scope === TEMPLATE_SCOPE_COMMAND
      ? getCommandTemplateKeys(normalizedCommand)
      : getTemplateKeyMetaForGlobal().map((item) => item.key);

  const scopedTemplates = cache.getMessageTemplates(guildId, scope, normalizedCommand) || {};
  const globalTemplates = cache.getMessageTemplates(guildId, TEMPLATE_SCOPE_GLOBAL, '') || {};

  const storedTemplates = {};
  const resolvedTemplates = {};

  for (const key of templateKeys) {
    const fallback = getSystemDefaultTemplate(normalizedCommand, key);

    if (Object.prototype.hasOwnProperty.call(scopedTemplates, key)) {
      storedTemplates[key] = normalizeTemplateRecord(scopedTemplates[key], fallback);
      resolvedTemplates[key] = normalizeTemplateRecord(scopedTemplates[key], fallback);
      continue;
    }

    if (scope === TEMPLATE_SCOPE_COMMAND && Object.prototype.hasOwnProperty.call(globalTemplates, key)) {
      resolvedTemplates[key] = normalizeTemplateRecord(globalTemplates[key], fallback);
      continue;
    }

    resolvedTemplates[key] = normalizeTemplateRecord(fallback, fallback);
  }

  return { templateKeys, storedTemplates, resolvedTemplates };
}

function sanitizeTemplatesPayload({ templates, scope, commandName = '' }) {
  if (!isObject(templates)) {
    return { ok: false, error: 'templates bir obje olmali' };
  }

  const normalizedCommand = String(commandName || '').trim().toLowerCase();
  const allowedKeys =
    scope === TEMPLATE_SCOPE_COMMAND
      ? getCommandTemplateKeys(normalizedCommand)
      : getTemplateKeyMetaForGlobal().map((item) => item.key);
  const allowedSet = new Set(allowedKeys);

  const out = {};
  for (const [key, rawTemplate] of Object.entries(templates)) {
    if (!allowedSet.has(key)) {
      return { ok: false, error: `Gecersiz template anahtari: ${key}` };
    }
    if (!isObject(rawTemplate)) {
      return { ok: false, error: `Template alani obje olmali: ${key}` };
    }
    if (Object.prototype.hasOwnProperty.call(rawTemplate, 'mode') && !TEMPLATE_MODES.has(rawTemplate.mode)) {
      return { ok: false, error: `${key}.mode sadece normal veya embed olabilir` };
    }
    if (Object.prototype.hasOwnProperty.call(rawTemplate, 'color')) {
      const colorRaw = String(rawTemplate.color || '').trim();
      const color = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`;
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return { ok: false, error: `${key}.color gecersiz hex formatinda` };
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawTemplate, 'content') && typeof rawTemplate.content !== 'string') {
      return { ok: false, error: `${key}.content metin olmali` };
    }
    if (Object.prototype.hasOwnProperty.call(rawTemplate, 'embedTitle') && typeof rawTemplate.embedTitle !== 'string') {
      return { ok: false, error: `${key}.embedTitle metin olmali` };
    }
    if (Object.prototype.hasOwnProperty.call(rawTemplate, 'withIcon') && typeof rawTemplate.withIcon !== 'boolean') {
      return { ok: false, error: `${key}.withIcon true/false olmali` };
    }

    const fallback = getSystemDefaultTemplate(normalizedCommand, key);
    const normalized = normalizeTemplateRecord(rawTemplate, fallback);

    if (normalized.content.length > MAX_TEMPLATE_CONTENT_LEN) {
      return { ok: false, error: `${key}.content en fazla ${MAX_TEMPLATE_CONTENT_LEN} karakter olabilir` };
    }
    if (normalized.embedTitle.length > MAX_TEMPLATE_TITLE_LEN) {
      return { ok: false, error: `${key}.embedTitle en fazla ${MAX_TEMPLATE_TITLE_LEN} karakter olabilir` };
    }

    out[key] = normalized;
  }

  return { ok: true, templates: out, allowedKeys };
}

function toColorInt(hexColor) {
  const color = normalizeColor(hexColor, FALLBACK_COLOR);
  return parseInt(color.slice(1), 16);
}

function getCommandUserIconUrl(message) {
  return (
    message.member?.displayAvatarURL?.({ dynamic: true }) ||
    message.author?.displayAvatarURL?.({ dynamic: true }) ||
    null
  );
}

function getCommandUserName(message) {
  return (
    message.member?.displayName ||
    message.author?.globalName ||
    message.author?.username ||
    'Moderator'
  );
}

function createTemplateSender({ cache }) {
  async function sendTemplate({ message, guildId, commandName, templateKey, context = {}, iconUser = null }) {
    const template = resolveTemplate({ cache, guildId, commandName, templateKey });
    const renderedContent = renderTemplateText(template.content, context).trim();
    const renderedTitle = renderTemplateText(template.embedTitle, context).trim();
    const fallbackContent = renderTemplateText(getSystemDefaultTemplate(commandName, templateKey).content, context).trim();

    if (template.mode === 'normal') {
      const content = renderedContent || fallbackContent;
      return message.reply({
        content: content || ' ',
        allowedMentions: { parse: [] },
      });
    }

    const embed = new EmbedBuilder().setColor(toColorInt(template.color));
    const bodyText = renderedContent || fallbackContent || '\u200B';
    if (template.withIcon) {
      const iconURL = getCommandUserIconUrl(message) || getCommandUserIconUrl({ author: iconUser?.user || iconUser });
      const authorText = bodyText.slice(0, MAX_TEMPLATE_TITLE_LEN) || getCommandUserName(message);
      if (iconURL) embed.setAuthor({ name: authorText, iconURL });
      else embed.setAuthor({ name: authorText });

      const remainder = bodyText.length > MAX_TEMPLATE_TITLE_LEN ? bodyText.slice(MAX_TEMPLATE_TITLE_LEN).trim() : '';
      const lines = [];
      if (renderedTitle) lines.push(`**${renderedTitle}**`);
      if (remainder) lines.push(remainder);
      if (lines.length > 0) embed.setDescription(lines.join('\n'));
    } else {
      if (renderedTitle) embed.setTitle(renderedTitle);
      embed.setDescription(bodyText);
    }

    return message.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }

  return {
    sendTemplate,
  };
}

module.exports = {
  MAX_TEMPLATE_CONTENT_LEN,
  MAX_TEMPLATE_TITLE_LEN,
  normalizeTemplateRecord,
  renderTemplateText,
  resolveTemplate,
  resolveTemplatesForScope,
  sanitizeTemplatesPayload,
  createTemplateSender,
};
