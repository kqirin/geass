const META_KEYS = new Set(['success', 'error', 'requestId']);

export function extractModerationSettingsPayload(payload) {
  const candidate =
    payload && typeof payload === 'object' && !Array.isArray(payload) && payload.settings && typeof payload.settings === 'object'
      ? payload.settings
      : payload;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !META_KEYS.has(String(key || '')))
  );
}
