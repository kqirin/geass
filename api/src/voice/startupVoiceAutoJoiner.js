const { ChannelType, PermissionFlagsBits } = require('discord.js');

const { config } = require('../config');
const { getConfiguredStaticGuildIds, getStartupVoiceConfig } = require('../config/static');
const voiceManager = require('./voiceManager');

const RETRYABLE_STARTUP_CODES = new Set([
  'VOICE_CONNECT_VERIFY_FAILED',
  'VOICE_CONNECT_CHANNEL_MISMATCH',
]);
const WARNING_STARTUP_CODES = new Set([
  'VOICE_GUILD_NOT_FOUND',
  'VOICE_CHANNEL_NOT_FOUND',
  'VOICE_CHANNEL_INVALID_TYPE',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function uniqueIds(values = []) {
  const out = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = normalizeId(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function isVoiceChannel(channel) {
  return (
    channel?.type === ChannelType.GuildVoice ||
    channel?.type === ChannelType.GuildStageVoice ||
    channel?.type === 2 ||
    channel?.type === 13
  );
}

function collectStartupVoiceGuildIds(client) {
  const explicitGuildIds = uniqueIds([
    config.oauth.singleGuildId,
    config.discord.targetGuildId,
    ...getConfiguredStaticGuildIds(),
  ]);

  if (explicitGuildIds.length > 0) return explicitGuildIds;

  const cachedGuildIds = uniqueIds([...(client?.guilds?.cache?.keys?.() || [])]);
  if (cachedGuildIds.length === 1) return cachedGuildIds;
  return [];
}

function collectStartupVoiceTargets(client) {
  return collectStartupVoiceGuildIds(client)
    .map((guildId) => ({
      guildId,
      channelId: normalizeId(getStartupVoiceConfig(guildId)?.channelId),
    }))
    .filter((target) => Boolean(target.channelId));
}

async function resolveGuild(client, guildId) {
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

async function resolveChannel(guild, channelId) {
  if (!guild?.channels) return null;
  return guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
}

async function resolveBotMember(guild) {
  if (guild?.members?.me) return guild.members.me;
  if (typeof guild?.members?.fetchMe === 'function') {
    return guild.members.fetchMe().catch(() => null);
  }
  return null;
}

function getMissingVoicePermissions(channel, botMember) {
  const permissions = channel?.permissionsFor?.(botMember);
  if (!permissions?.has) return ['ViewChannel', 'Connect'];

  const missing = [];
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('ViewChannel');
  if (!permissions.has(PermissionFlagsBits.Connect)) missing.push('Connect');
  return missing;
}

function shouldRetryStartupVoiceJoin(err, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  return RETRYABLE_STARTUP_CODES.has(String(err?.code || '').trim());
}

function shouldWarnForStartupVoiceJoinError(err) {
  return WARNING_STARTUP_CODES.has(String(err?.code || '').trim());
}

function logStartupVoiceWarning(logSystem, message) {
  logSystem(message, 'WARN');
}

function logStartupVoiceFailure(logError, err, extra = {}) {
  logError('startup_voice_auto_join_failed', err, extra);
}

async function attemptStartupVoiceJoin({
  client,
  guildId,
  channelId,
  trigger = 'startup',
  logSystem = () => {},
  logError = () => {},
  voiceManagerService = voiceManager,
  maxAttempts = 2,
  retryDelayMs = 1500,
}) {
  const guild = await resolveGuild(client, guildId);
  if (!guild) {
    logStartupVoiceWarning(
      logSystem,
      `Startup voice auto-join atlandi: guild bulunamadi (guild=${guildId}, channel=${channelId})`
    );
    return { ok: false, guildId, channelId, code: 'STARTUP_VOICE_GUILD_NOT_FOUND' };
  }

  const channel = await resolveChannel(guild, channelId);
  if (!channel) {
    logStartupVoiceWarning(
      logSystem,
      `Startup voice auto-join atlandi: kanal bulunamadi (guild=${guildId}, channel=${channelId})`
    );
    return { ok: false, guildId, channelId, code: 'STARTUP_VOICE_CHANNEL_NOT_FOUND' };
  }

  if (!isVoiceChannel(channel)) {
    logStartupVoiceWarning(
      logSystem,
      `Startup voice auto-join atlandi: hedef kanal ses kanali degil (guild=${guildId}, channel=${channelId})`
    );
    return { ok: false, guildId, channelId, code: 'STARTUP_VOICE_INVALID_CHANNEL_TYPE' };
  }

  const botMember = await resolveBotMember(guild);
  if (!botMember) {
    logStartupVoiceWarning(
      logSystem,
      `Startup voice auto-join atlandi: bot member resolve edilemedi (guild=${guildId}, channel=${channelId})`
    );
    return { ok: false, guildId, channelId, code: 'STARTUP_VOICE_BOT_MEMBER_NOT_FOUND' };
  }

  const missingPermissions = getMissingVoicePermissions(channel, botMember);
  if (missingPermissions.length > 0) {
    logStartupVoiceWarning(
      logSystem,
      `Startup voice auto-join atlandi: eksik izin (${missingPermissions.join(', ')}) (guild=${guildId}, channel=${channelId})`
    );
    return {
      ok: false,
      guildId,
      channelId,
      code: 'STARTUP_VOICE_PERMISSION_DENIED',
      missingPermissions,
    };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const connectResult = await voiceManagerService.connectToChannel({
        client,
        guildId,
        channelId,
        selfDeaf: true,
        context: {
          source: 'startup_voice_auto_join',
          trigger,
          startupAttempt: attempt,
        },
      });

      const status = connectResult?.status || null;
      if (!status?.connected || String(status.channelId || '') !== String(channelId)) {
        const err = new Error('Startup voice auto-join sonucu authoritative degil');
        err.code = 'STARTUP_VOICE_UNVERIFIED_SUCCESS';
        throw err;
      }

      logSystem(
        `Startup voice auto-join basarili: guild=${guildId}, channel=${channel.id} (${channel.name || 'unknown'})`,
        'INFO'
      );
      return {
        ok: true,
        guildId,
        channelId,
        attempts: attempt,
        status,
      };
    } catch (err) {
      lastError = err;

      if (shouldRetryStartupVoiceJoin(err, attempt, maxAttempts)) {
        logStartupVoiceWarning(
          logSystem,
          `Startup voice auto-join yeniden denenecek (${attempt + 1}/${maxAttempts}) (guild=${guildId}, channel=${channelId}, code=${String(err?.code || 'unknown')})`
        );
        await sleep(retryDelayMs);
        continue;
      }

      if (shouldWarnForStartupVoiceJoinError(err)) {
        logStartupVoiceWarning(
          logSystem,
          `Startup voice auto-join atlandi: ${err.message || 'baglanti kurulamadi'} (guild=${guildId}, channel=${channelId}, code=${String(err?.code || 'unknown')})`
        );
        return {
          ok: false,
          guildId,
          channelId,
          attempts: attempt,
          code: err?.code || 'STARTUP_VOICE_JOIN_FAILED',
          error: err,
        };
      }

      logStartupVoiceFailure(logError, err, {
        guildId,
        channelId,
        trigger,
        attempt,
        maxAttempts,
        code: err?.code || 'STARTUP_VOICE_JOIN_FAILED',
      });
      return {
        ok: false,
        guildId,
        channelId,
        attempts: attempt,
        code: err?.code || 'STARTUP_VOICE_JOIN_FAILED',
        error: err,
      };
    }
  }

  if (lastError) {
    logStartupVoiceFailure(logError, lastError, {
      guildId,
      channelId,
      trigger,
      maxAttempts,
      code: lastError?.code || 'STARTUP_VOICE_JOIN_FAILED',
    });
  }

  return {
    ok: false,
    guildId,
    channelId,
    attempts: maxAttempts,
    code: lastError?.code || 'STARTUP_VOICE_JOIN_FAILED',
    error: lastError,
  };
}

function createStartupVoiceAutoJoiner({
  client,
  logSystem = () => {},
  logError = () => {},
  voiceManagerService = voiceManager,
  maxAttempts = 2,
  retryDelayMs = 1500,
} = {}) {
  let runPromise = null;

  async function run({ trigger = 'startup' } = {}) {
    if (runPromise) return runPromise;

    runPromise = (async () => {
      const targets = collectStartupVoiceTargets(client);
      if (targets.length === 0) {
        logSystem('Startup voice auto-join atlandi: startup_voice_channel_id tanimli degil', 'INFO');
        return {
          ok: true,
          skipped: true,
          reason: 'not_configured',
          results: [],
        };
      }

      const results = [];
      for (const target of targets) {
        results.push(
          await attemptStartupVoiceJoin({
            client,
            guildId: target.guildId,
            channelId: target.channelId,
            trigger,
            logSystem,
            logError,
            voiceManagerService,
            maxAttempts,
            retryDelayMs,
          })
        );
      }

      return {
        ok: results.every((result) => result.ok),
        skipped: false,
        results,
      };
    })();

    return runPromise;
  }

  return {
    run,
  };
}

module.exports = {
  collectStartupVoiceGuildIds,
  collectStartupVoiceTargets,
  createStartupVoiceAutoJoiner,
  getMissingVoicePermissions,
  shouldWarnForStartupVoiceJoinError,
  shouldRetryStartupVoiceJoin,
  attemptStartupVoiceJoin,
};
