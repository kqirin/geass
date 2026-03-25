const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function tsStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    'T',
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
    'Z',
  ].join('');
}

function toCsvCell(value) {
  if (value === null || value === undefined) return '\\N';
  let s = value;
  if (Buffer.isBuffer(s)) s = s.toString('utf8');
  else if (typeof s === 'object') s = JSON.stringify(s);
  else s = String(s);
  if (s === '\\N') return '"\\\\N"';
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, columns, rows) {
  const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
  ws.write(`${columns.join(',')}\n`);
  for (const row of rows) {
    const line = columns.map((c) => toCsvCell(row[c])).join(',');
    ws.write(`${line}\n`);
  }
  ws.end();
  return new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

function writeNdjson(filePath, rows) {
  const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
  for (const row of rows) ws.write(`${JSON.stringify(row)}\n`);
  ws.end();
  return new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

function sha256Text(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('data', (chunk) => h.update(chunk));
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

function stableSortObject(obj) {
  if (Array.isArray(obj)) return obj.map(stableSortObject);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = stableSortObject(obj[k]);
    return out;
  }
  return obj;
}

function canonicalJsonText(input) {
  if (input === null || input === undefined) return null;
  let parsed = input;
  if (typeof input === 'string') parsed = JSON.parse(input);
  const stable = stableSortObject(parsed);
  return JSON.stringify(stable);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const raw = String(argv[i] || '');
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || String(next).startsWith('--')) out[key] = true;
    else {
      out[key] = String(next);
      i += 1;
    }
  }
  return out;
}

function normalizePathForPsql(p) {
  return path.resolve(p).replace(/\\/g, '/').replace(/'/g, "''");
}

module.exports = {
  ensureDir,
  tsStamp,
  writeCsv,
  writeNdjson,
  sha256Text,
  sha256File,
  canonicalJsonText,
  parseArgs,
  normalizePathForPsql,
};

