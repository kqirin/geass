const { config } = require('./config');

function logSystem(message, type = "INFO") {
  if (config.logging.format === 'json') {
    const payload =
      message && typeof message === 'object' && !Array.isArray(message)
        ? message
        : { msg: String(message) };
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: type,
        ...payload,
      })
    );
    return;
  }

  const time = new Date().toLocaleString('tr-TR');
  const text =
    message && typeof message === 'object' && !Array.isArray(message)
      ? JSON.stringify(message)
      : String(message);
  const logMsg = `[${time}] [${type}] ${text}`;
  console.log(logMsg);
}

function serializeError(err) {
  if (!err) return '<no-error-object>';
  const code = err.code ? ` code=${err.code}` : '';
  const sql = err.sqlMessage ? ` sql=${err.sqlMessage}` : '';
  const msg = err.message || String(err);
  return `${msg}${code}${sql}`.trim();
}

function logStructuredError(context, err, extra = {}, level = 'ERROR') {
  if (config.logging.format === 'json') {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        context,
        err: serializeError(err),
        extra,
      })
    );
    return;
  }
  const extraText = Object.keys(extra).length ? ` extra=${JSON.stringify(extra)}` : '';
  logSystem(`${context}: ${serializeError(err)}${extraText}`, level);
}

function logError(context, err, extra = {}) {
  return logStructuredError(context, err, extra, 'ERROR');
}

function installConsoleDebugHooks({
  enableBlankConsoleGuard = String(process.env.DEBUG_CONSOLE_BLANK || '') === '1',
} = {}) {
  if (!enableBlankConsoleGuard) return false;
  if (installConsoleDebugHooks.__installed) return true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const stackPreview = () => String(new Error().stack || '').split('\n').slice(2, 8).join(' | ');
  const isBlankArgs = (args) =>
    !Array.isArray(args) ||
    args.length === 0 ||
    args.every((item) => String(item ?? '').trim().length === 0);

  console.warn = (...args) => {
    if (isBlankArgs(args)) {
      return originalWarn(`[BLANK_CONSOLE_WARN] stack=${stackPreview()}`);
    }
    return originalWarn(...args);
  };

  console.error = (...args) => {
    if (isBlankArgs(args)) {
      return originalError(`[BLANK_CONSOLE_ERROR] stack=${stackPreview()}`);
    }
    return originalError(...args);
  };

  installConsoleDebugHooks.__installed = true;
  return true;
}

module.exports = {
  logSystem,
  logError,
  logStructuredError,
  serializeError,
  installConsoleDebugHooks,
};

