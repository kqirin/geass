const { Client, GatewayIntentBits, ActivityType, Options, Partials } = require('discord.js');
const { config } = require('./config');

const TARGET_GUILD_ID = config.discord.targetGuildId;

function createDiscordClient({
  cache,
  moderationBot,
  getWeeklyStaffTracker = null,
  getReactionActionService = null,
  getTagRoleFeature = null,
  getPrivateRoomService = null,
  logSystem,
  logError = () => {},
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
      MessageManager: 100,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      GuildMemberManager: 1000,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 300,
        lifetime: 600,
      },
      guildMembers: {
        interval: 900,
        filter: () => (member) => !member.voice?.channelId,
      },
    },
  });

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (TARGET_GUILD_ID && message.guild.id !== TARGET_GUILD_ID) return;

      const privateRoomService = typeof getPrivateRoomService === 'function' ? getPrivateRoomService() : null;
      const privateHandled = await privateRoomService?.handleMessageCreate?.(message);
      if (privateHandled) return;

      const customResponse = cache.getCustomCommand(message.guild.id, message.content);
      if (customResponse) {
        await message.channel.send({
          content: customResponse,
          allowedMentions: { parse: [] },
        });
        const weeklyStaffTracker = typeof getWeeklyStaffTracker === 'function' ? getWeeklyStaffTracker() : null;
        if (weeklyStaffTracker?.trackEvent) {
          const commandName = `custom:${String(message.content || '').slice(0, 32).toLowerCase()}`;
          await weeklyStaffTracker.trackEvent({
            guildId: message.guild.id,
            userId: message.author.id,
            eventType: 'command',
            commandName,
            occurredAt: Date.now(),
            metadata: { source: 'custom_command' },
          });
        }
        return;
      }

      if (moderationBot?.handlePrefix) {
        await moderationBot.handlePrefix(client, message);
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
    try {
      if (!member?.guild) return;
      if (TARGET_GUILD_ID && member.guild.id !== TARGET_GUILD_ID) return;
      const feature = typeof getTagRoleFeature === 'function' ? getTagRoleFeature() : null;
      await feature?.syncTagRole(member, 'guildMemberAdd');
    } catch (e) {
      logError('tag_role_member_add_failed', e, {
        guildId: member?.guild?.id,
        userId: member?.id,
      });
    }
  });

  client.on('guildMemberUpdate', async (_oldMember, newMember) => {
    try {
      if (!newMember?.guild) return;
      if (TARGET_GUILD_ID && newMember.guild.id !== TARGET_GUILD_ID) return;
      const feature = typeof getTagRoleFeature === 'function' ? getTagRoleFeature() : null;
      await feature?.syncTagRole(newMember, 'guildMemberUpdate');
    } catch (e) {
      logError('tag_role_member_update_failed', e, {
        guildId: newMember?.guild?.id,
        userId: newMember?.id,
      });
    }
  });

  client.on('userUpdate', async (_oldUser, newUser) => {
    try {
      if (!newUser?.id) return;
      const feature = typeof getTagRoleFeature === 'function' ? getTagRoleFeature() : null;
      if (!feature?.syncTagRole) return;

      const guilds = TARGET_GUILD_ID
        ? [client.guilds.cache.get(TARGET_GUILD_ID)].filter(Boolean)
        : [...client.guilds.cache.values()];

      for (const guild of guilds) {
        const member = guild.members.cache.get(newUser.id) || (await guild.members.fetch(newUser.id).catch(() => null));
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
    try {
      if (!interaction?.inGuild?.() || !interaction.guildId) return;
      if (TARGET_GUILD_ID && interaction.guildId !== TARGET_GUILD_ID) return;

      const service = typeof getPrivateRoomService === 'function' ? getPrivateRoomService() : null;
      await service?.handleInteraction(interaction);
    } catch (e) {
      logError('private_room_interaction_listener_failed', e, {
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

    try {
      if (cache?.loadAllSettings) await cache.loadAllSettings();
      if (cache?.loadAllCustomCommands) await cache.loadAllCustomCommands();
      if (cache?.loadAllMessageTemplates) await cache.loadAllMessageTemplates();
    } catch (err) {
      logError('cache_bootstrap_failed', err);
    }

    c.user.setActivity('Sou da yo. Kirin wa, Kirin da kara.', { type: ActivityType.Custom });
    logSystem(
      `========================================\n[READY] ${c.user.tag} BOT & PANEL HAZIR!\n========================================`,
      'SUCCESS'
    );
  };

  client.once('clientReady', onReady);
  client.once('ready', onReady);

  return client;
}

module.exports = { createDiscordClient };

