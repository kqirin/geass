const os = require('node:os');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  BOT_STATUS_DETAIL_MODE_COMPACT,
  BOT_STATUS_DETAIL_MODE_LEGACY,
  resolveStatusCommandRuntimeMode,
} = require('../../controlPlane/botSettingsRepository');

const STATUS_EMBED_COLOR = 0x4b5563;
const ERROR_EMBED_COLOR = 0x7f1d1d;
const STATUS_MESSAGE_TTL_MS = 15_000;
const CPU_SAMPLE_MS = 1_000;
const NUMBER_FORMATTER = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const CPU_FORMATTER = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function hasAdministratorPermission(member) {
  const permissions = member?.permissions || member?.memberPermissions || null;
  return Boolean(
    permissions?.has?.(PermissionFlagsBits.Administrator) ||
    permissions?.has?.('Administrator')
  );
}

async function resolveActorMember(message) {
  if (message?.member?.permissions?.has) return message.member;

  const actorId = String(message?.author?.id || '').trim();
  if (!actorId || typeof message?.guild?.members?.fetch !== 'function') return null;

  return message.guild.members.fetch(actorId).catch(() => null);
}

function getCpuCoreCount() {
  const available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 0;
  if (Number.isInteger(available) && available > 0) return available;

  const cpuList = os.cpus();
  if (Array.isArray(cpuList) && cpuList.length > 0) return cpuList.length;

  return 1;
}

async function wait(ms) {
  const delayMs = Number(ms);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
  });
}

async function measureCpuUsage(sampleMs = CPU_SAMPLE_MS) {
  const safeSampleMs = Math.max(250, Math.min(Number(sampleMs) || CPU_SAMPLE_MS, 5_000));
  const startUsage = process.cpuUsage();
  const startTime = process.hrtime.bigint();

  await wait(safeSampleMs);

  const cpuDiff = process.cpuUsage(startUsage);
  const elapsedMicroseconds = Number(process.hrtime.bigint() - startTime) / 1_000;
  if (!Number.isFinite(elapsedMicroseconds) || elapsedMicroseconds <= 0) return 0;

  const usedMicroseconds = Number(cpuDiff.user || 0) + Number(cpuDiff.system || 0);
  const normalizedPercent = (usedMicroseconds / (elapsedMicroseconds * getCpuCoreCount())) * 100;

  return Math.max(0, Math.min(normalizedPercent, 100));
}

function formatMemoryUsage(bytes) {
  const megabytes = Number(bytes || 0) / (1024 * 1024);
  return `${NUMBER_FORMATTER.format(Math.max(0, megabytes))} MB`;
}

function formatCpuUsage(percent) {
  const safePercent = Math.max(0, Math.min(Number(percent) || 0, 100));
  return `%${CPU_FORMATTER.format(safePercent)}`;
}

function resolvePingMs(message) {
  const gatewayPing = Number(message?.client?.ws?.ping);
  if (Number.isFinite(gatewayPing) && gatewayPing >= 0) return Math.round(gatewayPing);

  const messageTimestamp = Number(message?.createdTimestamp);
  if (Number.isFinite(messageTimestamp) && messageTimestamp > 0) {
    return Math.max(0, Date.now() - messageTimestamp);
  }

  return null;
}

function formatPing(pingMs) {
  if (!Number.isFinite(pingMs) || pingMs < 0) return 'Bilinmiyor';
  return `${Math.round(pingMs)} ms`;
}

function resolveUptimeMs(client) {
  const clientUptime = Number(client?.uptime);
  if (Number.isFinite(clientUptime) && clientUptime >= 0) return clientUptime;

  return Math.max(0, Math.floor(process.uptime() * 1_000));
}

