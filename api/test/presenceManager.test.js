const test = require('node:test');
const assert = require('node:assert/strict');

const presenceManagerPath = require.resolve('../src/bot/presenceManager');

function loadPresenceManager(staticConfigJson = null) {
  const staticConfigPath = require.resolve('../src/config/static');
  const originalStaticConfigJson = process.env.STATIC_SERVER_CONFIG_JSON;

  if (staticConfigJson === null) delete process.env.STATIC_SERVER_CONFIG_JSON;
  else process.env.STATIC_SERVER_CONFIG_JSON = JSON.stringify(staticConfigJson);

  delete require.cache[presenceManagerPath];
  delete require.cache[staticConfigPath];

  const loaded = require(presenceManagerPath);
  return {
    ...loaded,
    restore() {
      delete require.cache[presenceManagerPath];
      delete require.cache[staticConfigPath];
      if (originalStaticConfigJson === undefined) delete process.env.STATIC_SERVER_CONFIG_JSON;
      else process.env.STATIC_SERVER_CONFIG_JSON = originalStaticConfigJson;
    },
  };
}

test('normalizeBotPresenceSettings sanitizes text and falls back to allowed type', () => {
  const { normalizeBotPresenceSettings, restore } = loadPresenceManager();

  try {
    const normalized = normalizeBotPresenceSettings({
      enabled: '1',
      type: 'invalid',
      text: '  test\u0000status \n with \t spaces ',
    });

    assert.equal(normalized.enabled, true);
    assert.equal(normalized.type, 'CUSTOM');
    assert.equal(normalized.text, 'test status with spaces');
  } finally {
    restore();
  }
});

test('validateBotPresenceSettings rejects empty enabled text', () => {
  const { validateBotPresenceSettings, restore } = loadPresenceManager();

  try {
    const result = validateBotPresenceSettings({
      enabled: true,
      type: 'CUSTOM',
      text: '   ',
    });

    assert.equal(result.ok, false);
    assert.match(String(result.error || ''), /bos olamaz/i);
  } finally {
    restore();
  }
});

test('validateBotPresenceSettings rejects invalid type values', () => {
  const { validateBotPresenceSettings, restore } = loadPresenceManager();

  try {
    const result = validateBotPresenceSettings({
      enabled: true,
      type: 'NOT_A_TYPE',
      text: 'ok',
    });

    assert.equal(result.ok, false);
    assert.match(String(result.error || ''), /turu gecersiz/i);
  } finally {
    restore();
  }
});

test('bot presence manager loads static config, applies it at startup, and exposes no legacy write shims', async () => {
  const { createBotPresenceManager, restore } = loadPresenceManager({
    botPresence: {
      enabled: true,
      type: 'WATCHING',
      text: 'Config kaynakli durum',
    },
  });

  const calls = [];
  const client = {
    isReady: () => true,
    user: {
      setActivity: (text, options) => calls.push({ kind: 'activity', text, options }),
      setPresence: (presence) => calls.push({ kind: 'presence', presence }),
    },
  };

  try {
    const manager = createBotPresenceManager({
      client,
      minApplyIntervalMs: 0,
      logSystem: () => {},
      logError: () => {},
    });

    const current = await manager.loadCurrentSettings();
    assert.equal(current.text, 'Config kaynakli durum');

    const bootstrapResult = await manager.bootstrapAndApply('test_startup');
    assert.equal(bootstrapResult.settings.text, 'Config kaynakli durum');
    const lastActivity = calls.filter((entry) => entry.kind === 'activity').at(-1);
    assert.equal(lastActivity.text, 'Config kaynakli durum');
    assert.equal(typeof manager.handleDashboardSaveAttempt, 'undefined');
    assert.equal(typeof manager.saveAndApply, 'undefined');
    assert.equal(typeof manager.loadFromConfig, 'undefined');
    assert.equal(typeof manager.loadFromDatabase, 'undefined');
    assert.equal(calls.filter((entry) => entry.kind === 'activity').length, 1);
    manager.shutdown();
  } finally {
    restore();
  }
});
