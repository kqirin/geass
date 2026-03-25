const { EmbedBuilder } = require('discord.js');

async function run(ctx) {
  const { message, prefix } = ctx;

  const iconURL =
    message.member?.displayAvatarURL({ dynamic: true }) ||
    message.author?.displayAvatarURL({ dynamic: true });

  const authorName =
    message.member?.displayName ||
    message.author?.globalName ||
    message.author?.username ||
    'Kullan\u0131c\u0131';

  const embed = new EmbedBuilder()
    .setColor(0xBD37FB)
    .setAuthor({ name: `${authorName} - Yard\u0131m Men\u00fcs\u00fc`, iconURL })
    .setDescription(
      'Bot \u00fczerinde kullanabilece\u011finiz moderasyon ve sistem komutlar\u0131 a\u015fa\u011f\u0131da listelenmi\u015ftir.\n' +
      'Arg\u00fcmanlar\u0131n yan\u0131ndaki `[ ]` iste\u011fe ba\u011fl\u0131, `< >` ise zorunlu alanlar\u0131 temsil eder.\n\n'
    )
    .addFields(
      {
        name: 'Moderasyon \u0130\u015flemleri',
        value:
          `**${prefix}ban <@kullan\u0131c\u0131> [sebep]**\nKullan\u0131c\u0131y\u0131 sunucudan yasaklar.\n*\u00d6rnek: \`${prefix}ban @Kullanici Kurallara uymamak\`*\n\n` +
          `**${prefix}unban <kullan\u0131c\u0131_id> [sebep]**\nBelirtilen kullan\u0131c\u0131n\u0131n yasa\u011f\u0131n\u0131 kald\u0131r\u0131r.\n*\u00d6rnek: \`${prefix}unban 123456789 \u00d6z\u00fcr diledi\`*\n\n` +
          `**${prefix}kick <@kullan\u0131c\u0131> [sebep]**\nKullan\u0131c\u0131y\u0131 sunucudan \u00e7\u0131kar\u0131r.\n*\u00d6rnek: \`${prefix}kick @Kullanici Troll yapmak\`*\n\n` +
          `**${prefix}warn <@kullan\u0131c\u0131> [sebep]**\nKullan\u0131c\u0131y\u0131 uyar\u0131r ve siciline i\u015fler.\n*\u00d6rnek: \`${prefix}warn @Kullanici Spam yapmak\`*`,
        inline: false,
      },
      {
        name: 'Susturma ve Underworld',
        value:
          `**${prefix}mute <@kullan\u0131c\u0131> [s\u00fcre] [sebep]**\nKullan\u0131c\u0131ya Discord native timeout uygular. S\u00fcre verilmezse otomatik olarak 28 g\u00fcn uygulan\u0131r.\n*\u00d6rnek: \`${prefix}mute @Kullanici Ortami germek\`*\n\n` +
          `**${prefix}unmute <@kullan\u0131c\u0131> [sebep]**\nKullan\u0131c\u0131n\u0131n susturmas\u0131n\u0131 kald\u0131r\u0131r.\n*\u00d6rnek: \`${prefix}unmute @Kullanici\`*\n\n` +
          `**${prefix}vcmute <@kullan\u0131c\u0131> [s\u00fcre] [sebep]**\nKullan\u0131c\u0131y\u0131 sesli kanallarda susturur.\n*\u00d6rnek: \`${prefix}vcmute @Kullanici 30m Sesi bozmak\`*\n\n` +
          `**${prefix}vcunmute <@kullan\u0131c\u0131> [sebep]**\nKullan\u0131c\u0131n\u0131n sesli kanal susturmas\u0131n\u0131 kald\u0131r\u0131r.\n*\u00d6rnek: \`${prefix}vcunmute @Kullanici\`*\n\n` +
          `**${prefix}jail <@kullan\u0131c\u0131> [s\u00fcre] [sebep]**\nKullan\u0131c\u0131y\u0131 Underworld'e g\u00f6nderir.\n*\u00d6rnek: \`${prefix}jail @Kullanici 1d \u015e\u00fcpheli hareket\`*\n\n` +
          `**${prefix}unjail <@kullan\u0131c\u0131> [sebep]**\nKullan\u0131c\u0131y\u0131 Underworld'den \u00e7\u0131kar\u0131r.\n*\u00d6rnek: \`${prefix}unjail @Kullanici\`*`,
        inline: false,
      },
      {
        name: 'Sistem ve Bilgi',
        value:
          `**${prefix}log <@kullan\u0131c\u0131 / ID>**\nKullan\u0131c\u0131n\u0131n sicil kay\u0131tlar\u0131n\u0131 g\u00f6r\u00fcnt\u00fcler.\n*\u00d6rnek: \`${prefix}log @Kullanici\`*\n\n` +
          `**${prefix}yardim**\nYard\u0131m men\u00fcs\u00fcn\u00fc g\u00f6r\u00fcnt\u00fcler.\n*\u00d6rnek: \`${prefix}yardim\`*`,
        inline: false,
      }
    )
    .setTimestamp();

  if (message.client?.user?.displayAvatarURL) {
    embed.setFooter({ text: 'Geass Bot - Yard\u0131m Sistemi', iconURL: message.client.user.displayAvatarURL() });
  } else {
    embed.setFooter({ text: 'Geass Bot - Yard\u0131m Sistemi' });
  }

  try {
    if (typeof message.reply === 'function') {
      await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    } else if (message.channel && typeof message.channel.send === 'function') {
      await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  } catch {
    // Ignore permissions/network errors when sending
  }
}

module.exports = { run };
