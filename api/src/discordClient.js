const { Client, GatewayIntentBits, ActivityType, Options, Partials } = require('discord.js');
const { config } = require('./config');
const { getStaticBotPresence } = require('./config/static');
const embedCommand = require('./bot/commands/embed');
const { logDiag, serializeError } = require('./diagnostics');
const perfMonitor = require('./utils/perfMonitor');
const { createStartupVoiceAutoJoiner } = require('./voice/startupVoiceAutoJoiner');

const TARGET_GUILD_ID = config.discord.targetGuildId;
const STATIC_PRESENCE_TYPE_TO_DISCORD = Object.freeze({
  CUSTOM: ActivityType.Custom,
  PLAYING: ActivityType.Playing,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  COMPETING: ActivityType.Competing,
});

function createDiscordClient({
  cache,
  moderationBot,
  getReactionActionService = null,
  getTagRoleFeature = null,
  getPrivateRoomService = null,
  getBotPresenceManager = null,
  startupVoiceAutoJoiner = null,
  logSystem,
  logError = () => { },
}) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 25,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      GuildMemberManager: 200,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 120,
        lifetime: 120,
      },
      guildMembers: {
        interval: 900,
        filter: () => (member) => !member.voice?.channelId,
      },
    },
  });

  const traceDiscordEvent = (event, payload = {}, level = 'INFO') => {
    logDiag(`discord.${event}`, payload, level);
  };
  const resolvedStartupVoiceAutoJoiner =
    startupVoiceAutoJoiner || createStartupVoiceAutoJoiner({ client, logSystem, logError });

  client.on('error', (err) => {
    traceDiscordEvent(
      'error',
      {
        error: serializeError(err),
      },
      'ERROR'
    );
  });

  client.on('warn', (messageText) => {
    traceDiscordEvent(
      'warn',
      {
        message: String(messageText || '').slice(0, 1200),
      },
      'WARN'
    );
  });

  client.on('messageCreate', async (message) => {
    // B1: early return before any object allocation or tracing
    if (message.author.bot || !message.guild) return;
    if (TARGET_GUILD_ID && message.guild.id !== TARGET_GUILD_ID) return;

    perfMonitor.incCounter('messageCreate');
    traceDiscordEvent('messageCreate', {
      opId: message.id || null,
      guildId: message.guild.id,
      channelId: message.channel?.id || null,
      authorId: message.author.id,
    });

    try {
      if (moderationBot?.handlePrefix) {
        const builtinHandled = await moderationBot.handlePrefix(client, message);
        if (builtinHandled) return;
      }

      const customResponse = cache.getCustomCommand(
        message.guild.id,
        message.content,
        cache.getSettings?.(message.guild.id)?.prefix || '.'
      );
      if (customResponse) {
        await message.channel.send({
          content: customResponse,
          allowedMentions: { parse: [] },
        });
        return;
      }
    } catch (e) {
      logError('message_create_failed', e, {
        guildId: message.guild?.id,
        channelId: message.channel?.id,
        messageId: message.id,
      });
    }
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      const eventGuildId = reaction?.message?.guild?.id || reaction?.message?.guildId || null;
      if (!eventGuildId) return;
      if (TARGET_GUILD_ID && eventGuildId !== TARGET_GUILD_ID) return;
      const service = typeof getReactionActionService === 'function' ? getReactionActionService() : null;
      await service?.handleReactionEvent('ADD', reaction, user);
    } catch (e) {
      logError('reaction_add_failed', e, {
        guildId: reaction?.message?.guild?.id || reaction?.message?.guildId,
        messageId: reaction?.message?.id,
        userId: user?.id,
      });
    }
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    try {
      const eventGuildId = reaction?.message?.guild?.id || reaction?.message?.guildId || null;
      if (!eventGuildId) return;
      if (TARGET_GUILD_ID && eventGuildId !== TARGET_GUILD_ID) return;
      const service = typeof getReactionActionService === 'function' ? getReactionActionService() : null;
      await service?.handleReactionEvent('REMOVE', reaction, user);
    } catch (e) {
      logError('reaction_remove_failed', e, {
        guildId: reaction?.message?.guild?.id || reaction?.message?.guildId,
        messageId: reaction?.message?.id,
        userId: user?.id,
      });
    }
  });

  client.on('guildMemberAdd', async (member) => {
    if (!member?.guild) return;
    if (TARGET_GUILD_ID && member.guild.id !== TARGET_GUILD_ID) return;

    try {
      const feature = typeof getTagRoleFeature === 'function' ? getTagRoleFeature() : null;
      await feature?.syncTagRole(member, 'guildMemberAdd');
    } catch (e) {
      logError('tag_role_member_add_failed', e, {
        guildId: member?.guild?.id,
        userId: member?.id,
      });
    }
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!newMember?.guild) return;
    if (TARGET_GUILD_ID && newMember.guild.id !== TARGET_GUILD_ID) return;

    try {
      const feature = typeof getTagRoleFeature === 'function' ? getTagRoleFeature() : null;
      await feature?.syncTagRole(newMember, 'guildMemberUpdate');
    } catch (e) {
      logError('tag_role_member_update_failed', e, {
        guildId: newMember?.guild?.id,
        userId: newMember?.id,
      });
    }
  });

  client.on('userUpdate', async (oldUser, newUser) => {
    try {
      if (!newUser?.id) return;
      const feature = typeof getTagRoleFeature === 'function' ? getTagRoleFeature() : null;
      if (!feature?.syncTagRole) return;

      const hintedGuildIds = new Set(
        [
          oldUser?.primaryGuild?.identityGuildId,
          newUser?.primaryGuild?.identityGuildId,
        ]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      );

      const guilds = TARGET_GUILD_ID
        ? [client.guilds.cache.get(TARGET_GUILD_ID)].filter(Boolean)
        : [...client.guilds.cache.values()].filter(
            (guild) => hintedGuildIds.has(guild.id) || guild.members?.cache?.has?.(newUser.id)
          );

      for (const guild of guilds) {
        const cachedMember = guild.members.cache.get(newUser.id) || null;
        const shouldFetch = !cachedMember && hintedGuildIds.has(guild.id);
        const member = cachedMember || (shouldFetch ? await guild.members.fetch(newUser.id).catch(() => null) : null);
        if (!member) continue;
        await feature.syncTagRole(member, 'userUpdate');
      }
    } catch (e) {
      logError('tag_role_user_update_failed', e, {
        userId: newUser?.id,
      });
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    traceDiscordEvent('voiceStateUpdate', {
      opId: `${newState?.id || oldState?.id || 'unknown'}:${newState?.sessionId || oldState?.sessionId || 'na'}`,
      guildId: newState?.guild?.id || oldState?.guild?.id || null,
      userId: newState?.id || oldState?.id || null,
      oldChannelId: oldState?.channelId || null,
      newChannelId: newState?.channelId || null,
    });

    try {
      const guildId = newState?.guild?.id || oldState?.guild?.id;
      if (!guildId) return;
      if (TARGET_GUILD_ID && guildId !== TARGET_GUILD_ID) return;

      const service = typeof getPrivateRoomService === 'function' ? getPrivateRoomService() : null;
      await service?.handleVoiceStateUpdate(oldState, newState);
    } catch (e) {
      logError('private_room_voice_state_listener_failed', e, {
        guildId: newState?.guild?.id || oldState?.guild?.id,
        oldChannelId: oldState?.channelId || null,
        newChannelId: newState?.channelId || null,
      });
    }
  });

  client.on('interactionCreate', async (interaction) => {
    traceDiscordEvent('interactionCreate', {
      opId: interaction?.id || null,
      guildId: interaction?.guildId || null,
      channelId: interaction?.channelId || null,
      userId: interaction?.user?.id || null,
      interactionType: interaction?.type || null,
      customId: interaction?.customId || null,
    });

    try {
      if (!interaction?.inGuild?.() || !interaction.guildId) return;
      if (TARGET_GUILD_ID && interaction.guildId !== TARGET_GUILD_ID) return;

      // Route embed-builder interactions first
      const cid = interaction.customId || '';
      if (cid.startsWith('em_btn_') || cid.startsWith('em_mod_')) {
        await embedCommand.handleInteraction(interaction);
        return;
      }

      const service = typeof getPrivateRoomService === 'function' ? getPrivateRoomService() : null;
      await service?.handleInteraction(interaction);
    } catch (e) {
      logError('interaction_listener_failed', e, {
        guildId: interaction?.guildId,
        customId: interaction?.customId,
        interactionType: interaction?.type,
      });
    }
  });

  let readyHandled = false;
  const onReady = async (c) => {
    if (readyHandled) return;
    readyHandled = true;
    const staticBotPresence = getStaticBotPresence();
    const fallbackPresenceType =
      STATIC_PRESENCE_TYPE_TO_DISCORD[staticBotPresence.type] || ActivityType.Custom;

    traceDiscordEvent('ready', {
      userId: c.user?.id || null,
      userTag: c.user?.tag || null,
      guildCount: c.guilds?.cache?.size || 0,
    });

    try {
      if (cache?.loadAllCustomCommands) await cache.loadAllCustomCommands();
    } catch (err) {
      logError('cache_bootstrap_failed', err);
    }

    const botPresenceManager =
      typeof getBotPresenceManager === 'function' ? getBotPresenceManager() : null;
    if (botPresenceManager?.bootstrapAndApply) {
      const result = await botPresenceManager.bootstrapAndApply('startup');
      if (!result?.applyResult?.ok) {
        logSystem('Bot presence startup apply basarisiz, varsayilan activity kullaniliyor', 'WARN');
        if (!staticBotPresence.enabled) {
          c.user.setPresence({ activities: [], status: 'online' });
        } else {
          c.user.setActivity(staticBotPresence.text, { type: fallbackPresenceType });
        }
      }
    } else {
      if (!staticBotPresence.enabled) {
        c.user.setPresence({ activities: [], status: 'online' });
      } else {
        c.user.setActivity(staticBotPresence.text, { type: fallbackPresenceType });
      }
    }

    logSystem(
      `========================================\n[READY] ${c.user.tag} BOT & PANEL HAZIR!\n========================================`,
      'SUCCESS'
    );

    await resolvedStartupVoiceAutoJoiner?.run?.({
      trigger: 'discord_ready',
      userId: c.user?.id || null,
    });
  };

  client.once('clientReady', onReady);
  client.once('ready', onReady);

  return client;
}

module.exports = { createDiscordClient };
