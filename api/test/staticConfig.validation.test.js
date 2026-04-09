const test = require('node:test');
const assert = require('node:assert/strict');

const configPath = require.resolve('../src/config');
const staticConfigPath = require.resolve('../src/config/static');
const validateStaticConfigPath = require.resolve('../src/bootstrap/validateStaticConfig');

function loadStaticModules(staticConfigJson, envOverrides = {}) {
  const originalStaticConfigJson = process.env.STATIC_SERVER_CONFIG_JSON;
  const originalEnv = {};
  for (const key of Object.keys(envOverrides)) {
    originalEnv[key] = process.env[key];
  }

  process.env.STATIC_SERVER_CONFIG_JSON = JSON.stringify(staticConfigJson);
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }

  delete require.cache[configPath];
  delete require.cache[staticConfigPath];
  delete require.cache[validateStaticConfigPath];

  const staticConfig = require(staticConfigPath);
  const validateStaticConfig = require(validateStaticConfigPath);
  return {
    staticConfig,
    validateStaticConfig,
    restore() {
      delete require.cache[configPath];
      delete require.cache[staticConfigPath];
      delete require.cache[validateStaticConfigPath];
      if (originalStaticConfigJson === undefined) delete process.env.STATIC_SERVER_CONFIG_JSON;
      else process.env.STATIC_SERVER_CONFIG_JSON = originalStaticConfigJson;
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

function createClientFixture() {
  const role = { id: '20001', name: 'Warn Staff' };
  const hubChannel = { id: '30001', type: 2 };
  const category = { id: '40001', type: 4 };
  const emojis = [
    { id: '1475922529930707045', name: 'rename' },
    { id: '1475922693747380245', name: 'lockOn' },
    { id: '1475922674344529971', name: 'lockOff' },
    { id: '1475922574314831912', name: 'hide' },
    { id: '1475922601728675892', name: 'show' },
    { id: '1475922712949031112', name: 'limit' },
    { id: '1475922652060319938', name: 'allow' },
    { id: '1475922735149351074', name: 'remove' },
    { id: '1475922552625958946', name: 'transfer' },
    { id: '1477268090453627012', name: 'delete' },
    { id: '50001', name: 'custom' },
  ];
  const emojiMap = new Map(emojis.map((emoji) => [emoji.id, emoji]));

  const guild = {
    id: '10001',
    roles: {
      cache: new Map([[role.id, role]]),
      fetch: async (id) => (String(id) === role.id ? role : null),
    },
    channels: {
      cache: new Map([
        [hubChannel.id, hubChannel],
        [category.id, category],
      ]),
      fetch: async (id) => {
        if (String(id) === hubChannel.id) return hubChannel;
        if (String(id) === category.id) return category;
        return null;
      },
    },
    emojis: {
      cache: emojiMap,
      fetch: async (id) => emojiMap.get(String(id)) || null,
    },
  };

  return {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
    emojis: {
      cache: emojiMap,
      fetch: async (id) => emojiMap.get(String(id)) || null,
    },
  };
}

test('authoritative settings ignore runtime overrides for static keys', () => {
  const { staticConfig, restore } = loadStaticModules({
    guilds: {
      '10001': {
        settings: {
          prefix: '!',
          warn_enabled: true,
          warn_role: '20001',
        },
      },
    },
  });

  try {
    const merged = staticConfig.buildAuthoritativeSettings('10001', {
      prefix: '?',
      warn_role: '99999',
      legacy_runtime_flag: 'x',
    });

    assert.equal(merged.prefix, '!');
    assert.equal(merged.warn_role, '20001');
    assert.equal(merged.legacy_runtime_flag, 'x');
  } finally {
    restore();
  }
});

test('static config validation fails on missing role bindings and duplicate emoji bindings', async () => {
  const { validateStaticConfig, restore } = loadStaticModules({
    guilds: {
      '10001': {
        settings: {
          warn_enabled: true,
          warn_role: '99999',
          private_vc_enabled: true,
          private_vc_hub_channel: '30001',
          private_vc_required_role: '20001',
          private_vc_category: '40001',
        },
        bindings: {
          emojis: {
            privateRoomPanel: {
              rename: '50001',
              lockOn: '50001',
            },
          },
        },
      },
    },
  });

  try {
    await assert.rejects(
      () => validateStaticConfig.validateStaticConfig(createClientFixture(), () => {}, () => {}),
      /Static config validation failed/i
    );
  } finally {
    restore();
  }
});

test('static config validation fails when required single-guild target config is missing', async () => {
  const { validateStaticConfig, restore } = loadStaticModules(
    {
      guilds: {
        '10001': {
          settings: {
            warn_enabled: true,
            warn_role: '20001',
          },
        },
      },
    },
    {
      TARGET_GUILD_ID: '20002',
      SINGLE_GUILD_ID: '20002',
    }
  );

  try {
    await assert.rejects(
      () => validateStaticConfig.validateStaticConfig(createClientFixture(), () => {}, () => {}),
      /Eksik static guild config: 20002/i
    );
  } finally {
    restore();
  }
});

test('static guild validation warns but does not fail when startup voice channel is invalid', async () => {
  const client = createClientFixture();
  const textChannel = { id: '60001', type: 0 };
  client.guilds.cache.get('10001').channels.cache.set(textChannel.id, textChannel);
  const warnings = [];

  const { validateStaticConfig, restore } = loadStaticModules({
    guilds: {
      '10001': {
        settings: {
          log_enabled: false,
          warn_enabled: true,
          warn_role: '20001',
          mute_enabled: false,
          kick_enabled: false,
          jail_enabled: false,
          ban_enabled: false,
          startup_voice_channel_id: '60001',
        },
      },
    },
  });

  try {
    const result = await validateStaticConfig.validateGuildStaticConfig(client, '10001');
    warnings.push(...result.warnings.map((message) => ({ message, level: 'WARN' })));
    assert.deepEqual(result.errors, []);
    assert.equal(
      warnings.some(
        (entry) =>
          entry.level === 'WARN' && /Startup voice channel ses kanali degil/i.test(entry.message)
      ),
      true
    );
  } finally {
    restore();
  }
});
