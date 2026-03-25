const { ensurePostgresStartupSchema } = require('./postgresSchema');

async function runMigrations(logSystem = () => { }, logError = () => { }) {
  await ensurePostgresStartupSchema(logSystem, logError);
  logSystem('DB migrations tamamlandi (PostgreSQL)', 'INFO');
}

module.exports = { runMigrations };
