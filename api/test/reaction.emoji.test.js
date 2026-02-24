const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUnicodeEmojiName,
  normalizeEmojiKey,
  isReactionMatch,
} = require('../src/application/reactionActions/emoji');

test('normalizeUnicodeEmojiName should remove variation selector and normalize NFC', () => {
  assert.equal(normalizeUnicodeEmojiName('✅️'), '✅');
  assert.equal(normalizeUnicodeEmojiName('  ✅  '), '✅');
});

test('normalizeEmojiKey should build stable keys for unicode/custom', () => {
  assert.equal(normalizeEmojiKey({ emojiType: 'unicode', emojiName: '✅️', emojiId: null }), 'unicode:✅');
  assert.equal(
    normalizeEmojiKey({ emojiType: 'custom', emojiName: 'ok', emojiId: '1234567890' }),
    'custom:1234567890'
  );
});

test('isReactionMatch should match both unicode and custom reactions', () => {
  const unicodeRule = { emojiType: 'unicode', emojiName: '✅️' };
  const unicodeReaction = { emoji: { name: '✅', id: null } };
  assert.equal(isReactionMatch(unicodeRule, unicodeReaction), true);

  const customRule = { emojiType: 'custom', emojiId: '42' };
  const customReaction = { emoji: { id: '42', name: 'myemoji' } };
  assert.equal(isReactionMatch(customRule, customReaction), true);
});
