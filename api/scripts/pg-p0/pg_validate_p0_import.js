/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const db = require('../../src/database');
const { P0_TABLES } = require('./p0_config');
const { parseArgs } = require('./_utils');

function fail(message) {
  console.error(`[pg_validate_p0_import] ${message}`);
  process.exit(1);
}

function asNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function q(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows || [];
}

async function scalar(sql, params = []) {
  const rows = await q(sql, params);
  if (!rows[0]) return 0;
  const firstValue = Object.values(rows[0])[0];
  return firstValue;
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

async function main() {
  const args = parseArgs(process.argv);
  const artifactDir = args.artifact ? path.resolve(args.artifact) : null;
  if (!artifactDir) fail('missing --artifact <dir>');
  if (!fs.existsSync(artifactDir)) fail(`artifact dir not found: ${artifactDir}`);

  const manifestPath = path.join(artifactDir, 'meta', 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);

  const manifest = loadJson(manifestPath);
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    artifactDir,
    checks: [],
  };

  function pushCheck(name, ok, details = {}) {
    report.checks.push({ name, ok, ...details });
    if (!ok) report.ok = false;
  }

  for (const table of P0_TABLES) {
    const expected = Number(manifest.rowCounts?.[table] || 0);
    const exists = await tableExists(table);
    const missingInSource = Boolean(manifest.tables?.[table]?.missingInSource);
    if (!exists) {
      pushCheck(`row_count:${table}`, missingInSource && expected === 0, {
        expected,
        actual: 0,
        missingInDatabase: true,
      });
      continue;
    }
    const actual = asNum(await scalar(`SELECT COUNT(*) FROM ${table}`));
    pushCheck(`row_count:${table}`, actual === expected, { expected, actual });
  }

  const duplicateChecks = [
    ['pk_duplicate:mod_logs', ['mod_logs'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM mod_logs GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:timed_penalties', ['timed_penalties'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM timed_penalties GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:timed_penalty_role_snapshots', ['timed_penalty_role_snapshots'], 'SELECT COUNT(*) FROM (SELECT guild_id, user_id, COUNT(*) c FROM timed_penalty_role_snapshots GROUP BY guild_id, user_id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:reaction_rules', ['reaction_rules'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM reaction_rules GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:reaction_rule_logs', ['reaction_rule_logs'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM reaction_rule_logs GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:reaction_rule_only_once_executions', ['reaction_rule_only_once_executions'], 'SELECT COUNT(*) FROM (SELECT rule_id, user_id, event_type, COUNT(*) c FROM reaction_rule_only_once_executions GROUP BY rule_id, user_id, event_type HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:private_voice_rooms', ['private_voice_rooms'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM private_voice_rooms GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:text_channel_lock_snapshots', ['text_channel_lock_snapshots'], 'SELECT COUNT(*) FROM (SELECT guild_id, channel_id, COUNT(*) c FROM text_channel_lock_snapshots GROUP BY guild_id, channel_id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:custom_commands', ['custom_commands'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM custom_commands GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:custom_command_audit', ['custom_command_audit'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM custom_command_audit GROUP BY id HAVING COUNT(*) > 1) t'],
    ['pk_duplicate:private_voice_room_logs', ['private_voice_room_logs'], 'SELECT COUNT(*) FROM (SELECT id, COUNT(*) c FROM private_voice_room_logs GROUP BY id HAVING COUNT(*) > 1) t'],
    ['unique_duplicate:timed_penalties_active', ['timed_penalties'], 'SELECT COUNT(*) FROM (SELECT guild_id, user_id, action_type, COUNT(*) c FROM timed_penalties WHERE active = TRUE GROUP BY guild_id, user_id, action_type HAVING COUNT(*) > 1) t'],
    ['unique_duplicate:private_room_owner', ['private_voice_rooms'], 'SELECT COUNT(*) FROM (SELECT guild_id, owner_id, COUNT(*) c FROM private_voice_rooms GROUP BY guild_id, owner_id HAVING COUNT(*) > 1) t'],
    ['unique_duplicate:private_room_channel', ['private_voice_rooms'], 'SELECT COUNT(*) FROM (SELECT guild_id, voice_channel_id, COUNT(*) c FROM private_voice_rooms GROUP BY guild_id, voice_channel_id HAVING COUNT(*) > 1) t'],
    ['unique_duplicate:custom_commands_name', ['custom_commands'], 'SELECT COUNT(*) FROM (SELECT guild_id, command_name, COUNT(*) c FROM custom_commands GROUP BY guild_id, command_name HAVING COUNT(*) > 1) t'],
  ];

  for (const [name, tables, sql] of duplicateChecks) {
    const missingTables = [];
    for (const tableName of tables) {
      const exists = await tableExists(tableName);
      if (!exists) missingTables.push(tableName);
    }
    if (missingTables.length > 0) {
      const allowed = missingTables.every((tableName) => Boolean(manifest.tables?.[tableName]?.missingInSource));
      pushCheck(name, allowed, { skipped: allowed, missingTables });
      continue;
    }
    pushCheck(name, asNum(await scalar(sql)) === 0);
  }

  const modSummaryPath = path.join(artifactDir, 'meta', 'mod_logs_summary.json');
  if (fs.existsSync(modSummaryPath) && (await tableExists('mod_logs'))) {
    const modSummary = loadJson(modSummaryPath);
    const summaryRow = (await q('SELECT COALESCE(MIN(id), 0) AS min_id, COALESCE(MAX(id), 0) AS max_id, COUNT(*) AS total FROM mod_logs'))[0] || {};
    pushCheck('mod_logs_id_window_total', asNum(summaryRow.total) === Number(modSummary.totalCount || 0), {
      expectedTotal: Number(modSummary.totalCount || 0),
      actualTotal: asNum(summaryRow.total),
      expectedMinId: Number(modSummary.minMax?.min_id || 0),
      actualMinId: asNum(summaryRow.min_id),
      expectedMaxId: Number(modSummary.minMax?.max_id || 0),
      actualMaxId: asNum(summaryRow.max_id),
    });
  }

  if (await tableExists('timed_penalties')) {
    const tpExpected = Number(manifest.checks?.timedPenalties?.activeCount || 0);
    const tpActual = asNum(await scalar('SELECT COUNT(*) FROM timed_penalties WHERE active = TRUE'));
    pushCheck('timed_penalties_active_count', tpActual === tpExpected, { expected: tpExpected, actual: tpActual });
  }

  const onlyOnceSummaryPath = path.join(artifactDir, 'meta', 'reaction_only_once_summary.json');
  if (fs.existsSync(onlyOnceSummaryPath)) {
    const summary = loadJson(onlyOnceSummaryPath);
    const onlyOnceExists = await tableExists('reaction_rule_only_once_executions');
    if (!onlyOnceExists) {
      pushCheck(
        'reaction_only_once_total',
        Number(summary.rowCount || 0) === 0,
        { expected: Number(summary.rowCount || 0), actual: 0, missingInDatabase: true }
      );
      pushCheck(
        'reaction_only_once_state_counts',
        JSON.stringify(summary.stateCounts || {}) === JSON.stringify({}),
        { expected: summary.stateCounts || {}, actual: {}, missingInDatabase: true }
      );
      console.log(JSON.stringify(report, null, 2));
      await db.end();
      if (!report.ok) process.exit(1);
      return;
    }

    const actualTotal = asNum(await scalar('SELECT COUNT(*) FROM reaction_rule_only_once_executions'));
    pushCheck('reaction_only_once_total', actualTotal === Number(summary.rowCount || 0), {
      expected: Number(summary.rowCount || 0),
      actual: actualTotal,
    });

    const stateRows = await q(
      'SELECT state, COUNT(*) AS count FROM reaction_rule_only_once_executions GROUP BY state ORDER BY state ASC'
    );
    const actualStateCounts = Object.fromEntries(
      stateRows.map((row) => [String(row.state || '').trim() || 'UNKNOWN', asNum(row.count)])
    );
    pushCheck(
      'reaction_only_once_state_counts',
      JSON.stringify(actualStateCounts) === JSON.stringify(summary.stateCounts || {}),
      {
        expected: summary.stateCounts || {},
        actual: actualStateCounts,
      }
    );
  }

  console.log(JSON.stringify(report, null, 2));
  await db.end();
  if (!report.ok) process.exit(1);
}

main().catch(async (err) => {
  console.error('[pg_validate_p0_import] failed:', err?.message || err);
  try {
    await db.end();
  } catch {}
  process.exit(1);
});
