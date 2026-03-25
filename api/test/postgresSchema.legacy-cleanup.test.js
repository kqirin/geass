const test = require('node:test');
const assert = require('node:assert/strict');

const postgresSchemaPath = require.resolve('../src/postgresSchema');
const dbPath = require.resolve('../src/database');

function loadSchemaWithDbMock({ existingTables = [] } = {}) {
  const originalSchemaModule = require.cache[postgresSchemaPath];
  const originalDbModule = require.cache[dbPath];
  const tableState = new Set(existingTables.map((tableName) => String(tableName)));
  const executed = [];

  delete require.cache[postgresSchemaPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      execute: async (sql, params = []) => {
        const text = String(sql || '');
        executed.push({ sql: text, params });

        if (text.includes('information_schema.tables')) {
          return [[{ exists: tableState.has(String(params[0] || '')) }]];
        }

        const renameMatch = text.match(/ALTER TABLE "([^"]+)" RENAME TO "([^"]+)"/i);
        if (renameMatch) {
          tableState.delete(renameMatch[1]);
          tableState.add(renameMatch[2]);
          return [[]];
        }

        const dropMatch = text.match(/DROP TABLE IF EXISTS "([^"]+)"/i);
        if (dropMatch) {
          tableState.delete(dropMatch[1]);
          return [[]];
        }

        return [[]];
      },
    },
  };

  const schema = require(postgresSchemaPath);
  return {
    schema,
    executed,
    tableState,
    restore() {
      delete require.cache[postgresSchemaPath];
      if (originalSchemaModule) require.cache[postgresSchemaPath] = originalSchemaModule;
      if (originalDbModule) require.cache[dbPath] = originalDbModule;
      else delete require.cache[dbPath];
    },
  };
}

test('startup schema archives legacy config tables and keeps runtime schema free of config store tables', async () => {
  const loaded = loadSchemaWithDbMock({
    existingTables: ['settings', 'bot_presence_settings', 'bot_presence_settings_legacy_archive'],
  });

  try {
    await loaded.schema.ensurePostgresStartupSchema(() => {}, () => {});

    assert.equal(
      loaded.executed.some(({ sql }) =>
        /ALTER TABLE "settings" RENAME TO "settings_legacy_archive"/i.test(sql)
      ),
      true
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /DROP TABLE IF EXISTS "bot_presence_settings"/i.test(sql)
      ),
      true
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /CREATE TABLE IF NOT EXISTS settings\b/i.test(sql)
      ),
      false
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /CREATE TABLE IF NOT EXISTS bot_presence_settings\b/i.test(sql)
      ),
      false
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /CREATE TABLE IF NOT EXISTS reaction_rule_only_once_executions/i.test(sql)
      ),
      true
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /CREATE TABLE IF NOT EXISTS text_channel_lock_snapshots/i.test(sql)
      ),
      true
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /DROP TABLE IF EXISTS "message_templates"/i.test(sql)
      ),
      true
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /ADD COLUMN IF NOT EXISTS "lock_snapshot_json" TEXT/i.test(sql)
      ),
      true
    );
    assert.equal(
      loaded.executed.some(({ sql }) =>
        /ADD COLUMN IF NOT EXISTS "visibility_snapshot_json" TEXT NULL/i.test(sql)
      ),
      true
    );
  } finally {
    loaded.restore();
  }
});
