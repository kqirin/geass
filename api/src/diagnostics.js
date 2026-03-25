const RATE_LIMIT_POLICIES = Object.freeze({
  'discord.messageCreate': { windowMs: 5_000, max: 20, keyFields: ['guildId', 'channelId'] },
  'discord.voiceStateUpdate': { windowMs: 5_000, max: 40, keyFields: ['guildId'] },
  'voice.state_change': { windowMs: 5_000, max: 80, keyFields: ['guildId', 'channelId'] },
});

const rateStateByKey = new Map();
let rateSweepTick = 0;

const timerRegistry = {
  installed: false,
  original: null,
  entries: new Map(),
};

let _diagEnabled = String(process.env.DIAG_MODE || '') === '1';

function isDiagModeEnabled() {
  return _diagEnabled;
}

function trimText(value, maxLen = 1200) {
  const text = String(value || '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function serializeError(err) {
  if (!err) return null;
  return {
    name: err.name || null,
    message: trimText(err.message || String(err), 800),
    code: err.code || null,
    stack: trimText(err.stack || '', 6000),
  };
}

function toSafePayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  return { value: payload };
}

function asId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function extractIdentifiers(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const context = obj.context && typeof obj.context === 'object' ? obj.context : {};
  const meta = obj.meta && typeof obj.meta === 'object' ? obj.meta : {};

  const requestId =
    asId(obj.requestId) ||
    asId(obj.reqId) ||
    asId(context.requestId) ||
    asId(context.reqId) ||
    asId(meta.requestId) ||
    null;

  const opId =
    asId(obj.opId) ||
    asId(obj.operationId) ||
    asId(context.opId) ||
    asId(context.operationId) ||
    asId(meta.opId) ||
    asId(obj.interactionId) ||
    asId(obj.messageId) ||
    null;

  return { requestId, opId };
}

function toFinitePositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function normalizePolicy(event, options = {}) {
  const optionWindowMs = toFinitePositiveNumber(options.windowMs);
  const optionMax = toFinitePositiveNumber(options.max);

  if (optionWindowMs && optionMax) {
    return {
      windowMs: optionWindowMs,
      max: Math.floor(optionMax),
      keyFields: Array.isArray(options.keyFields) ? options.keyFields : [],
    };
  }

  const fromPreset = RATE_LIMIT_POLICIES[String(event || '')];
  if (!fromPreset) return null;

  return {
    windowMs: fromPreset.windowMs,
    max: fromPreset.max,
    keyFields: Array.isArray(fromPreset.keyFields) ? fromPreset.keyFields : [],
  };
}

function buildRateKey(event, payload, policy, options = {}) {
  if (options.rateLimitKey) return String(options.rateLimitKey);

  const segments = [String(event || 'unknown')];
  const source = payload && typeof payload === 'object' ? payload : {};

  for (const field of policy.keyFields || []) {
    const raw = source[field];
    if (raw !== null && raw !== undefined && String(raw).trim()) {
      segments.push(`${field}:${String(raw).trim()}`);
    }
  }

  return segments.join('|');
}

function writeRecordDirect(record) {
  console.log(JSON.stringify(record));
}

function flushSuppressedSummary(now, state) {
  if (!state || state.suppressed <= 0) return;

  writeRecordDirect({
    ts: new Date(now).toISOString(),
    level: 'INFO',
    scope: 'diag',
    event: 'diag.rate_limited_summary',
    requestId: null,
    opId: null,
    payload: {
      targetEvent: state.event,
      rateLimitKey: state.key,
      suppressed: state.suppressed,
      windowMs: state.policy.windowMs,
      max: state.policy.max,
    },
  });
}

function checkRateLimit(event, payload, options = {}) {
  const policy = normalizePolicy(event, options);
  if (!policy) return true;

  const now = Date.now();
  const key = buildRateKey(event, payload, policy, options);
  let state = rateStateByKey.get(key);

  if (!state || now - state.windowStart >= policy.windowMs) {
    flushSuppressedSummary(now, state);
    state = {
      key,
      event,
      policy,
      windowStart: now,
      count: 0,
      suppressed: 0,
      noticeEmitted: false,
    };
    rateStateByKey.set(key, state);
  }

  if (state.count < policy.max) {
    state.count += 1;
    rateSweepTick += 1;
    if (rateSweepTick % 250 === 0) {
      for (const [rateKey, rateState] of rateStateByKey.entries()) {
        if (now - rateState.windowStart > Math.max(60_000, rateState.policy.windowMs * 10)) {
          rateStateByKey.delete(rateKey);
        }
      }
    }
    return true;
  }

  state.suppressed += 1;
  if (!state.noticeEmitted) {
    state.noticeEmitted = true;
    writeRecordDirect({
      ts: new Date(now).toISOString(),
      level: 'WARN',
      scope: 'diag',
      event: 'diag.rate_limited',
      requestId: null,
      opId: null,
      payload: {
        targetEvent: state.event,
        rateLimitKey: state.key,
        windowMs: state.policy.windowMs,
        max: state.policy.max,
      },
    });
  }

  return false;
}

function logDiag(event, payload = {}, level = 'INFO', options = {}) {
  if (!isDiagModeEnabled()) return;

  try {
    const safeEvent = String(event || 'unknown');
    const safePayload = toSafePayload(payload);

    if (!checkRateLimit(safeEvent, safePayload, options)) return;

    const ids = extractIdentifiers(safePayload);

    const record = {
      ts: new Date().toISOString(),
      level,
      scope: 'diag',
      event: safeEvent,
      requestId: ids.requestId,
      opId: ids.opId,
      payload: safePayload,
    };
    writeRecordDirect(record);
  } catch (err) {
    writeRecordDirect({
      ts: new Date().toISOString(),
      level: 'ERROR',
      scope: 'diag',
      event: 'diag_log_failed',
      requestId: null,
      opId: null,
      payload: {
        reason: String(err?.message || err || 'diag_log_failed'),
      },
    });
  }
}

