const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createLogContent, buildPaginationRow } = require('../moderation.logs');

async function run({ message, target, targetId, targetMention, actionNames, verifyPermission, targetResolution }) {
  if (targetResolution?.ambiguous) {
    return message.reply({
      content: 'Birden fazla kullanıcı eşleşti. Lütfen ID veya etiket kullanın. ୭ ˚. !!',
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  const logUserId = String(target?.id || targetId || '').trim();
  if (!logUserId) {
    return message.reply({
      content: 'Kullanıcı bulunamadı. ୭ ˚. !!',
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  const check = await verifyPermission('log', target?.roles ? target : null);
  if (!check.success) return;
  const receipt = await check.consumeLimit();
  if (!receipt) return;

  const viewButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`view_logs_${logUserId}`)
      .setLabel('Görüntüle')
      .setStyle(ButtonStyle.Secondary)
  );

  let inviteMsg = null;
  try {
    inviteMsg = await message.channel.send({
      content: `**${targetMention}** sicili hazır. ⋆˚࿔`,
      components: [viewButton]
    });
  } catch {
    await receipt.rollback?.();
    return message.reply({
      content: 'Sicil mesajı gönderilemedi. ୭ ˚. !!',
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  await receipt.commit?.();

  setTimeout(() => { inviteMsg.delete().catch(() => {}); }, 30000);

  const inviteCollector = inviteMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

  inviteCollector.on('collect', async (i) => {
    if (i.user.id !== message.author.id) {
      return i.reply({ content: 'Bu işlemi yalnızca komutu kullanan kişi görüntüleyebilir. ୭ ˚. !!', ephemeral: true });
    }

    await i.deferReply({ ephemeral: true }).catch(() => {});
    let currentPage = 0;
    let totalPages = 0;
    const content = await createLogContent(message.guild, logUserId, actionNames, currentPage);
    totalPages = content.totalPages;

    if (content.totalPages === 0) {
      return i.editReply({ content: content.text }).catch(() => null);
    }

    const ephemeralMsg = await i.editReply({
      content: content.text,
      components: [buildPaginationRow(currentPage, totalPages)],
    }).catch(() => null);
    if (!ephemeralMsg) return null;

    const pageCollector = ephemeralMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

    pageCollector.on('collect', async (pageInter) => {
      await pageInter.deferUpdate().catch(() => {});
      if (pageInter.customId === 'prev_page' && currentPage > 0) currentPage--;
      if (pageInter.customId === 'next_page' && currentPage < totalPages - 1) currentPage++;

      const newContent = await createLogContent(message.guild, logUserId, actionNames, currentPage);
      totalPages = newContent.totalPages;

      await pageInter.editReply({
        content: newContent.text,
        components: [buildPaginationRow(currentPage, totalPages)]
      }).catch(() => null);
    });
  });
}

module.exports = { run };
