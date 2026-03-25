const test = require('node:test');
const assert = require('node:assert/strict');

const cachePath = require.resolve('../src/utils/cache');

function loadFreshCache() {
  delete require.cache[cachePath];
  const cache = require(cachePath);
  cache.__clearRateLimitStateForTests();
  return cache;
}

test('rate-limit cache no longer exports DB startup restore hook', () => {
  const cache = loadFreshCache();
  assert.equal(Object.prototype.hasOwnProperty.call(cache, 'loadActiveRateLimits'), false);
});

test('moderation rate limit state resets after a simulated process restart', async () => {
  const firstBootCache = loadFreshCache();

  const consumed = await firstBootCache.consumeLimit('guild-restart', 'user-restart', 'jail', 1, '');
  assert.equal(consumed.allowed, true);

  const blockedBeforeRestart = await firstBootCache.checkLimit('guild-restart', 'user-restart', 'jail', 1, '');
  assert.equal(blockedBeforeRestart.allowed, false);

  const secondBootCache = loadFreshCache();
  const allowedAfterRestart = await secondBootCache.checkLimit('guild-restart', 'user-restart', 'jail', 1, '');
  assert.equal(allowedAfterRestart.allowed, true);
});
