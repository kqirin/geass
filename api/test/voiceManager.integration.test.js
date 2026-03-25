const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClientFixture({ guildId = 'guild-voice-1' } = {}) {
  const channels = new Map();
  const guild = {
    id: String(guildId),
    voiceAdapterCreator: () => ({ sendPayload: () => true, destroy: () => {} }),
    channels: {
      cache: {
        get: (id) => channels.get(String(id)) || null,
      },
      fetch: async (id) => channels.get(String(id)) || null,
    },
    members: {
      me: {
        voice: {
          channelId: null,
        },
      },
    },
  };
  let fetchMeImpl = async () => ({
    voice: {
      channelId: guild.members.me.voice.channelId,
    },
  });
  guild.members.fetchMe = async () => {
    const member = await fetchMeImpl();
    const channelId = member?.voice?.channelId ? String(member.voice.channelId) : null;
    guild.members.me.voice.channelId = channelId;
    return {
      voice: {
        channelId,
      },
    };
  };

  const guilds = new Map([[guild.id, guild]]);

  const client = {
    guilds: {
      cache: guilds,
      fetch: async (id) => guilds.get(String(id)) || null,
    },
  };

  function addVoiceChannel(id) {
    const channel = {
      id: String(id),
      type: 2,
      name: `voice-${id}`,
    };
    channels.set(channel.id, channel);
    return channel;
  }

  return {
    client,
    guild,
    addVoiceChannel,
    setBotVoiceChannel(channelId) {
      guild.members.me.voice.channelId = channelId ? String(channelId) : null;
    },
    setFetchMeImpl(nextImpl) {
      fetchMeImpl = typeof nextImpl === 'function' ? nextImpl : fetchMeImpl;
    },
  };
}

function createVoiceMock(voiceLib, { readyDelayMs = 0, failReadyOnJoin = false } = {}) {
  const status = voiceLib.VoiceConnectionStatus;
  const connectionByGuild = new Map();
  const created = [];
  const destroyed = [];

  let sequence = 0;

  class FakeConnection extends EventEmitter {
    constructor({ guildId, channelId }) {
      super();
      this.id = ++sequence;
      this.joinConfig = {
        guildId: String(guildId),
        channelId: String(channelId),
      };
      this.state = { status: status.Connecting };
      this.failReady = false;
      this.failReconnect = false;
      this.destroyCalls = 0;
    }

    emitDisconnected() {
      const oldState = this.state;
      this.state = { status: status.Disconnected };
      this.emit('stateChange', oldState, this.state);
      this.emit(status.Disconnected);
    }

    destroy() {
      this.destroyCalls += 1;
      if (this.state?.status === status.Destroyed) return;
      const oldState = this.state;
      this.state = { status: status.Destroyed };
      connectionByGuild.delete(this.joinConfig.guildId);
      destroyed.push({
        id: this.id,
        guildId: this.joinConfig.guildId,
        channelId: this.joinConfig.channelId,
      });
      this.emit('stateChange', oldState, this.state);
      this.emit(status.Destroyed);
    }
  }

  function transition(connection, nextStatus) {
    if (connection.state?.status === nextStatus) return;
    const oldState = connection.state;
    connection.state = { status: nextStatus };
    connection.emit('stateChange', oldState, connection.state);
  }

  async function entersState(connection, targetStatus) {
    if (targetStatus === status.Ready) {
      if (readyDelayMs > 0) await wait(readyDelayMs);
      if (connection.failReady) throw new Error('ready_failed');
      transition(connection, status.Ready);
      return connection;
    }

    if (targetStatus === status.Signalling || targetStatus === status.Connecting) {
      if (connection.failReconnect) throw new Error('reconnect_failed');
      transition(connection, targetStatus);
      return connection;
    }

    transition(connection, targetStatus);
    return connection;
  }

  function joinVoiceChannel({ guildId, channelId }) {
    const connection = new FakeConnection({ guildId, channelId });
    if (failReadyOnJoin) {
      connection.failReady = true;
    }
    connectionByGuild.set(String(guildId), connection);
    created.push({
      id: connection.id,
      guildId: String(guildId),
      channelId: String(channelId),
      connection,
    });
    return connection;
  }

  function getVoiceConnection(guildId) {
    return connectionByGuild.get(String(guildId)) || null;
  }

  return {
    created,
    destroyed,
    joinVoiceChannel,
    getVoiceConnection,
    entersState,
    getConnection(guildId) {
      return connectionByGuild.get(String(guildId)) || null;
    },
    reset() {
      connectionByGuild.clear();
      created.length = 0;
      destroyed.length = 0;
      sequence = 0;
    },
  };
}

