const { ActivityType } = require('discord.js');
const { getStaticBotPresence } = require('../config/static');

const BOT_PRESENCE_TEXT_MAX = 128;
const BOT_PRESENCE_MIN_APPLY_INTERVAL_MS = 15_000;
const BOT_PRESENCE_ALLOWED_TYPES = Object.freeze([
  'CUSTOM',
  'PLAYING',
  'LISTENING',
  'WATCHING',
  'COMPETING',
]);
const BOT_PRESENCE_DEFAULTS = getStaticBotPresence();

const BOT_PRESENCE_TYPE_TO_DISCORD = Object.freeze({
  CUSTOM: ActivityType.Custom,
  PLAYING: ActivityType.Playing,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  COMPETING: ActivityType.Competing,
});

function toBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return fallback;
}

function normalizePresenceWhitespace(value) {
  if (value === null || value === undefined) return '';
  const source = String(value);
  let cleaned = '';
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    cleaned += code <= 31 || code === 127 ? ' ' : source[i];
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function sanitizeBotPresenceText(value, maxLen = BOT_PRESENCE_TEXT_MAX) {
  return normalizePresenceWhitespace(value).slice(0, maxLen);
}

function normalizeBotPresenceSettings(input, fallback = BOT_PRESENCE_DEFAULTS) {
  const source = input && typeof input === 'object' ? input : {};

  const enabled = toBoolean(source.enabled, toBoolean(fallback.enabled, true));

  const rawType = String(source.type ?? source.activityType ?? source.activity_type ?? fallback.type ?? '')
    .trim()
    .toUpperCase();
  const type = BOT_PRESENCE_ALLOWED_TYPES.includes(rawType) ? rawType : fallback.type;

  const hasText =
    Object.prototype.hasOwnProperty.call(source, 'text') ||
    Object.prototype.hasOwnProperty.call(source, 'activityText') ||
    Object.prototype.hasOwnProperty.call(source, 'activity_text');
  const rawText = hasText ? source.text ?? source.activityText ?? source.activity_text : fallback.text;
  const text = sanitizeBotPresenceText(rawText);

  return { enabled, type, text };
}

function validateBotPresenceSettings(input, fallback = BOT_PRESENCE_DEFAULTS) {
  const source = input && typeof input === 'object' ? input : {};
  const settings = normalizeBotPresenceSettings(input, fallback);
  const rawType = source.type ?? source.activityType ?? source.activity_type;
  if (rawType !== undefined) {
    const normalizedRawType = String(rawType).trim().toUpperCase();
    if (!BOT_PRESENCE_ALLOWED_TYPES.includes(normalizedRawType)) {
      return { ok: false, error: 'Durum turu gecersiz', settings };
    }
  }

  if (!BOT_PRESENCE_ALLOWED_TYPES.includes(settings.type)) {
    return { ok: false, error: 'Durum turu gecersiz', settings };
  }

  const rawText =
    source.text ??
    source.activityText ??
    source.activity_text ??
    settings.text;
  const normalizedRawText = normalizePresenceWhitespace(rawText);

  if (normalizedRawText.length > BOT_PRESENCE_TEXT_MAX) {
    return { ok: false, error: `Durum metni en fazla ${BOT_PRESENCE_TEXT_MAX} karakter olabilir`, settings };
  }

  if (settings.enabled && normalizedRawText.length === 0) {
    return { ok: false, error: 'Durum metni bos olamaz. Kapatmak icin durum ozelligini devre disi birakin.', settings };
  }

  return { ok: true, settings };
}

function createBotPresenceManager({
  client,
  logSystem = () => {},
  logError = () => {},
  minApplyIntervalMs = BOT_PRESENCE_MIN_APPLY_INTERVAL_MS,
  settingsLoader = () => getStaticBotPresence(),
} = {}) {
  let cachedSettings = { ...BOT_PRESENCE_DEFAULTS };
  let loaded = false;
  let loadPromise = null;

  let lastAppliedSignature = '';
  let lastAppliedAt = 0;
  let pendingSettings = null;
  let pendingTimer = null;

  function loadStaticSettings() {
    try {
      return normalizeBotPresenceSettings(settingsLoader(), BOT_PRESENCE_DEFAULTS);
    } catch (err) {
      logError('bot_presence_static_load_failed', err);
      return { ...BOT_PRESENCE_DEFAULTS };
    }
  }

  function getMeta() {
    return {
      maxTextLength: BOT_PRESENCE_TEXT_MAX,
      minApplyIntervalMs,
      allowedTypes: [...BOT_PRESENCE_ALLOWED_TYPES],
      readOnly: true,
      source: 'config',
    };
  }

  function getSettings() {
    return { ...cachedSettings };
  }

  function buildSignature(settings) {
    return `${settings.enabled ? '1' : '0'}|${settings.type}|${settings.text}`;
  }

  function clearPendingTimer() {
    if (!pendingTimer) return;
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function canApplyNow() {
    return Boolean(client?.isReady?.() && client?.user);
  }

  async function applyDirect(settings, reason = 'runtime_update', { force = false } = {}) {
    const next = normalizeBotPresenceSettings(settings, cachedSettings);
    cachedSettings = next;

    const signature = buildSignature(next);
    if (!force && signature === lastAppliedSignature) {
      return { ok: true, applied: false, skipped: true, queued: false };
    }

    if (!canApplyNow()) {
      return { ok: false, applied: false, skipped: false, queued: false, code: 'client_not_ready' };
    }

    try {
      if (!next.enabled) {
        client.user.setPresence({ activities: [], status: 'online' });
      } else {
        client.user.setActivity(next.text, { type: BOT_PRESENCE_TYPE_TO_DISCORD[next.type] });
      }

      lastAppliedSignature = signature;
      lastAppliedAt = Date.now();
      logSystem(
        `Bot presence uygulandi: enabled=${next.enabled ? 1 : 0} type=${next.type} textLen=${next.text.length} reason=${reason}`,
        'INFO'
      );
      return { ok: true, applied: true, skipped: false, queued: false };
    } catch (err) {
      logError('bot_presence_apply_failed', err, {
        enabled: next.enabled ? 1 : 0,
        type: next.type,
        textLen: next.text.length,
        reason,
      });
      return { ok: false, applied: false, skipped: false, queued: false, code: 'discord_apply_failed' };
    }
  }

  function scheduleApply(delayMs, reason = 'runtime_update') {
    const safeDelay = Math.max(200, Number(delayMs) || 0);
    if (pendingTimer) return;

    pendingTimer = setTimeout(() => {
      const next = pendingSettings;
      pendingSettings = null;
      pendingTimer = null;
      if (!next) return;
      applyDirect(next, `${reason}:queued`, { force: true }).catch((err) => {
        logError('bot_presence_queued_apply_failed', err, { reason });
      });
    }, safeDelay);
    if (typeof pendingTimer.unref === 'function') pendingTimer.unref();
  }

  async function applySettings(settings, reason = 'runtime_update', { force = false } = {}) {
    const next = normalizeBotPresenceSettings(settings, cachedSettings);
    cachedSettings = next;

    const signature = buildSignature(next);
    if (!force && signature === lastAppliedSignature) {
      return { ok: true, applied: false, skipped: true, queued: false };
    }

    const now = Date.now();
    const elapsed = now - lastAppliedAt;
    if (!force && elapsed < minApplyIntervalMs) {
      pendingSettings = next;
      scheduleApply(minApplyIntervalMs - elapsed, reason);
      return {
        ok: true,
        applied: false,
        skipped: false,
        queued: true,
        retryInMs: minApplyIntervalMs - elapsed,
      };
    }

    return applyDirect(next, reason, { force });
  }

  async function loadCurrentSettings({ force = false } = {}) {
    if (loaded && !force) return getSettings();
    if (loadPromise && !force) return loadPromise;

    loadPromise = (async () => {
      cachedSettings = loadStaticSettings();
      loaded = true;
      loadPromise = null;
      return getSettings();
    })();

    return loadPromise;
  }

  async function bootstrapAndApply(reason = 'startup') {
    await loadCurrentSettings();
    const applyResult = await applySettings(cachedSettings, reason, { force: true });
    return { settings: getSettings(), applyResult };
  }

  function shutdown() {
    clearPendingTimer();
    pendingSettings = null;
  }

  return {
    getMeta,
    getSettings,
    loadCurrentSettings,
    applySettings,
    bootstrapAndApply,
    shutdown,
  };
}

module.exports = {
  BOT_PRESENCE_ALLOWED_TYPES,
  BOT_PRESENCE_DEFAULTS,
  BOT_PRESENCE_TEXT_MAX,
  normalizeBotPresenceSettings,
  validateBotPresenceSettings,
  createBotPresenceManager,
};
