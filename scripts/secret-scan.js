'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const INCLUDED_PREFIXES = [
  'api/src/',
  'dashboard/src/',
  '.github/workflows/',
  'scripts/',
];

const INCLUDED_FILES = new Set([
  'api/getemojis.js',
]);

const EXCLUDED_PREFIXES = [
  'node_modules/',
  'api/node_modules/',
  'dashboard/node_modules/',
  'dashboard/dist/',
  'api/artifacts/',
  'api/bin/',
];

const MAX_FILE_SIZE_BYTES = 1_000_000;

const DISCORD_TOKEN_REGEX = /\b[A-Za-z0-9_-]{23,30}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/;
const PRIVATE_KEY_REGEX = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function isExcluded(filePath) {
  return EXCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isIncluded(filePath) {
  if (INCLUDED_FILES.has(filePath)) return true;
  return INCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isScannableExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.yml', '.yaml']).has(ext);
}

function loadTrackedFiles() {
  const raw = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return raw
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean);
}

function scanFile(filePath) {
  const findings = [];
  if (!fs.existsSync(filePath)) return findings;

  const raw = fs.readFileSync(filePath);
  if (raw.length > MAX_FILE_SIZE_BYTES) return findings;
  if (raw.includes(0x00)) return findings;

  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNumber = idx + 1;

    if (line.includes('process.env.')) continue;

    if (PRIVATE_KEY_REGEX.test(line)) {
      findings.push({
        filePath,
        lineNumber,
        kind: 'private-key',
        snippet: line.trim(),
      });
      continue;
    }

    if (DISCORD_TOKEN_REGEX.test(line)) {
      findings.push({
        filePath,
        lineNumber,
        kind: 'discord-token',
        snippet: line.trim(),
      });
      continue;
    }

  }

  return findings;
}

function main() {
  const tracked = loadTrackedFiles();
  const candidates = tracked.filter((filePath) => {
    if (filePath === 'scripts/secret-scan.js') return false;
    if (isExcluded(filePath)) return false;
    if (!isIncluded(filePath)) return false;
    if (!isScannableExtension(filePath)) return false;
    return true;
  });

  const findings = [];
  for (const filePath of candidates) {
    findings.push(...scanFile(filePath));
  }

  if (findings.length === 0) {
    console.log(`secret scan passed (${candidates.length} files checked)`);
    return;
  }

  console.error(`secret scan failed (${findings.length} finding)`);
  for (const finding of findings) {
    console.error(`- ${finding.kind}: ${finding.filePath}:${finding.lineNumber}`);
  }
  process.exit(1);
}

main();
