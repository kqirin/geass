const ACTION_BUCKET_ALIASES = new Map([
  ['log', 'log'],
  ['warn', 'warn'],
  ['mute', 'mute'],
  ['unmute', 'mute'],
  ['timeout', 'mute'],
  ['untimeout', 'mute'],
  ['kick', 'kick'],
  ['jail', 'jail'],
  ['unjail', 'jail'],
  ['ban', 'ban'],
  ['unban', 'ban'],
  ['vcmute', 'vcmute'],
  ['vcunmute', 'vcmute'],
  ['lock', 'lock'],
  ['unlock', 'lock'],
]);

function toActionKey(rawAction) {
  return String(rawAction || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeActionBucket(rawAction) {
  const key = toActionKey(rawAction);
  if (!key) return null;
  return ACTION_BUCKET_ALIASES.get(key) || key;
}

module.exports = {
  normalizeActionBucket,
};
