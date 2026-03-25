const test = require('node:test');
const assert = require('node:assert/strict');

const { createDiscordClient } = require('../src/discordClient');
const { config } = require('../src/config');

function buildGuild() {
  return {
    id: config.discord.targetGuildId || 'guild-1',
  };
}

test('discord client prioritizes builtin moderation commands over custom commands', async () => {
  let customLookups = 0;
  const cache = {
    getCustomCommand: () => {
      customLookups += 1;
      return 'custom-response';
    },
  };

  let moderationCalls = 0;
  const moderationBot = {
    handlePrefix: async () => {
      moderationCalls += 1;
      return true;
    },
  };

  let channelSends = 0;
  const message = {
    author: { bot: false },
    guild: buildGuild(),
    content: '.warn @uye flood',
    channel: {
      send: async () => {
        channelSends += 1;
      },
    },
  };

  const client = createDiscordClient({
    cache,
    moderationBot,
    getPrivateRoomService: () => ({ handleMessageCreate: async () => false }),
    logSystem: () => {},
    logError: () => {},
  });
  const handler = client.listeners('messageCreate')[0];

  await handler(message);

  assert.equal(moderationCalls, 1);
  assert.equal(customLookups, 0);
  assert.equal(channelSends, 0);
  client.destroy();
});

test('discord client uses custom command when builtin moderation does not handle message', async () => {
  const cache = {
    getCustomCommand: () => 'custom-response',
  };

  const moderationBot = {
    handlePrefix: async () => false,
  };

  let channelSends = 0;
  let sentPayload = null;
  const message = {
    author: { bot: false },
    guild: buildGuild(),
    content: '.selam',
    channel: {
      send: async (payload) => {
        channelSends += 1;
        sentPayload = payload;
      },
    },
  };

  const client = createDiscordClient({
    cache,
    moderationBot,
    getPrivateRoomService: () => ({ handleMessageCreate: async () => false }),
    logSystem: () => {},
    logError: () => {},
  });
  const handler = client.listeners('messageCreate')[0];

  await handler(message);

  assert.equal(channelSends, 1);
  assert.equal(sentPayload.content, 'custom-response');
  client.destroy();
});

test('discord client runs startup voice auto-join only after the ready handler fires', async () => {
  let autoJoinCalls = 0;
  const startupVoiceAutoJoiner = {
    run: async ({ trigger }) => {
      autoJoinCalls += 1;
      assert.equal(trigger, 'discord_ready');
    },
  };

  const client = createDiscordClient({
    cache: {},
    moderationBot: {},
    getPrivateRoomService: () => ({ handleMessageCreate: async () => false }),
    startupVoiceAutoJoiner,
    logSystem: () => {},
    logError: () => {},
  });

  Object.defineProperty(client, 'user', {
    configurable: true,
    value: {
      id: 'bot-1',
      tag: 'bot#0001',
      setActivity() {},
      setPresence() {},
    },
  });

  const readyHandler = client.listeners('clientReady')[0];
  await readyHandler(client);

  assert.equal(autoJoinCalls, 1);
  client.destroy();
});
