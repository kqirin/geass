const db = require('../database');
const { config } = require('../config');
const { getAllMessageTemplates } = require('../infrastructure/repositories/messageTemplateRepository');

const settingsCache = new Map();
const customCommandsCache = new Map();
const messageTemplatesCache = new Map();

const limitCache = new Map();
const abuseCache = new Map();
const warnCache = new Map();

const ONE_HOUR_MS = 60 * 60 * 1000;
const WARN_COOLDOWN_MS = 8000;
const CACHE_PRUNE_TICK = config.cache.pruneTick;
const CACHE_MAX_KEYS = config.cache.maxKeys;
let cacheOps = 0;

function parseIdList(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/[^\d]/g, '')) // <@123> / @123 / 123
    .filter(Boolean);
}

function trimOldestKeys(map, limit, timestampGetter) {
  if (map.size <= limit) return;
  const overflow = map.size - limit;
  const victims = [...map.entries()]
    .sort((a, b) => timestampGetter(a[1]) - timestampGetter(b[1]))
    .slice(0, overflow)
    .map(([k]) => k);
  for (const k of victims) map.delete(k);
}

function maybePruneCaches(now = Date.now()) {
  cacheOps += 1;
  if (cacheOps % CACHE_PRUNE_TICK !== 0) return;

  for (const [key, stamps] of limitCache) {
    const next = (stamps || []).filter((t) => now - t < ONE_HOUR_MS);
    if (!next.length) limitCache.delete(key);
    else limitCache.set(key, next);
  }

  for (const [key, stamps] of abuseCache) {
    const next = (stamps || []).filter((t) => now - t < ONE_HOUR_MS);
    if (!next.length) abuseCache.delete(key);
    else abuseCache.set(key, next);
  }

  for (const [key, ts] of warnCache) {
    if (now - ts > ONE_HOUR_MS) warnCache.delete(key);
  }

  trimOldestKeys(limitCache, CACHE_MAX_KEYS, (stamps) => (Array.isArray(stamps) && stamps.length ? stamps[0] : 0));
  trimOldestKeys(abuseCache, CACHE_MAX_KEYS, (stamps) => (Array.isArray(stamps) && stamps.length ? stamps[0] : 0));
  trimOldestKeys(warnCache, CACHE_MAX_KEYS, (ts) => Number(ts) || 0);
}

async function loadAllSettings() {
  try {
    settingsCache.clear();

    const [rows] = await db.execute('SELECT * FROM settings');
    rows.forEach((row) => {
      try {
        row.custom_messages = JSON.parse(row.custom_messages || '{}');
      } catch {
        row.custom_messages = {};
      }
      settingsCache.set(row.guild_id, row);
    });

    console.log(`[CACHE] ${rows.length} settings loaded into RAM`);
  } catch (error) {
    console.error('Cache load error (settings):', error);
  }
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
      guildMap.set(row.command_name, row.command_response);
    }

    console.log(`[CACHE] ${rows.length} custom commands loaded into RAM`);
  } catch (error) {
    console.error('Cache load error (custom_commands):', error);
  }
}

function ensureMessageTemplateEntry(guildId) {
  let entry = messageTemplatesCache.get(guildId);
  if (!entry) {
    entry = { global: {}, commands: new Map() };
    messageTemplatesCache.set(guildId, entry);
  }
  return entry;
}

function normalizeTemplateCommandName(commandName) {
  return String(commandName || '').trim().toLowerCase();
}

function safeParseTemplatesJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}

async function loadAllMessageTemplates() {
  try {
    messageTemplatesCache.clear();
    const rows = await getAllMessageTemplates();

    rows.forEach((row) => {
      const guildId = row.guild_id;
      const scope = row.scope === 'command' ? 'command' : 'global';
      const commandName = normalizeTemplateCommandName(row.command_name);
      const parsed = safeParseTemplatesJson(row.templates_json);

      const entry = ensureMessageTemplateEntry(guildId);
      if (scope === 'command') entry.commands.set(commandName, parsed);
      else entry.global = parsed;
    });

    console.log(`[CACHE] ${rows.length} message template scope loaded into RAM`);
  } catch (error) {
    console.error('Cache load error (message_templates):', error);
  }
}