function formatUptime(uptimeMs) {
  const totalMinutes = Math.max(0, Math.floor((Number(uptimeMs) || 0) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} g\u00fcn ${hours} saat ${minutes} dakika`;
  if (hours > 0) return `${hours} saat ${minutes} dakika`;
  return `${minutes} dakika`;
}

function resolveThumbnailUrl(message) {
  return (
    message?.guild?.iconURL?.({ size: 256 }) ||
    message?.client?.user?.displayAvatarURL?.({ size: 256 }) ||
    null
  );
}

function createBaseEmbed(message, { color, title, description }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description);

  const thumbnailUrl = internals.resolveThumbnailUrl(message);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  return embed;
}

function buildStatusDescription(metrics, detailMode = BOT_STATUS_DETAIL_MODE_LEGACY) {
  if (detailMode === BOT_STATUS_DETAIL_MODE_COMPACT) {
    return [
      `Ping: ${metrics.ping}`,
      `Uptime: ${metrics.uptime}`,
    ].join('\n');
  }

  return [
    `RAM Kullan\u0131m\u0131: ${metrics.memoryUsage}`,
    `CPU Kullan\u0131m\u0131: ${metrics.cpuUsage}`,
    `Ping: ${metrics.ping}`,
    `Uptime: ${metrics.uptime}`,
  ].join('\n');
}

function buildStatusEmbed(message, metrics, { detailMode = BOT_STATUS_DETAIL_MODE_LEGACY } = {}) {
  const guildName = String(message?.guild?.name || 'Sunucu').trim() || 'Sunucu';
  const description = internals.buildStatusDescription(metrics, detailMode);

  return createBaseEmbed(message, {
    color: STATUS_EMBED_COLOR,
    title: `${guildName} \u2022 Bot Durum`,
    description,
  });
}

async function resolveStatusDetailMode(ctx = {}) {
  const explicitDetailMode = String(ctx?.statusDetailMode || '').trim().toLowerCase();
  if (explicitDetailMode === BOT_STATUS_DETAIL_MODE_COMPACT) {
    return BOT_STATUS_DETAIL_MODE_COMPACT;
  }
  if (explicitDetailMode === BOT_STATUS_DETAIL_MODE_LEGACY) {
    return BOT_STATUS_DETAIL_MODE_LEGACY;
  }

  const guildId = String(ctx?.message?.guild?.id || '').trim();
  return resolveStatusCommandRuntimeMode({ guildId });
}

function buildErrorEmbed(message, title, description) {
  return createBaseEmbed(message, {
    color: ERROR_EMBED_COLOR,
    title,
    description,
  });
}

function scheduleMessageDelete(sentMessage, ttlMs = STATUS_MESSAGE_TTL_MS) {
  const safeTtl = Number(ttlMs);
  if (!Number.isFinite(safeTtl) || safeTtl <= 0 || typeof sentMessage?.delete !== 'function') return;

  const timer = setTimeout(() => {
    sentMessage.delete().catch(() => {});
  }, safeTtl);
  timer.unref?.();
}

async function sendTemporaryEmbed(message, embed, ttlMs = STATUS_MESSAGE_TTL_MS) {
  const payload = {
    embeds: [embed],
    allowedMentions: {
      parse: [],
      repliedUser: false,
    },
  };

  const channelSend = message?.channel?.send?.bind(message.channel);
  const replySend = message?.reply?.bind(message);

  let sentMessage = null;
  if (typeof channelSend === 'function') {
    sentMessage = await channelSend(payload);
  } else if (typeof replySend === 'function') {
    sentMessage = await replySend(payload);
  } else {
    throw new Error('status_send_unavailable');
  }

  internals.scheduleMessageDelete(sentMessage, ttlMs);
  return sentMessage;
}

async function sendTemporaryError(message, description, title = '\u0130\u015flem Tamamlanamad\u0131') {
  const errorEmbed = internals.buildErrorEmbed(message, title, description);
  return internals.sendTemporaryEmbed(message, errorEmbed, STATUS_MESSAGE_TTL_MS).catch(() => null);
}

async function tryDeleteSourceMessage(message) {
  if (message?.deletable === false || typeof message?.delete !== 'function') return false;
  return message.delete().then(() => true).catch(() => false);
}

async function collectStatusMetrics(message) {
  const memoryUsage = internals.formatMemoryUsage(process.memoryUsage().rss);
  const ping = internals.formatPing(internals.resolvePingMs(message));
  const uptime = internals.formatUptime(internals.resolveUptimeMs(message?.client));
  const cpuUsage = internals.formatCpuUsage(await internals.measureCpuUsage(CPU_SAMPLE_MS));

  return {
    memoryUsage,
    cpuUsage,
    ping,
    uptime,
  };
}

async function run(ctx) {
  const { message } = ctx || {};

  await internals.tryDeleteSourceMessage(message);

  if (!message?.guild) {
    await internals.sendTemporaryError(message, 'Bu komut yaln\u0131zca sunucularda kullan\u0131labilir.');
    return;
  }

  const actorMember = await internals.resolveActorMember(message);
  if (!internals.hasAdministratorPermission(actorMember)) {
    await internals.sendTemporaryError(
      message,
      'Bu komutu yaln\u0131zca y\u00f6netici yetkisine sahip kullan\u0131c\u0131lar kullanabilir.',
      'Eri\u015fim Reddedildi'
    );
    return;
  }

  try {
    const metrics = await internals.collectStatusMetrics(message);
    const detailMode = await internals.resolveStatusDetailMode(ctx);
    const embed = internals.buildStatusEmbed(message, metrics, { detailMode });
    await internals.sendTemporaryEmbed(message, embed, STATUS_MESSAGE_TTL_MS);
  } catch {
    await internals.sendTemporaryError(message, 'Durum bilgisi al\u0131n\u0131rken bir hata olu\u015ftu.');
  }
}

const internals = {
  STATUS_MESSAGE_TTL_MS,
  CPU_SAMPLE_MS,
  hasAdministratorPermission,
  resolveActorMember,
  measureCpuUsage,
  formatMemoryUsage,
  formatCpuUsage,
  resolvePingMs,
  formatPing,
  resolveUptimeMs,
  formatUptime,
  resolveThumbnailUrl,
  buildStatusDescription,
  buildStatusEmbed,
  resolveStatusDetailMode,
  buildErrorEmbed,
  scheduleMessageDelete,
  sendTemporaryEmbed,
  sendTemporaryError,
  tryDeleteSourceMessage,
  collectStatusMetrics,
};

module.exports = {
  run,
  __internal: internals,
};