function setupVoiceManagerHarness(opts = {}) {
  const envKeys = [
    'VOICE_CONNECT_READY_TIMEOUT_MS',
    'VOICE_CONNECT_VERIFY_ATTEMPTS',
    'VOICE_CONNECT_VERIFY_RETRY_DELAY_MS',
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  if (opts.connectReadyTimeoutMs != null) {
    process.env.VOICE_CONNECT_READY_TIMEOUT_MS = String(opts.connectReadyTimeoutMs);
  } else {
    delete process.env.VOICE_CONNECT_READY_TIMEOUT_MS;
  }
  if (opts.verifyAttempts != null) {
    process.env.VOICE_CONNECT_VERIFY_ATTEMPTS = String(opts.verifyAttempts);
  } else {
    delete process.env.VOICE_CONNECT_VERIFY_ATTEMPTS;
  }
  if (opts.verifyRetryDelayMs != null) {
    process.env.VOICE_CONNECT_VERIFY_RETRY_DELAY_MS = String(opts.verifyRetryDelayMs);
  } else {
    delete process.env.VOICE_CONNECT_VERIFY_RETRY_DELAY_MS;
  }

  const voiceLib = require('@discordjs/voice');
  const mock = createVoiceMock(voiceLib, opts);

  const mockedVoiceModule = {
    ...voiceLib,
    joinVoiceChannel: mock.joinVoiceChannel,
    getVoiceConnection: mock.getVoiceConnection,
    entersState: mock.entersState,
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@discordjs/voice') return mockedVoiceModule;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[require.resolve('../src/voice/voiceManager')];
  const voiceManager = require('../src/voice/voiceManager');
  Module._load = originalLoad;

  function teardown() {
    voiceManager.__internal.reset();
    mock.reset();
    delete require.cache[require.resolve('../src/voice/voiceManager')];
    for (const key of envKeys) {
      if (previousEnv[key] == null) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }

  return {
    voiceManager,
    mock,
    teardown,
  };
}

test('voice manager integration: join -> noop -> leave cleans state', async () => {
  const { voiceManager, mock, teardown } = setupVoiceManagerHarness();
  const fixture = createClientFixture();
  const guildId = fixture.guild.id;
  const ch1 = fixture.addVoiceChannel('2001');

  try {
    const first = await voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch1.id,
      selfDeaf: true,
      context: { source: 'test', case: 'join' },
    });
    assert.equal(first.ok, true);
    assert.equal(first.status.connected, true);
    assert.equal(first.status.channelId, ch1.id);
    assert.equal(mock.created.length, 1);

    const second = await voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch1.id,
      selfDeaf: true,
      context: { source: 'test', case: 'noop' },
    });
    assert.equal(second.ok, true);
    assert.equal(second.reused, true);
    assert.equal(mock.created.length, 1);

    const connectedStatus = voiceManager.getStatus(guildId, fixture.client);
    assert.equal(connectedStatus.connected, true);
    assert.equal(connectedStatus.channelId, ch1.id);

    await voiceManager.disconnect({ guildId, context: { source: 'test', case: 'leave' } });

    const disconnectedStatus = voiceManager.getStatus(guildId, fixture.client);
    assert.equal(disconnectedStatus.connected, false);
    assert.equal(voiceManager.__internal.getActiveConnection(guildId), null);
    assert.equal(voiceManager.__internal.getState(guildId), null);
    await wait(0);
    assert.equal(voiceManager.__internal.getQueueSize(), 0);
  } finally {
    teardown();
  }
});

test('voice manager integration: move and parallel join serialize safely', async () => {
  const { voiceManager, mock, teardown } = setupVoiceManagerHarness({ readyDelayMs: 20 });
  const fixture = createClientFixture();
  const guildId = fixture.guild.id;
  const ch1 = fixture.addVoiceChannel('2101');
  const ch2 = fixture.addVoiceChannel('2102');

  try {
    const p1 = voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch1.id,
      selfDeaf: true,
      context: { source: 'test', case: 'parallel_1' },
    });
    const p2 = voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch2.id,
      selfDeaf: true,
      context: { source: 'test', case: 'parallel_2' },
    });

    await Promise.all([p1, p2]);

    assert.equal(mock.created.length, 2);
    assert.equal(mock.destroyed.some((entry) => entry.channelId === ch1.id), true);
    const status = voiceManager.getStatus(guildId, fixture.client);
    assert.equal(status.connected, true);
    assert.equal(status.channelId, ch2.id);
    await wait(0);
    assert.equal(voiceManager.__internal.getQueueSize(), 0);
  } finally {
    teardown();
  }
});

