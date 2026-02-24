const db = require('../../database');

async function checkHealth() {
  await db.execute('SELECT 1');
}

module.exports = { checkHealth };

