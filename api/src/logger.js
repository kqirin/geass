const { config } = require('./config');

function logSystem(message, type = "INFO") {
  if (config.logging.format === 'json') {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: type,
        msg: String(message),
      })
    );
    return;
  }

  const time = new Date().toLocaleString('tr-TR');
  const logMsg = `[${time}] [${type}] ${message}`;
  console.log(logMsg);
}

function serializeError(err) {
  if (!err) return '';
  const code = err.code ? ` code=${err.code}` : '';
  const sql = err.sqlMessage ? ` sql=${err.sqlMessage}` : '';
  const msg = err.message || String(err);
  return `${msg}${code}${sql}`.trim();
}

function logError(context, err, extra = {}) {
  if (config.logging.format === 'json') {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'ERROR',
        context,
        err: serializeError(err),
        extra,
      })
    );
    return;
  }
  const extraText = Object.keys(extra).length ? ` extra=${JSON.stringify(extra)}` : '';
  logSystem(`${context}: ${serializeError(err)}${extraText}`, 'ERROR');
}

module.exports = { logSystem, logError, serializeError };

