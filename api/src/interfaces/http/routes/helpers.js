const MAX_MEMBER_SEARCH_QUERY = 32;
const MAX_COMMAND_NAME_LEN = 32;
const MAX_COMMAND_RESPONSE_LEN = 500;
const MAX_EMBED_TEXT_LEN = 2000;
const MAX_CONTENT_TEXT_LEN = 2000;
const MAX_IMAGE_URL_LEN = 512;

function isSnowflake(value) {
  return /^\d{5,32}$/.test(String(value || '').trim());
}

function toSnowflakeOrNull(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return isSnowflake(raw) ? raw : null;
}

function pickAllowedSettings(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  for (const [k, v] of Object.entries(input)) {
    if (k === 'guild_id') continue;
    if (!/^[a-zA-Z0-9_]+$/.test(k)) continue;
    out[k] = v;
  }

  return out;
}

function truncate(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function isValidHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  if (raw.length > MAX_IMAGE_URL_LEN) return false;

  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = {
  MAX_MEMBER_SEARCH_QUERY,
  MAX_COMMAND_NAME_LEN,
  MAX_COMMAND_RESPONSE_LEN,
  MAX_EMBED_TEXT_LEN,
  MAX_CONTENT_TEXT_LEN,
  isSnowflake,
  toSnowflakeOrNull,
  pickAllowedSettings,
  truncate,
  isValidHttpUrl,
};

