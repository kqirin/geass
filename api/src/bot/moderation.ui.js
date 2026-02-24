const { EmbedBuilder } = require('discord.js');

// Deprecated: retained for backward compatibility with older moderation render flows.
// Current moderation replies are generated via message template service.
const THEME_COLOR = 0x92FF83;

function buildLines({ reason, time, caseId, amount, note }) {
  const lines = [];
  if (reason) lines.push(`**Sebep:** ${reason}`);
  if (time) lines.push(`**Sure:** ${time}`);
  if (caseId) lines.push(`**Vaka:** #${caseId}`);
  if (typeof amount === 'number') lines.push(`**Adet:** ${amount}`);
  if (note) lines.push(note);
  return lines.join('\n') || null;
}

async function sendCard(message, { headerText, iconUser, details }) {
  const iconURL =
    iconUser?.displayAvatarURL?.({ dynamic: true }) ||
    iconUser?.user?.displayAvatarURL?.({ dynamic: true }) ||
    message.client?.user?.displayAvatarURL?.({ dynamic: true }) ||
    message.author.displayAvatarURL({ dynamic: true });

  const embed = new EmbedBuilder()
    .setColor(THEME_COLOR)
    .setAuthor({ name: headerText, iconURL });

  const desc = buildLines(details || {});
  if (desc) embed.setDescription(desc);

  return message.reply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

module.exports = { sendCard, THEME_COLOR };

