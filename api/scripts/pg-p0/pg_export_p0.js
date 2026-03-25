/* eslint-disable no-console */
require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const db = require('../../src/database');
const { P0_TABLES, TABLE_CONFIG, artifactBaseDir } = require('./p0_config');
const {
  ensureDir,
  tsStamp,
  writeCsv,
  writeNdjson,
  sha256File,
  parseArgs,
} = require('./_utils');

function qIdent(input) {
  return `"${String(input || '').replace(/"/g, '""')}"`;
}

async function q(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function tableExists(tableName) {
  const rows = await q(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ?
      ) AS exists
    `,
    [tableName]
  );
  return rows?.[0]?.exists === true;
}

async function getTableColumns(tableName) {
  const rows = await q(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ?
      ORDER BY ordinal_position
    `,
    [tableName]
  );
  return new Set((rows || []).map((row) => String(row.column_name || '').trim()).filter(Boolean));
}

async function exportTable(tableName, cfg, dataDir, manifest) {
  const exists = await tableExists(tableName);
  const csvPath = path.join(dataDir, `${tableName}.csv`);
  const ndjsonPath = path.join(dataDir, `${tableName}.ndjson`);
  let rows = [];

  if (exists) {
    const columns = await getTableColumns(tableName);
    const selectCols = cfg.columns
      .map((columnName) =>
        columns.has(columnName)
          ? qIdent(columnName)
          : `NULL AS ${qIdent(columnName)}`
      )
      .join(', ');
    const orderBy = cfg.orderBy
      .filter((columnName) => columns.has(columnName))
      .map((columnName) => qIdent(columnName));

    rows = await q(
      `SELECT ${selectCols} FROM ${qIdent(tableName)}${
        orderBy.length ? ` ORDER BY ${orderBy.join(', ')}` : ''
      }`
    );
  }

  await writeCsv(csvPath, cfg.columns, rows);
  await writeNdjson(ndjsonPath, rows);

  manifest.rowCounts[tableName] = rows.length;
  manifest.tables[tableName] = {
    columns: cfg.columns,
    orderBy: cfg.orderBy,
    sequenceColumn: cfg.sequenceColumn || null,
    missingInSource: !exists,
  };
  manifest.files[`${tableName}.csv`] = {
    path: path.relative(manifest.outputDir, csvPath),
    sha256: await sha256File(csvPath),
  };
  manifest.files[`${tableName}.ndjson`] = {
    path: path.relative(manifest.outputDir, ndjsonPath),
    sha256: await sha256File(ndjsonPath),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = tsStamp();
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(artifactBaseDir(process.cwd()), `${runId}-pg`);
  const dataDir = path.join(outDir, 'data');
  const metaDir = path.join(outDir, 'meta');
  const schemaDir = path.join(outDir, 'schema');

  ensureDir(outDir);
  ensureDir(dataDir);
  ensureDir(metaDir);
  ensureDir(schemaDir);

  const manifest = {
    kind: 'pg_p0_baseline_export',
    generatedAt: new Date().toISOString(),
    outputDir: outDir,
    source: {
      host: process.env.DB_HOST || null,
      database: process.env.DB_NAME || null,
      user: process.env.DB_USER || null,
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    },
    tables: {},
    rowCounts: {},
    files: {},
    checks: {},
  };

  const schemaSnapshotPath = path.join(schemaDir, '001_p0_schema.sql');
  fs.copyFileSync(path.join(__dirname, 'sql', '001_p0_schema.sql'), schemaSnapshotPath);
  manifest.files.schemaSnapshot = {
    path: path.relative(outDir, schemaSnapshotPath),
    sha256: await sha256File(schemaSnapshotPath),
  };

  for (const tableName of P0_TABLES) {
    const cfg = TABLE_CONFIG[tableName];
    if (!cfg) throw new Error(`TABLE_CONFIG missing: ${tableName}`);
    await exportTable(tableName, cfg, dataDir, manifest);
  }

  const tpActive = await q(
    `SELECT id, guild_id, user_id, action_type, role_id, revoke_at, reason, active, created_at, revoked_at
     FROM timed_penalties
     WHERE active = TRUE
     ORDER BY revoke_at ASC, id ASC`
  ).catch(() => []);
  const tpActivePath = path.join(metaDir, 'timed_penalties_active.csv');
  await writeCsv(
    tpActivePath,
    ['id', 'guild_id', 'user_id', 'action_type', 'role_id', 'revoke_at', 'reason', 'active', 'created_at', 'revoked_at'],
    tpActive
  );
  manifest.files.timedPenaltiesActive = {
    path: path.relative(outDir, tpActivePath),
    sha256: await sha256File(tpActivePath),
  };
  manifest.checks.timedPenalties = {
    activeCount: tpActive.length,
    totalCount: manifest.rowCounts.timed_penalties || 0,
  };

  const onlyOnceRows = await q(
    `SELECT rule_id, guild_id, user_id, event_type, state, created_at, updated_at
     FROM reaction_rule_only_once_executions
     ORDER BY rule_id ASC, user_id ASC, event_type ASC`
  ).catch(() => []);
  const onlyOnceStateCounts = Object.fromEntries(
    (await q(
      `SELECT state, COUNT(*)::bigint AS c
       FROM reaction_rule_only_once_executions
       GROUP BY state
       ORDER BY state ASC`
    ).catch(() => []))
      .map((row) => [String(row.state || '').trim() || 'UNKNOWN', Number(row.c || 0)])
  );
  const onlyOncePath = path.join(metaDir, 'reaction_only_once_summary.json');
  fs.writeFileSync(
    onlyOncePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rowCount: onlyOnceRows.length,
        stateCounts: onlyOnceStateCounts,
        rows: onlyOnceRows,
      },
      null,
      2
    ),
    'utf8'
  );
  manifest.files.reactionOnlyOnce = {
    path: path.relative(outDir, onlyOncePath),
    sha256: await sha256File(onlyOncePath),
  };

  const pvrRows = await q(
    `SELECT id, guild_id, owner_id, voice_channel_id, panel_message_id, locked, lock_snapshot_json,
            visibility_snapshot_json, whitelist_member_ids_json, last_active_at, created_at, updated_at
     FROM private_voice_rooms
     ORDER BY id ASC`
  ).catch(() => []);
  const pvrPath = path.join(metaDir, 'private_voice_rooms_active.csv');
  await writeCsv(
    pvrPath,
    [
      'id',
      'guild_id',
      'owner_id',
      'voice_channel_id',
      'panel_message_id',
      'locked',
      'lock_snapshot_json',
      'visibility_snapshot_json',
      'whitelist_member_ids_json',
      'last_active_at',
      'created_at',
      'updated_at',
    ],
    pvrRows
  );
  manifest.files.privateVoiceRoomsActive = {
    path: path.relative(outDir, pvrPath),
    sha256: await sha256File(pvrPath),
  };

  const modSummary = {
    generatedAt: new Date().toISOString(),
    totalCount: manifest.rowCounts.mod_logs || 0,
    minMax: (
      await q(
        'SELECT MIN(id) AS min_id, MAX(id) AS max_id, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM mod_logs'
      ).catch(() => [{}])
    )[0],
    byAction: await q(
      'SELECT action_type, COUNT(*)::bigint AS c FROM mod_logs GROUP BY action_type ORDER BY c DESC, action_type ASC'
    ).catch(() => []),
  };
  const modSummaryPath = path.join(metaDir, 'mod_logs_summary.json');
  fs.writeFileSync(modSummaryPath, JSON.stringify(modSummary, null, 2), 'utf8');
  manifest.files.modLogsSummary = {
    path: path.relative(outDir, modSummaryPath),
    sha256: await sha256File(modSummaryPath),
  };
  manifest.checks.modLogs = {
    totalCount: modSummary.totalCount,
    minId: modSummary.minMax?.min_id ?? null,
    maxId: modSummary.minMax?.max_id ?? null,
  };

  const rowCountsPath = path.join(metaDir, 'row_counts.json');
  fs.writeFileSync(
    rowCountsPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), rowCounts: manifest.rowCounts }, null, 2),
    'utf8'
  );
  manifest.files.rowCounts = {
    path: path.relative(outDir, rowCountsPath),
    sha256: await sha256File(rowCountsPath),
  };

  const manifestPath = path.join(metaDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, outDir, manifestPath }, null, 2));
}

main()
  .then(async () => {
    await db.end();
  })
  .catch(async (err) => {
    console.error('[pg_export_p0] failed:', err?.message || err);
    try {
      await db.end();
    } catch {}
    process.exit(1);
  });
