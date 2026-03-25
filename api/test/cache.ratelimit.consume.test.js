const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../src/utils/cache');

function loadCacheWithDbMock(dbMock) {
  const cachePath = require.resolve('../src/utils/cache');
  const dbPath = require.resolve('../src/database');
  const originalCacheModule = require.cache[cachePath];
  const originalDbModule = require.cache[dbPath];

  delete require.cache[cachePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbMock,
  };

  const loadedCache = require(cachePath);
  return {
    cache: loadedCache,
    restore() {
      delete require.cache[cachePath];
      if (originalCacheModule) require.cache[cachePath] = originalCacheModule;
      if (originalDbModule) require.cache[dbPath] = originalDbModule;
      else delete require.cache[dbPath];
    },
  };
}

test.beforeEach(() => {
  cache.__clearRateLimitStateForTests();
});

test('consumeLimit allows only one concurrent action when limit is 1', async () => {
  const [first, second] = await Promise.all([
    cache.consumeLimit('guild-1', 'user-1', 'ban', 1, ''),
    cache.consumeLimit('guild-1', 'user-1', 'ban', 1, ''),
  ]);

  const results = [first, second];
  assert.equal(results.filter((entry) => entry.allowed === true).length, 1);
  assert.equal(results.filter((entry) => entry.allowed === false).length, 1);
});

test('consumeLimit does not overspend the same actor lock bucket under concurrency', async () => {
  const [first, second] = await Promise.all([
    cache.consumeLimit('guild-lock', 'user-lock', 'lock', 1, ''),
    cache.consumeLimit('guild-lock', 'user-lock', 'lock', 1, ''),
  ]);

  const results = [first, second];
  assert.equal(results.filter((entry) => entry.allowed === true).length, 1);
  assert.equal(results.filter((entry) => entry.allowed === false).length, 1);
  assert.equal(results.find((entry) => entry.allowed === true)?.key, 'guild-lock_user-lock_lock');
});

test('releaseLimit returns in-memory capacity to the same bucket', async () => {
  const first = await cache.consumeLimit('guild-release', 'user-release', 'mute', 1, '');
  assert.equal(first.allowed, true);

  const blocked = await cache.consumeLimit('guild-release', 'user-release', 'mute', 1, '');
  assert.equal(blocked.allowed, false);

  const release = await cache.releaseLimit(first.key);
  assert.equal(release.ok, true);
  assert.equal(release.released, 1);

  const retried = await cache.consumeLimit('guild-release', 'user-release', 'mute', 1, '');
  assert.equal(retried.allowed, true);
});

test('moderation rate limit checks do not touch the database layer', async () => {
  const dbMock = {
    execute: async () => {
      throw new Error('rate_limit_should_not_hit_db_execute');
    },
    getConnection: async () => {
      throw new Error('rate_limit_should_not_hit_db_connection');
    },
    end: async () => {},
    isPostgres: true,
  };
  const { cache: isolatedCache, restore } = loadCacheWithDbMock(dbMock);

  try {
    isolatedCache.__clearRateLimitStateForTests();

    const first = await isolatedCache.consumeLimit('guild-db', 'user-db', 'kick', 1, '');
    const second = await isolatedCache.checkLimit('guild-db', 'user-db', 'kick', 1, '');

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, false);
  } finally {
    restore();
  }
});