function installTimerRegistry() {
  if (!isDiagModeEnabled()) return false;
  if (timerRegistry.installed) return true;

  timerRegistry.original = {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  };

  const original = timerRegistry.original;

  global.setTimeout = function wrappedSetTimeout(callback, delay, ...args) {
    const createdAt = Date.now();
    let handle = null;

    const wrappedCallback =
      typeof callback === 'function'
        ? (...cbArgs) => {
          timerRegistry.entries.delete(handle);
          return callback(...cbArgs);
        }
        : callback;

    handle = original.setTimeout(wrappedCallback, delay, ...args);
    timerRegistry.entries.set(handle, {
      type: 'timeout',
      createdAt,
      delayMs: Number(delay) || 0,
    });

    return handle;
  };

  global.clearTimeout = function wrappedClearTimeout(handle) {
    timerRegistry.entries.delete(handle);
    return original.clearTimeout(handle);
  };

  global.setInterval = function wrappedSetInterval(callback, delay, ...args) {
    const handle = original.setInterval(callback, delay, ...args);
    timerRegistry.entries.set(handle, {
      type: 'interval',
      createdAt: Date.now(),
      delayMs: Number(delay) || 0,
    });
    return handle;
  };

  global.clearInterval = function wrappedClearInterval(handle) {
    timerRegistry.entries.delete(handle);
    return original.clearInterval(handle);
  };

  timerRegistry.installed = true;
  logDiag('diag.timer_registry_installed', {
    trackedFunctions: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  return true;
}

function getTimerRegistrySnapshot(now = Date.now()) {
  const entries = [...timerRegistry.entries.values()];
  const withAge = entries.map((entry) => ({
    ...entry,
    ageMs: Math.max(0, now - Number(entry.createdAt || now)),
  }));

  const sorted = withAge.sort((a, b) => b.ageMs - a.ageMs);

  return {
    total: sorted.length,
    timeoutCount: sorted.filter((entry) => entry.type === 'timeout').length,
    intervalCount: sorted.filter((entry) => entry.type === 'interval').length,
    oldestAgeMs: sorted.length > 0 ? sorted[0].ageMs : 0,
    sample: sorted.slice(0, 5).map((entry) => ({
      type: entry.type,
      delayMs: entry.delayMs,
      ageMs: entry.ageMs,
    })),
  };
}

function logTimerRegistryReport(reason = 'snapshot') {
  if (!isDiagModeEnabled()) return null;
  const snapshot = getTimerRegistrySnapshot();
  logDiag('diag.timer_registry_report', {
    reason,
    ...snapshot,
  });
  return snapshot;
}

function snapshotEmitterListeners(emitter) {
  if (!emitter || typeof emitter.eventNames !== 'function' || typeof emitter.listenerCount !== 'function') {
    return {};
  }

  const out = {};
  for (const eventName of emitter.eventNames()) {
    const key = String(eventName);
    out[key] = Number(emitter.listenerCount(eventName) || 0);
  }
  return out;
}

function createListenerLeakWatcher({
  emitter,
  name,
  threshold = 20,
  intervalMs = 30_000,
}) {
  if (!isDiagModeEnabled()) {
    return {
      stop() { },
      snapshot() {
        return {};
      },
    };
  }

  const emitterName = String(name || 'emitter');
  const numericThreshold = Math.max(1, Number(threshold) || 20);
  const numericInterval = Math.max(1_000, Number(intervalMs) || 30_000);
  const baseline = snapshotEmitterListeners(emitter);

  logDiag('diag.listener_baseline', {
    name: emitterName,
    threshold: numericThreshold,
    listeners: baseline,
  });

  const timer = setInterval(() => {
    const current = snapshotEmitterListeners(emitter);

    for (const [eventName, count] of Object.entries(current)) {
      const base = Number(baseline[eventName] || 0);
      if (count <= numericThreshold) continue;
      if (count <= base) continue;

      logDiag(
        'diag.listener_warning',
        {
          name: emitterName,
          eventName,
          count,
          baseline: base,
          threshold: numericThreshold,
        },
        'WARN',
        {
          rateLimitKey: `diag.listener_warning|${emitterName}|${eventName}`,
          windowMs: 60_000,
          max: 1,
        }
      );
    }
  }, numericInterval);

  timer.unref?.();

  return {
    stop(reason = 'manual') {
      clearInterval(timer);
      logDiag('diag.listener_snapshot', {
        name: emitterName,
        reason,
        listeners: snapshotEmitterListeners(emitter),
      });
    },
    snapshot() {
      return snapshotEmitterListeners(emitter);
    },
  };
}

function resetDiagStateForTests() {
  rateStateByKey.clear();
  rateSweepTick = 0;
  // Re-read env in case tests changed it
  _diagEnabled = String(process.env.DIAG_MODE || '') === '1';
}

module.exports = {
  isDiagModeEnabled,
  serializeError,
  logDiag,
  trimText,
  installTimerRegistry,
  getTimerRegistrySnapshot,
  logTimerRegistryReport,
  createListenerLeakWatcher,
  snapshotEmitterListeners,
  __internal: {
    extractIdentifiers,
    resetDiagStateForTests,
  },
};