function getSettings(guildId) {
  return settingsCache.get(guildId);
}

function updateSettings(guildId, newSettings) {
  const current = settingsCache.get(guildId) || {};
  settingsCache.set(guildId, { ...current, ...newSettings });
}

function getCustomCommand(guildId, commandName) {
  const guildMap = customCommandsCache.get(guildId);
  if (!guildMap) return null;
  return guildMap.get(commandName) || null;
}

function upsertCustomCommand(guildId, commandName, commandResponse) {
  let guildMap = customCommandsCache.get(guildId);
  if (!guildMap) {
    guildMap = new Map();
    customCommandsCache.set(guildId, guildMap);
  }
  guildMap.set(commandName, commandResponse);
}

function removeCustomCommand(guildId, commandName) {
  const guildMap = customCommandsCache.get(guildId);
  if (!guildMap) return;
  guildMap.delete(commandName);
}

function getMessageTemplates(guildId, scope, commandName = '') {
  const entry = messageTemplatesCache.get(guildId);
  if (!entry) return null;

  if (scope === 'command') {
    return entry.commands.get(normalizeTemplateCommandName(commandName)) || null;
  }

  return entry.global || null;
}

function upsertMessageTemplates(guildId, scope, commandName, templates) {
  const entry = ensureMessageTemplateEntry(guildId);
  const safeTemplates = safeParseTemplatesJson(templates);

  if (scope === 'command') {
    entry.commands.set(normalizeTemplateCommandName(commandName), safeTemplates);
    return;
  }

  entry.global = safeTemplates;
}

function resetMessageTemplates(guildId, scope, commandName = '') {
  const entry = messageTemplatesCache.get(guildId);
  if (!entry) return;

  if (scope === 'command') {
    entry.commands.delete(normalizeTemplateCommandName(commandName));
    return;
  }

  entry.global = {};
}

function checkLimit(guildId, userId, command, limit, safeList) {
  maybePruneCaches();
  const limitNum = Number(limit);
  const safeIds = parseIdList(safeList);

  if (!Number.isFinite(limitNum) || limitNum <= 0) {
    return { allowed: true, key: null, bypass: true };
  }

  if (safeIds.includes(String(userId))) {
    return { allowed: true, key: null, bypass: true };
  }

  const key = `${guildId}_${userId}_${command}`;
  const now = Date.now();

  let stamps = limitCache.get(key) || [];
  stamps = stamps.filter((t) => now - t < ONE_HOUR_MS);
  limitCache.set(key, stamps);

  if (stamps.length >= limitNum) {
    const abuseKey = `abuse_${key}`;
    let abuse = abuseCache.get(abuseKey) || [];
    abuse = abuse.filter((t) => now - t < ONE_HOUR_MS);
    abuse.push(now);
    abuseCache.set(abuseKey, abuse);

    const lastWarn = warnCache.get(key) || 0;
    const shouldWarn = now - lastWarn >= WARN_COOLDOWN_MS;
    if (shouldWarn) warnCache.set(key, now);

    return {
      allowed: false,
      key,
      count: stamps.length,
      abuseCount: abuse.length,
      shouldWarn,
    };
  }

  return { allowed: true, key, count: stamps.length };
}

function incrementLimit(key) {
  maybePruneCaches();
  if (!key) return;
  const now = Date.now();
  let stamps = limitCache.get(key) || [];
  stamps = stamps.filter((t) => now - t < ONE_HOUR_MS);
  stamps.push(now);
  limitCache.set(key, stamps);
}

module.exports = {
  loadAllSettings,
  loadAllCustomCommands,
  loadAllMessageTemplates,

  getSettings,
  updateSettings,

  getCustomCommand,
  upsertCustomCommand,
  removeCustomCommand,
  getMessageTemplates,
  upsertMessageTemplates,
  resetMessageTemplates,

  checkLimit,
  incrementLimit,
  parseIdList,
};

