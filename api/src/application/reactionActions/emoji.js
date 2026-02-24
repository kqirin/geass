function normalizeUnicodeEmojiName(value) {
  return String(value || '')
    .trim()
    .normalize('NFC')
    .replace(/\uFE0E|\uFE0F/g, '');
}

function normalizeEmojiKey({ emojiType, emojiId, emojiName }) {
  if (emojiType === 'custom') return `custom:${String(emojiId || '').trim()}`;
  return `unicode:${normalizeUnicodeEmojiName(emojiName)}`;
}

function isReactionMatch(ruleLike, reaction) {
  if (!ruleLike || !reaction?.emoji) return false;
  if (ruleLike.emojiType === 'custom') return reaction.emoji.id === ruleLike.emojiId;
  return normalizeUnicodeEmojiName(reaction.emoji.name) === normalizeUnicodeEmojiName(ruleLike.emojiName);
}

module.exports = {
  normalizeUnicodeEmojiName,
  normalizeEmojiKey,
  isReactionMatch,
};
