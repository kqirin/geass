const db = require('./database');
const { ensurePostgresStartupSchema } = require('./postgresSchema');

async function runMigrations(logSystem = () => { }, logError = () => { }) {
  try {
    await db.execute('SELECT 1 AS migration_ping');
  } catch (err) {
    logError('db_connection_ping_failed', err, {
      phase: 'run_migrations_ping',
      ...db.extractPgErrorDetails(err),
    });
    throw err;
  }

  try {
    await ensurePostgresStartupSchema(logSystem, logError);
  } catch (err) {
    logError('run_migrations_failed', err, {
      phase: 'ensure_postgres_startup_schema',
      ...db.extractPgErrorDetails(err),
    });
    throw err;
  }

  logSystem('DB migrations tamamlandi (PostgreSQL)', 'INFO');
}

module.exports = { runMigrations };
