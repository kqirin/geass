/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { P0_TABLES, TABLE_CONFIG } = require('./p0_config');
const { parseArgs, normalizePathForPsql } = require('./_utils');

function fail(message) {
  console.error(`[pg_import_p0_from_export] ${message}`);
  process.exit(1);
}

function runPsql(sqlFilePath, psqlBin = 'psql') {
  const sql = fs.readFileSync(sqlFilePath, 'utf8');

  const args = [
    '-v', 'ON_ERROR_STOP=1'
  ];

  const isWin = process.platform === 'win32';
  const bin = isWin ? 'cmd.exe' : psqlBin;
  const finalArgs = isWin ? ['/c', psqlBin, ...args] : args;

  const res = spawnSync(bin, finalArgs, {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
    env: process.env
  });

  if (res.error) fail(`psql exec error: ${res.error.message}`);
  if (res.status !== 0) fail(`psql failed with status=${res.status}`);
}

function qIdent(input) {
  return `"${String(input).replace(/"/g, '""')}"`;
}

function buildImportSql(artifactDir) {
  const truncateOrder = P0_TABLES.map((t) => `public.${qIdent(t)}`).join(', ');
  const lines = [];
  lines.push('\\set ON_ERROR_STOP on');
  lines.push('BEGIN;');
  lines.push(`TRUNCATE TABLE ${truncateOrder};`);

  for (const table of P0_TABLES) {
    const cfg = TABLE_CONFIG[table];
    const csvPath = path.join(artifactDir, 'data', `${table}.csv`);
    if (!fs.existsSync(csvPath)) fail(`missing CSV: ${csvPath}`);
    const cols = cfg.columns.map((c) => qIdent(c)).join(', ');
    const p = `/pg-p0-import/data/${path.basename(csvPath)}`;
    lines.push(
      `\\copy public.${qIdent(table)} (${cols}) FROM '${p}' WITH (FORMAT csv, HEADER true, NULL '\\N', ENCODING 'UTF8')`
    );
  }

  // Reset identity/sequence values after explicit-id import.
  for (const table of P0_TABLES) {
    const seqCol = TABLE_CONFIG[table].sequenceColumn;
    if (!seqCol) continue;
    lines.push(
      `SELECT setval(pg_get_serial_sequence('public.${table}','${seqCol}'), COALESCE((SELECT MAX(${qIdent(
        seqCol
      )}) FROM public.${qIdent(table)}), 1), (SELECT COUNT(*) > 0 FROM public.${qIdent(table)}));`
    );
  }

  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const artifactDir = args.artifact ? path.resolve(args.artifact) : null;
  const psqlBin = args.psql ? String(args.psql) : 'psql';
  if (!artifactDir) fail('missing --artifact <dir>');
  if (!fs.existsSync(artifactDir)) fail(`artifact dir not found: ${artifactDir}`);
  if (!fs.existsSync(path.join(artifactDir, 'meta', 'manifest.json'))) {
    fail(`manifest not found under artifact dir: ${artifactDir}`);
  }

  const sql = buildImportSql(artifactDir);
  const tmpSqlPath = path.join(os.tmpdir(), `pg_p0_import_${Date.now()}.sql`);
  fs.writeFileSync(tmpSqlPath, sql, 'utf8');

  try {
    runPsql(tmpSqlPath, psqlBin);
    console.log(
      JSON.stringify(
        {
          ok: true,
          artifactDir,
          importSql: tmpSqlPath,
          note: 'P0 import completed. Run pg_validate_p0_import.js next.',
        },
        null,
        2
      )
    );
  } finally {
    try {
      fs.unlinkSync(tmpSqlPath);
    } catch {}
  }
}

main();
