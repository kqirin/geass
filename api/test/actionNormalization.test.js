const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeActionBucket } = require('../src/bot/services/actionNormalization');

test('action normalization maps command aliases to ortak bucket', () => {
  assert.equal(normalizeActionBucket('mute'), 'mute');
  assert.equal(normalizeActionBucket('timeout'), 'mute');
  assert.equal(normalizeActionBucket('unmute'), 'mute');
  assert.equal(normalizeActionBucket('ban'), 'ban');
  assert.equal(normalizeActionBucket('unban'), 'ban');
  assert.equal(normalizeActionBucket('kick'), 'kick');
  assert.equal(normalizeActionBucket('  vcunmute  '), 'vcmute');
});
