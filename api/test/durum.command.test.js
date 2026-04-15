const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  getSharedBotSettingsRepository,
  setSharedBotSettingsRepositoryForTests,
} = require('../src/controlPlane/botSettingsRepository');

let durumCommand = null;

function loadCommand() {
  delete require.cache[require.resolve('../src/bot/commands/durum')];
  durumCommand = require('../src/bot/commands/durum');
}

function unloadCommand() {
  delete require.cache[require.resolve('../src/bot/commands/durum')];
  durumCommand = null;
}

function createPermissions(isAdmin) {
  return {
    has: (permission) => {
      if (permission === PermissionFlagsBits.Administrator || permission === 'Administrator') {
        return Boolean(isAdmin);
      }
      return false;
    },
  };
}

function createMessage({
  isAdmin = true,
  guildIconUrl = 'https://cdn.example.com/guild-icon.png',
  botAvatarUrl = 'https://cdn.example.com/bot-avatar.png',
} = {}) {
  const state = {
    deletedSource: false,
    sentPayloads: [],
    scheduledDelete: null,
  };

  const sentMessage = {
    delete: async () => {
      state.deletedReply = true;
    },
  };

  const message = {
    author: {
      id: 'actor-1',
      username: 'actor-user',
    },
    member: {
      permissions: createPermissions(isAdmin),
    },
    guild: {
      id: 'guild-1',
      name: 'Test Sunucu',
      iconURL: () => guildIconUrl,
      members: {
        fetch: async () => null,
      },
    },
    client: {
      uptime: ((3 * 24 + 6) * 60 + 12) * 60 * 1000,
      ws: { ping: 42 },
      user: {
        displayAvatarURL: () => botAvatarUrl,
      },
    },
    channel: {
      send: async (payload) => {
        state.sentPayloads.push(payload);
        return sentMessage;
      },
    },
    delete: async () => {
      state.deletedSource = true;
    },
  };

  return { message, state };
}

test.beforeEach(() => {
  setSharedBotSettingsRepositoryForTests();
  loadCommand();
});

test.afterEach(() => {
  setSharedBotSettingsRepositoryForTests();
  unloadCommand();
});

test('durum command rejects non-admin users with a temporary error embed', async () => {
  const { message, state } = createMessage({ isAdmin: false });
  let metricsCollected = 0;

  durumCommand.__internal.collectStatusMetrics = async () => {
    metricsCollected += 1;
    return {
      memoryUsage: '0 MB',
      cpuUsage: '%0,0',
      ping: '0 ms',
      uptime: '0 dakika',
    };
  };
  durumCommand.__internal.scheduleMessageDelete = (_sentMessage, ttlMs) => {
    state.scheduledDelete = ttlMs;
  };

  await durumCommand.run({ message });

  assert.equal(state.deletedSource, true);
  assert.equal(metricsCollected, 0);
  assert.equal(state.sentPayloads.length, 1);
  assert.equal(state.scheduledDelete, durumCommand.__internal.STATUS_MESSAGE_TTL_MS);

  const embedJson = state.sentPayloads[0].embeds[0].toJSON();
  assert.equal(embedJson.title, 'Eri\u015fim Reddedildi');
  assert.match(
    String(embedJson.description || ''),
    /yaln\u0131zca y\u00f6netici yetkisine sahip kullan\u0131c\u0131lar/i
  );
  assert.equal(embedJson.thumbnail?.url, 'https://cdn.example.com/guild-icon.png');
});

test('durum command sends a short-lived status embed for administrators', async () => {
  const { message, state } = createMessage({ isAdmin: true });

  durumCommand.__internal.collectStatusMetrics = async () => ({
    memoryUsage: '128,4 MB',
    cpuUsage: '%12,3',
    ping: '42 ms',
    uptime: '3 gün 6 saat 12 dakika',
  });
  durumCommand.__internal.scheduleMessageDelete = (_sentMessage, ttlMs) => {
    state.scheduledDelete = ttlMs;
  };

  await durumCommand.run({ message });

  assert.equal(state.deletedSource, true);
  assert.equal(state.sentPayloads.length, 1);
  assert.equal(state.scheduledDelete, durumCommand.__internal.STATUS_MESSAGE_TTL_MS);

  const embedJson = state.sentPayloads[0].embeds[0].toJSON();
  assert.equal(embedJson.title, 'Test Sunucu \u2022 Bot Durum');
  assert.match(String(embedJson.description || ''), /RAM Kullan\u0131m\u0131: 128,4 MB/i);
  assert.match(String(embedJson.description || ''), /CPU Kullan\u0131m\u0131: %12,3/i);
  assert.match(String(embedJson.description || ''), /Ping: 42 ms/i);
  assert.match(String(embedJson.description || ''), /Uptime: 3 g\u00fcn 6 saat 12 dakika/i);
  assert.equal(embedJson.thumbnail?.url, 'https://cdn.example.com/guild-icon.png');
});

test('durum command uses bot avatar as thumbnail fallback when guild icon is unavailable', async () => {
  const { message, state } = createMessage({
    isAdmin: true,
    guildIconUrl: null,
    botAvatarUrl: 'https://cdn.example.com/fallback-bot-avatar.png',
  });

  durumCommand.__internal.collectStatusMetrics = async () => ({
    memoryUsage: '64 MB',
    cpuUsage: '%1,0',
    ping: '5 ms',
    uptime: '12 dakika',
  });
  durumCommand.__internal.scheduleMessageDelete = (_sentMessage, ttlMs) => {
    state.scheduledDelete = ttlMs;
  };

  await durumCommand.run({ message });

  assert.equal(state.sentPayloads.length, 1);
  assert.equal(state.scheduledDelete, durumCommand.__internal.STATUS_MESSAGE_TTL_MS);

  const embedJson = state.sentPayloads[0].embeds[0].toJSON();
  assert.equal(embedJson.thumbnail?.url, 'https://cdn.example.com/fallback-bot-avatar.png');
});

test('durum command uses compact presentation when guild detail mode is configured', async () => {
  const { message, state } = createMessage({ isAdmin: true });
  const botSettingsRepository = getSharedBotSettingsRepository();
  await botSettingsRepository.upsertByGuildId({
    actorId: 'actor-1',
    guildId: 'guild-1',
    patch: {
      statusCommand: {
        detailMode: 'compact',
      },
    },
  });

  durumCommand.__internal.collectStatusMetrics = async () => ({
    memoryUsage: '512 MB',
    cpuUsage: '%25,0',
    ping: '18 ms',
    uptime: '1 saat 4 dakika',
  });
  durumCommand.__internal.scheduleMessageDelete = (_sentMessage, ttlMs) => {
    state.scheduledDelete = ttlMs;
  };

  await durumCommand.run({ message });

  assert.equal(state.sentPayloads.length, 1);
  assert.equal(state.scheduledDelete, durumCommand.__internal.STATUS_MESSAGE_TTL_MS);

  const embedJson = state.sentPayloads[0].embeds[0].toJSON();
  assert.match(String(embedJson.description || ''), /Ping: 18 ms/i);
  assert.match(String(embedJson.description || ''), /Uptime: 1 saat 4 dakika/i);
  assert.doesNotMatch(String(embedJson.description || ''), /RAM Kullanımı/i);
  assert.doesNotMatch(String(embedJson.description || ''), /CPU Kullanımı/i);
});
