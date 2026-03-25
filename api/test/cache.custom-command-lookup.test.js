const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../src/utils/cache');

test('custom command lookup normalizes case and surrounding spaces', () => {
  cache.upsertCustomCommand('guild-1', 'selam', 'merhaba');

  try {
    assert.equal(cache.getCustomCommand('guild-1', '  SELAM  '), 'merhaba');
  } finally {
    cache.removeCustomCommand('guild-1', 'selam');
  }
});

test('custom command lookup matches configured prefix form without breaking exact-match semantics', () => {
  cache.upsertCustomCommand('guild-2', 'selam', 'merhaba');

  try {
    assert.equal(cache.getCustomCommand('guild-2', '.selam', '.'), 'merhaba');
    assert.equal(cache.getCustomCommand('guild-2', 'selam ek', '.'), null);
  } finally {
    cache.removeCustomCommand('guild-2', 'selam');
  }
});
