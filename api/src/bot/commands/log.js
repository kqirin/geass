const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createLogContent, buildPaginationRow } = require('../moderation.logs');

async function run({ message, target, targetMention, actionNames, verifyPermission, cache }) {
  const logUserId = target ? target.id : message.author.id;

  const check = await verifyPermission('log', target?.roles ? target : null);
  if (!check.success) return;
  cache.incrementLimit(check.key);

  const viewButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`view_logs_${logUserId}`)
      .setLabel('Goruntule')
      .setStyle(ButtonStyle.Secondary)
  );

  const inviteMsg = await message.channel.send({
    content: `**${targetMention}** sicili hazir.`,
    components: [viewButton]
  });

  setTimeout(() => { inviteMsg.delete().catch(() => {}); }, 30000);

  const inviteCollector = inviteMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

  inviteCollector.on('collect', async (i) => {
    if (i.user.id !== message.author.id) {
      return i.reply({ content: 'Sadece komutu yazan bakabilir.', ephemeral: true });
    }

    let currentPage = 0;
    const content = await createLogContent(message.guild, logUserId, actionNames, currentPage);

    if (content.totalPages === 0) {
      return i.reply({ content: content.text, ephemeral: true });
    }

    const ephemeralMsg = await i.reply({
      content: content.text,
      components: [buildPaginationRow(currentPage, content.totalPages)],
      ephemeral: true,
      fetchReply: true
    });

    const pageCollector = ephemeralMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

    pageCollector.on('collect', async (pageInter) => {
      if (pageInter.customId === 'prev_page' && currentPage > 0) currentPage--;
      if (pageInter.customId === 'next_page' && currentPage < content.totalPages - 1) currentPage++;

      const newContent = await createLogContent(message.guild, logUserId, actionNames, currentPage);

      await pageInter.update({
        content: newContent.text,
        components: [buildPaginationRow(currentPage, newContent.totalPages)]
      });
    });
  });
}

module.exports = { run };