test('voice manager integration: reconnect recovery and failed reconnect cleanup', async () => {
  const { voiceManager, mock, teardown } = setupVoiceManagerHarness();
  const fixture = createClientFixture();
  const guildId = fixture.guild.id;
  const ch1 = fixture.addVoiceChannel('2201');

  try {
    await voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch1.id,
      selfDeaf: true,
      context: { source: 'test', case: 'reconnect_base' },
    });

    const connection = mock.getConnection(guildId);
    assert.ok(connection);

    connection.emitDisconnected();
    await wait(0);

    assert.equal(connection.destroyCalls, 0);
    assert.equal(voiceManager.__internal.getActiveConnection(guildId), connection);

    connection.failReconnect = true;
    connection.failReady = true;
    connection.emitDisconnected();
    await wait(0);

    assert.equal(connection.destroyCalls >= 1, true);
    assert.equal(voiceManager.__internal.getActiveConnection(guildId), null);
    assert.equal(voiceManager.getStatus(guildId, fixture.client).connected, false);
  } finally {
    teardown();
  }
});

test('voice manager integration: connect fallback succeeds when bot voice state confirms channel', async () => {
  const { voiceManager, mock, teardown } = setupVoiceManagerHarness({ failReadyOnJoin: true });
  const fixture = createClientFixture();
  const guildId = fixture.guild.id;
  const ch1 = fixture.addVoiceChannel('2301');

  try {
    fixture.setBotVoiceChannel(ch1.id);

    const result = await voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch1.id,
      selfDeaf: true,
      context: { source: 'test', case: 'ready_fallback' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.fallbackReady, true);
    assert.equal(mock.destroyed.length, 0);

    const status = voiceManager.getStatus(guildId, fixture.client);
    assert.equal(status.connected, true);
    assert.equal(status.channelId, ch1.id);
  } finally {
    teardown();
  }
});

test('voice manager integration: connect verify retries recover an initial false-negative', async () => {
  const { voiceManager, mock, teardown } = setupVoiceManagerHarness({
    failReadyOnJoin: true,
    verifyAttempts: 4,
    verifyRetryDelayMs: 10,
  });
  const fixture = createClientFixture();
  const guildId = fixture.guild.id;
  const ch1 = fixture.addVoiceChannel('2401');

  try {
    fixture.setFetchMeImpl(async () => ({
      voice: {
        channelId: fixture.guild.members.me.voice.channelId,
      },
    }));
    setTimeout(() => {
      fixture.setBotVoiceChannel(ch1.id);
    }, 15);

    const result = await voiceManager.connectToChannel({
      client: fixture.client,
      guildId,
      channelId: ch1.id,
      selfDeaf: true,
      context: { source: 'test', case: 'verify_retry_success' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.fallbackReady, true);
    assert.equal(result.verifyAttempts > 1, true);
    assert.equal(result.status.connected, true);
    assert.equal(result.status.channelId, ch1.id);
    assert.equal(mock.destroyed.length, 0);
    assert.equal(voiceManager.getStatus(guildId, fixture.client).connected, true);
  } finally {
    teardown();
  }
});

test('voice manager integration: connect fails honestly when verify retries exhaust', async () => {
  const { voiceManager, teardown } = setupVoiceManagerHarness({
    failReadyOnJoin: true,
    verifyAttempts: 2,
    verifyRetryDelayMs: 10,
  });
  const fixture = createClientFixture();
  const guildId = fixture.guild.id;
  const ch1 = fixture.addVoiceChannel('2501');

  try {
    await assert.rejects(
      voiceManager.connectToChannel({
        client: fixture.client,
        guildId,
        channelId: ch1.id,
        selfDeaf: true,
        context: { source: 'test', case: 'verify_retry_failure' },
      }),
      (err) => {
        assert.equal(err.code, 'VOICE_CONNECT_VERIFY_FAILED');
        return true;
      }
    );

    const status = voiceManager.getStatus(guildId, fixture.client);
    assert.equal(status.connected, false);
    assert.equal(voiceManager.__internal.getActiveConnection(guildId), null);
  } finally {
    teardown();
  }
});
