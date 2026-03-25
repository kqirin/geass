const db = require('../database');
const { config } = require('../config');
const { buildAuthoritativeSettings } = require('../config/static');

const customCommandsCache = new Map();
// Ephemeral moderation limiter state is authoritative in RAM for a single-process deployment.
const moderationRateLimitState = new Map();

const ONE_HOUR_MS = 60 * 60 * 1000;
const WARN_COOLDOWN_MS = 8000;
const CACHE_PRUNE_TICK = config.cache.pruneTick;
const CACHE_MAX_KEYS = config.cache.maxKeys;
let cacheOps = 0;

function normalizeCustomCommandName(value) {
  return String(value || '').trim().toLowerCase();
}

function hasWhitespace(value) {
  return /\s/.test(String(value || ''));
}

function buildCustomCommandLookupCandidates(messageContent, prefix = '.') {
  const trimmed = normalizeCustomCommandName(messageContent);
  if (!trimmed) return [];

  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = normalizeCustomCommandName(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  add(trimmed);

  const normalizedPrefix = normalizeCustomCommandName(prefix);
  if (
    normalizedPrefix &&
    trimmed.startsWith(normalizedPrefix) &&
    trimmed.length > normalizedPrefix.length
  ) {
    const stripped = trimmed.slice(normalizedPrefix.length).trim();
    if (stripped && !hasWhitespace(stripped)) add(stripped);
  }

  return candidates;
}

function parseIdList(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/[^\d]/g, ''))
    .filter(Boolean);
}

function trimOldestKeys(map, limit, timestampGetter) {
  if (map.size <= limit) return;
  const overflow = map.size - limit;
  const victims = [...map.entries()]
    .sort((a, b) => timestampGetter(a[1]) - timestampGetter(b[1]))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of victims) map.delete(key);
}

function createEmptyRateLimitEntry(now = Date.now()) {
  return {
    actionStamps: [],
    abuseStamps: [],
    lastWarnAt: 0,
    lastTouchedAt: now,
  };
}

function normalizeRateLimitEntry(entry, now = Date.now()) {
  const normalized = entry && typeof entry === 'object'
    ? {
        actionStamps: Array.isArray(entry.actionStamps) ? entry.actionStamps : [],
        abuseStamps: Array.isArray(entry.abuseStamps) ? entry.abuseStamps : [],
        lastWarnAt: Number(entry.lastWarnAt || 0),
        lastTouchedAt: Number(entry.lastTouchedAt || now),
      }
    : createEmptyRateLimitEntry(now);

  normalized.actionStamps = normalized.actionStamps.filter((ts) => now - ts < ONE_HOUR_MS);
  normalized.abuseStamps = normalized.abuseStamps.filter((ts) => now - ts < ONE_HOUR_MS);
  if (now - normalized.lastWarnAt >= ONE_HOUR_MS) normalized.lastWarnAt = 0;
  normalized.lastTouchedAt = now;

  return normalized;
}

function persistRateLimitEntry(key, entry) {
  if (!key) return entry;
  const hasState =
    entry.actionStamps.length > 0 ||
    entry.abuseStamps.length > 0 ||
    Number(entry.lastWarnAt || 0) > 0;

  if (!hasState) {
    moderationRateLimitState.delete(key);
    return entry;
  }

  moderationRateLimitState.set(key, entry);
  return entry;
}

function getRateLimitEntry(key, now = Date.now()) {
  const entry = normalizeRateLimitEntry(moderationRateLimitState.get(key), now);
  return persistRateLimitEntry(key, entry);
}

function getRateLimitEntryOrderTimestamp(entry) {
  return Number(entry?.lastTouchedAt || 0);
}

function maybePruneCaches(now = Date.now()) {
  cacheOps += 1;
  if (cacheOps % CACHE_PRUNE_TICK !== 0) return;

  for (const [key, entry] of moderationRateLimitState.entries()) {
    persistRateLimitEntry(key, normalizeRateLimitEntry(entry, now));
  }

  trimOldestKeys(moderationRateLimitState, CACHE_MAX_KEYS, getRateLimitEntryOrderTimestamp);
}

function buildRateLimitKey(guildId, userId, command) {
  return `${guildId}_${userId}_${command}`;
}

