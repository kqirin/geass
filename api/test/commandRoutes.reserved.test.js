const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../src/utils/cache');
const { isReservedCommandName } = require('../src/interfaces/http/routes/commandRoutes');

test('reserved command guard blocks builtin names directly', () => {
  assert.equal(isReservedCommandName('guild-1', 'warn'), true);
  assert.equal(isReservedCommandName('guild-1', 'Ban'), true);
  assert.equal(isReservedCommandName('guild-1', 'LOCK'), true);
  assert.equal(isReservedCommandName('guild-1', 'durum'), true);
  assert.equal(isReservedCommandName('guild-1', 'custom-warn'), false);
  assert.equal(isReservedCommandName('guild-1', 'clear'), false);
});

test('reserved command guard blocks prefixed builtin aliases', () => {
  const originalGetSettings = cache.getSettings;
  cache.getSettings = () => ({ prefix: '?' });
  try {
    assert.equal(isReservedCommandName('guild-1', '.warn'), true);
    assert.equal(isReservedCommandName('guild-1', '/mute'), true);
    assert.equal(isReservedCommandName('guild-1', '?ban'), true);
    assert.equal(isReservedCommandName('guild-1', '?durum'), true);
    assert.equal(isReservedCommandName('guild-1', '.clear'), false);
    assert.equal(isReservedCommandName('guild-1', '?yardim'), true);
    assert.equal(isReservedCommandName('guild-1', '?yard\u0131m'), true);
  } finally {
    cache.getSettings = originalGetSettings;
  }
});
