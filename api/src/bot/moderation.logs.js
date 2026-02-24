const db = require('../database');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const actionListeners = new Set();

function registerActionListener(listener) {
  if (typeof listener !== 'function') return () => {};
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}

async function logAction(guildId, userId, moderatorId, action, reason, duration) {
  const safeReason = String(reason || 'Yok').slice(0, 255);
  const safeDuration = String(duration || 'Suresiz').slice(0, 32);
  const [result] = await db.execute(
    'INSERT INTO mod_logs (guild_id, user_id, moderator_id, action_type, reason, duration) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, userId, moderatorId, action, safeReason, safeDuration]
  );
  for (const listener of actionListeners) {
    try {
      listener({ guildId, userId, moderatorId, action, reason: safeReason, duration: safeDuration, caseId: result.insertId });
    } catch {}
  }
  return result.insertId;
}

async function createLogContent(guild, logUserId, actionNames, page = 0) {
  const [[countRow]] = await db.execute(
    'SELECT COUNT(*) AS total FROM mod_logs WHERE guild_id = ? AND user_id = ?',
    [guild.id, logUserId]
  );
  const total = Number(countRow?.total || 0);

  if (!total) {
    return { text: `**${logUserId}** sicili temiz.`, totalPages: 0 };
  }

  const itemsPerPage = 10;
  const totalPages = Math.ceil(total / itemsPerPage);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const offset = safePage * itemsPerPage;

  const [currentLogs] = await db.execute(
    'SELECT * FROM mod_logs WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [guild.id, logUserId, itemsPerPage, offset]
  );

  let logText = `\`\`\`ml\nID: ${logUserId} Sicil Kaydi (Sayfa ${safePage + 1}/${totalPages})\n`;

  for (const log of currentLogs) {
    const actionTr = actionNames[log.action_type] || String(log.action_type).toUpperCase();
    let modName = log.moderator_id;

    const modObj = guild.members.cache.get(log.moderator_id);
    if (modObj) modName = `@${modObj.user.username}`;

    logText += `  -> ${actionTr} | Yetkili: ${modName} | Sebep: "${log.reason}" (#${log.id})\n`;
  }

  logText += '```';
  return { text: logText, totalPages };
}

function buildPaginationRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prev_page')
      .setLabel('Onceki')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('next_page')
      .setLabel('Sonraki')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

module.exports = { logAction, createLogContent, buildPaginationRow, registerActionListener };

