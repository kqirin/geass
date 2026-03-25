const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const configPath = require.resolve('../src/config');
const staticConfigPath = require.resolve('../src/config/static');
const startupVoiceAutoJoinerPath = require.resolve('../src/voice/startupVoiceAutoJoiner');

function loadStartupVoiceAutoJoiner(staticConfigJson, envOverrides = {}) {
  const originalStaticConfigJson = process.env.STATIC_SERVER_CONFIG_JSON;
  const originalEnv = {};

  for (const [key, value] of Object.entries(envOverrides)) {
    originalEnv[key] = process.env[key];
    if (value === undefined || value === null) process.env[key] = '';
    else process.env[key] = String(value);
  }

  process.env.STATIC_SERVER_CONFIG_JSON = JSON.stringify(staticConfigJson);
  delete require.cache[configPath];
  delete require.cache[staticConfigPath];
  delete require.cache[startupVoiceAutoJoinerPath];

  const startupVoiceAutoJoiner = require(startupVoiceAutoJoinerPath);
  return {
    startupVoiceAutoJoiner,
    restore() {
      delete require.cache[configPath];
      delete require.cache[staticConfigPath];
      delete require.cache[startupVoiceAutoJoinerPath];
      if (originalStaticConfigJson === undefined) delete process.env.STATIC_SERVER_CONFIG_JSON;
      else process.env.STATIC_SERVER_CONFIG_JSON = originalStaticConfigJson;

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

function createVoiceChannel({ id = '30001', type = ChannelType.GuildVoice, allowConnect = true } = {}) {
  return {
    id: String(id),
    name: `voice-${id}`,
    type,
    permissionsFor() {
      return {
        has(permission) {
          if (permission === PermissionFlagsBits.ViewChannel) return true;
          if (permission === PermissionFlagsBits.Connect) return allowConnect;
          return true;
        },
      };
    },
  };
}

function createClientFixture({ guildId = '10001', channels = [] } = {}) {
  const channelMap = new Map(channels.map((channel) => [String(channel.id), channel]));
  const botMember = { id: 'bot-1' };
  const guild = {
    id: String(guildId),
    members: {
      me: botMember,
      fetchMe: async () => botMember,
    },
    channels: {
      cache: {
        get: (channelId) => channelMap.get(String(channelId)) || null,
      },
      fetch: async (channelId) => channelMap.get(String(channelId)) || null,
    },
  };

  return {
    guild,
    client: {
      guilds: {
        cache: new Map([[guild.id, guild]]),
        fetch: async (id) => (String(id) === guild.id ? guild : null),
      },
    },
  };
}

function createLogs() {
  return {
    info: [],
    warn: [],
    error: [],
    logSystem(message, level = 'INFO') {
      if (level === 'WARN') this.warn.push(String(message));
      else this.info.push(String(message));
    },
    logError(context, err, extra = {}) {
      this.error.push({
        context,
        code: err?.code || null,
        message: err?.message || String(err),
        extra,
      });
    },
  };
}

test('startup auto-join attempts a connect when startup_voice_channel_id is configured', async () => {
  const channel = createVoiceChannel({ id: '30001' });
  const fixture = createClientFixture({ channels: [channel] });
  const calls = [];
  const logs = createLogs();
  const { startupVoiceAutoJoiner, restore } = loadStartupVoiceAutoJoiner(
    {
      guilds: {
        '10001': {
          settings: {
            startup_voice_channel_id: '30001',
          },
        },
      },
    },
    {
      TARGET_GUILD_ID: '10001',
      STARTUP_VOICE_CHANNEL_ID: null,
    }
  );

  try {
    const joiner = startupVoiceAutoJoiner.createStartupVoiceAutoJoiner({
      client: fixture.client,
      logSystem: logs.logSystem.bind(logs),
      logError: logs.logError.bind(logs),
      voiceManagerService: {
        connectToChannel: async (input) => {
          calls.push(input);
          return {
            status: {
              connected: true,
              channelId: '30001',
              channelName: channel.name,
              connectionState: 'ready',
            },
          };
        },
      },
    });

    const result = await joiner.run({ trigger: 'test' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].guildId, '10001');
    assert.equal(calls[0].channelId, '30001');
    assert.equal(result.ok, true);
  } finally {
    restore();
  }
});

test('startup auto-join uses env fallback when guild static value is null', async () => {
  const channel = createVoiceChannel({ id: '1473942048137547917' });
  const fixture = createClientFixture({
    guildId: '1471242450386550835',
    channels: [channel],
  });
  const calls = [];
  const logs = createLogs();
  const { startupVoiceAutoJoiner, restore } = loadStartupVoiceAutoJoiner(
    {
      guilds: {
        '1471242450386550835': {
          settings: {
            startup_voice_channel_id: null,
          },
        },
      },
    },
    {
      TARGET_GUILD_ID: '1471242450386550835',
      STARTUP_VOICE_CHANNEL_ID: '1473942048137547917',
    }
  );

  try {
    const joiner = startupVoiceAutoJoiner.createStartupVoiceAutoJoiner({
      client: fixture.client,
      logSystem: logs.logSystem.bind(logs),
      logError: logs.logError.bind(logs),
      voiceManagerService: {
        connectToChannel: async (input) => {
          calls.push(input);
          return {
            status: {
              connected: true,
              channelId: '1473942048137547917',
              channelName: channel.name,
              connectionState: 'ready',
            },
          };
        },
      },
    });

    const result = await joiner.run({ trigger: 'test' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].guildId, '1471242450386550835');
    assert.equal(calls[0].channelId, '1473942048137547917');
    assert.equal(result.ok, true);
  } finally {
    restore();
  }
});

test('startup auto-join logs a warning and does not crash when the configured channel is missing', async () => {
  const fixture = createClientFixture();
  const logs = createLogs();
  const { startupVoiceAutoJoiner, restore } = loadStartupVoiceAutoJoiner(
    {
      guilds: {
        '10001': {
          settings: {
            startup_voice_channel_id: '39999',
          },
        },
      },
    },
    {
      TARGET_GUILD_ID: '10001',
    }
  );

  try {
    const result = await startupVoiceAutoJoiner.attemptStartupVoiceJoin({
      client: fixture.client,
      guildId: '10001',
      channelId: '39999',
      logSystem: logs.logSystem.bind(logs),
      logError: logs.logError.bind(logs),
      voiceManagerService: {
        connectToChannel: async () => {
          throw new Error('should_not_connect');
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'STARTUP_VOICE_CHANNEL_NOT_FOUND');
    assert.equal(logs.warn.some((entry) => entry.includes('kanal bulunamadi')), true);
    assert.equal(logs.error.length, 0);
  } finally {
    restore();
  }
});

test('startup auto-join logs a warning and does not crash when connect permission is missing', async () => {
  const channel = createVoiceChannel({ id: '30001', allowConnect: false });
  const fixture = createClientFixture({ channels: [channel] });
  const logs = createLogs();
  const { startupVoiceAutoJoiner, restore } = loadStartupVoiceAutoJoiner(
    {
      guilds: {
        '10001': {
          settings: {
            startup_voice_channel_id: '30001',
          },
        },
      },
    },
    {
      TARGET_GUILD_ID: '10001',
    }
  );

  try {
    let connectCalls = 0;
    const result = await startupVoiceAutoJoiner.attemptStartupVoiceJoin({
      client: fixture.client,
      guildId: '10001',
      channelId: '30001',
      logSystem: logs.logSystem.bind(logs),
      logError: logs.logError.bind(logs),
      voiceManagerService: {
        connectToChannel: async () => {
          connectCalls += 1;
          return null;
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'STARTUP_VOICE_PERMISSION_DENIED');
    assert.equal(connectCalls, 0);
    assert.equal(logs.warn.some((entry) => entry.includes('eksik izin')), true);
  } finally {
    restore();
  }
});

test('startup auto-join returns success status and emits a clean info log on verified join', async () => {
  const channel = createVoiceChannel({ id: '30001' });
  const fixture = createClientFixture({ channels: [channel] });
  const logs = createLogs();
  const { startupVoiceAutoJoiner, restore } = loadStartupVoiceAutoJoiner(
    {
      guilds: {
        '10001': {
          settings: {
            startup_voice_channel_id: '30001',
          },
        },
      },
    },
    {
      TARGET_GUILD_ID: '10001',
    }
  );

  try {
    const result = await startupVoiceAutoJoiner.attemptStartupVoiceJoin({
      client: fixture.client,
      guildId: '10001',
      channelId: '30001',
      logSystem: logs.logSystem.bind(logs),
      logError: logs.logError.bind(logs),
      voiceManagerService: {
        connectToChannel: async () => ({
          status: {
            connected: true,
            channelId: '30001',
            channelName: channel.name,
            connectionState: 'ready',
          },
        }),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status.connected, true);
    assert.equal(result.status.channelId, '30001');
    assert.equal(logs.info.some((entry) => entry.includes('Startup voice auto-join basarili')), true);
    assert.equal(logs.error.length, 0);
  } finally {
    restore();
  }
});
