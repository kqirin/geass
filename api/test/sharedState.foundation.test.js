const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemoryKeyValueStore } = require('../src/sharedState/memoryStore');
const { createRedisKeyValueStore } = require('../src/sharedState/redisStore');
const {
  createSharedStateBackendSelector,
} = require('../src/sharedState/stateBackendSelector');
const {
  createSessionRepositoryFromStateStore,
} = require('../src/controlPlane/sessionRepository');
const {
  createOauthStateStoreFromStateStore,
} = require('../src/controlPlane/oauthStateStore');

function createMockRedisClient({ shouldFailConnect = false } = {}) {
  const entries = new Map();

  function readEntry(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    const expiresAtMs = Number(entry.expiresAtMs || 0);
    if (expiresAtMs > 0 && expiresAtMs <= Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  const client = {
    on: () => {},
    connect: async () => {
      if (shouldFailConnect) {
        const error = new Error('connect_failed');
        error.reasonCode = 'redis_connect_failed';
        throw error;
      }
    },
    set: async (key, value, options = {}) => {
      const ttlMs = Number(options?.PX || 0);
      entries.set(key, {
        value,
        expiresAtMs: Number.isFinite(ttlMs) && ttlMs > 0 ? Date.now() + ttlMs : null,
      });
      return 'OK';
    },
    get: async (key) => readEntry(key)?.value || null,
    del: async (key) => (entries.delete(key) ? 1 : 0),
    sendCommand: async (command = []) => {
      const action = String(command[0] || '').toUpperCase();
      const key = String(command[1] || '');
      if (action !== 'GETDEL') throw new Error('unsupported_command');
      const value = await client.get(key);
      await client.del(key);
      return value;
    },
    multi: () => {
      const operations = [];
      const chain = {
        get(key) {
          operations.push(['get', key]);
          return chain;
        },
        del(key) {
          operations.push(['del', key]);
          return chain;
        },
        async exec() {
          const output = [];
          for (const operation of operations) {
            if (operation[0] === 'get') {
              output.push(await client.get(operation[1]));
              continue;
            }
            if (operation[0] === 'del') {
              output.push(await client.del(operation[1]));
            }
          }
          return output;
        },
      };
      return chain;
    },
    quit: async () => {},
    disconnect: async () => {},
  };

  return client;
}

test('memory shared-state adapter supports ttl and getAndDelete semantics', async () => {
  let now = Date.parse('2026-04-11T00:00:00.000Z');
  const store = createMemoryKeyValueStore({
    nowFn: () => now,
  });

  await store.set('alpha', { value: 1 }, { ttlMs: 1000 });
  assert.deepEqual(await store.get('alpha'), { value: 1 });

  now += 1500;
  assert.equal(await store.get('alpha'), null);

  await store.set('beta', 'payload');
  assert.equal(await store.getAndDelete('beta'), 'payload');
  assert.equal(await store.getAndDelete('beta'), null);
});

test('redis shared-state adapter works with a mocked redis client', async () => {
  const mockClient = createMockRedisClient();
  const store = createRedisKeyValueStore({
    redisUrl: 'redis://shared-state.local:6379',
    keyPrefix: 'cp:test',
    redisClientFactory: () => mockClient,
  });

  await store.set('key-1', { active: true }, { ttlMs: 1000 });
  assert.deepEqual(await store.get('key-1'), { active: true });
  assert.deepEqual(await store.getAndDelete('key-1'), { active: true });
  assert.equal(await store.get('key-1'), null);
});

test('shared-state selector falls back to memory mode when redis connect fails', async () => {
  const selector = createSharedStateBackendSelector({
    sharedStateConfig: {
      enabled: true,
      provider: 'redis',
      redis: {
        url: 'redis://unavailable.shared-state.local:6379',
        keyPrefix: 'cp:test',
        fallbackToMemory: true,
      },
    },
    redisClientFactory: () => createMockRedisClient({ shouldFailConnect: true }),
  });

  await selector.store.set('fallback-key', 'memory-value');
  assert.equal(await selector.store.get('fallback-key'), 'memory-value');

  const summary = selector.getSummary();
  assert.equal(summary.enabled, true);
  assert.equal(summary.requestedProvider, 'redis');
  assert.equal(summary.activeProvider, 'memory');
  assert.equal(summary.fallbackUsed, true);
  assert.equal(summary.reasonCode, 'redis_connect_failed');
});

test('session and oauth state repositories operate on the shared adapter contract', async () => {
  const store = createMemoryKeyValueStore();
  const randomBytesFn = () => Buffer.alloc(24, 7);

  const sessionRepository = createSessionRepositoryFromStateStore({
    stateStore: store,
    sessionTtlMs: 30 * 60 * 1000,
    randomBytesFn,
  });
  const session = await sessionRepository.createSession({
    principal: { type: 'discord_user', id: '123', provider: 'discord_oauth' },
  });
  assert.equal(typeof session.id, 'string');
  assert.equal(Boolean(session.summary?.createdAt), true);
  assert.equal(Boolean(await sessionRepository.getSessionById(session.id)), true);
  assert.equal(await sessionRepository.deleteSessionById(session.id), true);
  assert.equal(await sessionRepository.getSessionById(session.id), null);

  const oauthStateStore = createOauthStateStoreFromStateStore({
    stateStore: store,
    stateTtlMs: 60 * 1000,
    randomBytesFn,
  });
  const stateRecord = await oauthStateStore.createState();
  assert.equal(typeof stateRecord.state, 'string');
  const consumed = await oauthStateStore.consumeState(stateRecord.state);
  assert.equal(consumed.ok, true);
  const consumedAgain = await oauthStateStore.consumeState(stateRecord.state);
  assert.equal(consumedAgain.ok, false);
  assert.equal(consumedAgain.reasonCode, 'state_not_found');
});
