export function normalizeIdList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/[^\d]/g, ''))
    .filter(Boolean);
}

export function getUserLabel(user) {
  return user?.displayName || user?.username || user?.name || user?.id;
}

