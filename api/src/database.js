const { Pool } = require('pg');
const { config } = require('./config');
const perfMonitor = require('./utils/perfMonitor');

function toPgConnectionConfig() {
  if (config.db.url) {
    return {
      connectionString: config.db.url,
      max: config.db.poolSize,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
      client_encoding: 'UTF8',
    };
  }

  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    max: config.db.poolSize,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    client_encoding: 'UTF8',
  };
}

const pool = new Pool(toPgConnectionConfig());

pool.on('error', (err) => {
  const code = String(err?.code || 'UNKNOWN');
  const msg = String(err?.message || 'db_pool_error').slice(0, 180);
  console.error(`[DB_POOL_ERROR] code=${code} msg=${msg}`);
});

function maybeConvertNumeric(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function normalizeResult(result) {
  const command = String(result?.command || '').toUpperCase();
  if (command === 'SELECT' || command === 'SHOW') return result?.rows || [];

  return {
    insertId: maybeConvertNumeric(result?.rows?.[0]?.id),
    affectedRows: Number(result?.rowCount || 0),
    rowCount: Number(result?.rowCount || 0),
    command,
    rows: result?.rows || [],
  };
}

function convertQuestionPlaceholders(sql) {
  const source = String(sql || '');
  let out = '';
  let index = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      out += '--';
      i += 1;
      inLineComment = true;
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      out += '/*';
      i += 1;
      inBlockComment = true;
      continue;
    }

    if (!inDouble && ch === "'") {
      out += ch;
      if (inSingle && next === "'") {
        out += "'";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && ch === '"') {
      out += ch;
      if (inDouble && next === '"') {
        out += '"';
        i += 1;
        continue;
      }
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && ch === '?') {
      out += `$${index++}`;
      continue;
    }

    out += ch;
  }

  return out;
}

const _sqlCache = new Map();
const SQL_CACHE_MAX = 200;

function cachedConvertPlaceholders(sql) {
  const cached = _sqlCache.get(sql);
  if (cached !== undefined) return cached;
  const converted = convertQuestionPlaceholders(sql);
  if (_sqlCache.size >= SQL_CACHE_MAX) _sqlCache.clear();
  _sqlCache.set(sql, converted);
  return converted;
}

async function executeOn(client, sql, params = []) {
  const text = cachedConvertPlaceholders(sql);
  const result = await client.query({ text, values: params });
  return [normalizeResult(result), result];
}

async function execute(sql, params = []) {
  const start = perfMonitor.isEnabled() ? Date.now() : 0;
  const result = await executeOn(pool, sql, params);
  if (start) {
    const elapsed = Date.now() - start;
    perfMonitor.incCounter('dbQueriesTotal');
    if (elapsed >= perfMonitor.getSlowQueryThreshold()) {
      perfMonitor.incCounter('dbQueriesSlow');
    }
  }
  return result;
}

async function query(sql, params = []) {
  return execute(sql, params);
}

async function getConnection() {
  const client = await pool.connect();
  return {
    query(sql, params = []) {
      return executeOn(client, sql, params);
    },
    execute(sql, params = []) {
      return executeOn(client, sql, params);
    },
    release() {
      client.release();
    },
  };
}

async function end() {
  await pool.end();
}

module.exports = {
  execute,
  query,
  getConnection,
  end,
  isPostgres: true,
  convertQuestionPlaceholders,
};