function checkLimitInMemory(guildId, userId, command, limitNum, safeIds, now = Date.now()) {
  if (!Number.isFinite(limitNum) || limitNum <= 0) {
    return { allowed: true, key: null, bypass: true };
  }

  if (safeIds.includes(String(userId))) {
    return { allowed: true, key: null, bypass: true };
  }

  const key = buildRateLimitKey(guildId, userId, command);
  const entry = getRateLimitEntry(key, now);

  if (entry.actionStamps.length >= limitNum) {
    entry.abuseStamps.push(now);
    const shouldWarn = now - Number(entry.lastWarnAt || 0) >= WARN_COOLDOWN_MS;
    if (shouldWarn) entry.lastWarnAt = now;
    persistRateLimitEntry(key, entry);

    return {
      allowed: false,
      key,
      count: entry.actionStamps.length,
      abuseCount: entry.abuseStamps.length,
      shouldWarn,
      store: 'memory',
    };
  }

  persistRateLimitEntry(key, entry);
  return { allowed: true, key, count: entry.actionStamps.length, store: 'memory' };
}

function incrementLimitInMemory(key, now = Date.now()) {
  if (!key) return;
  const entry = getRateLimitEntry(key, now);
  entry.actionStamps.push(now);
  persistRateLimitEntry(key, entry);
}

function releaseLimitInMemory(key, now = Date.now()) {
  if (!key) return { ok: false, reason: 'missing_key' };

  const entry = getRateLimitEntry(key, now);
  if (!entry.actionStamps.length) {
    persistRateLimitEntry(key, entry);
    return { ok: true, released: 0, store: 'memory' };
  }

  entry.actionStamps.pop();
  persistRateLimitEntry(key, entry);
  return { ok: true, released: 1, store: 'memory' };
}

async function loadAllCustomCommands() {
  try {
    customCommandsCache.clear();

    const [rows] = await db.execute('SELECT guild_id, command_name, command_response FROM custom_commands');

    for (const row of rows) {
      let guildMap = customCommandsCache.get(row.guild_id);
      if (!guildMap) {
        guildMap = new Map();
        customCommandsCache.set(row.guild_id, guildMap);
      }
      guildMap.set(normalizeCustomCommandName(row.command_name), row.command_response);
    }

    console.log(`[CACHE] ${rows.length} custom commands loaded into RAM`);
  } catch (error) {
    if (String(error?.code || '') === '42P01') {
      console.warn('[CACHE] custom_commands tablosu bulunamadi, custom command cache skip edildi');
      return;
    }
    console.error('Cache load error (custom_commands):', error);
  }
}

function getSettings(guildId) {
  return buildAuthoritativeSettings(guildId);
}

function getCustomCommand(guildId, commandName, prefix = '.') {
  const guildMap = customCommandsCache.get(guildId);
  if (!guildMap) return null;
  for (const candidate of buildCustomCommandLookupCandidates(commandName, prefix)) {
    const hit = guildMap.get(candidate);
    if (hit) return hit;
  }
  return null;
}

function upsertCustomCommand(guildId, commandName, commandResponse) {
  let guildMap = customCommandsCache.get(guildId);
  if (!guildMap) {
    guildMap = new Map();
    customCommandsCache.set(guildId, guildMap);
  }
  guildMap.set(normalizeCustomCommandName(commandName), commandResponse);
}

function removeCustomCommand(guildId, commandName) {
  const guildMap = customCommandsCache.get(guildId);
  if (!guildMap) return;
  guildMap.delete(normalizeCustomCommandName(commandName));
}

async function checkLimit(guildId, userId, command, limit, safeList) {
  maybePruneCaches();
  const now = Date.now();
  const limitNum = Number(limit);
  const safeIds = parseIdList(safeList);
  return checkLimitInMemory(guildId, userId, command, limitNum, safeIds, now);
}

async function consumeLimit(guildId, userId, command, limit, safeList) {
  maybePruneCaches();
  const now = Date.now();
  const limitNum = Number(limit);
  const safeIds = parseIdList(safeList);
  const preview = checkLimitInMemory(guildId, userId, command, limitNum, safeIds, now);
  if (!preview.allowed) return preview;
  if (preview.bypass) return preview;

  incrementLimitInMemory(preview.key, now);
  return {
    allowed: true,
    key: preview.key,
    count: (preview.count || 0) + 1,
    store: 'memory',
  };
}

async function incrementLimit(key) {
  maybePruneCaches();
  if (!key) return { ok: false, reason: 'missing_key' };

  incrementLimitInMemory(key, Date.now());
  return { ok: true, store: 'memory' };
}

async function releaseLimit(key) {
  maybePruneCaches();
  if (!key) return { ok: false, reason: 'missing_key' };
  return releaseLimitInMemory(key, Date.now());
}

function __clearRateLimitStateForTests() {
  cacheOps = 0;
  moderationRateLimitState.clear();
}

module.exports = {
  loadAllCustomCommands,

  getSettings,

  getCustomCommand,
  upsertCustomCommand,
  removeCustomCommand,

  checkLimit,
  consumeLimit,
  incrementLimit,
  releaseLimit,
  parseIdList,
  normalizeCustomCommandName,
  buildCustomCommandLookupCandidates,
  __clearRateLimitStateForTests,
};
