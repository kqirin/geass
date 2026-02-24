const mysql = require('mysql2');
const { config } = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.poolSize,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

pool.on('connection', (conn) => {
  conn.on('error', (err) => {
    const code = String(err?.code || 'UNKNOWN');
    const msg = String(err?.message || 'db_connection_error').slice(0, 180);
    console.error(`[DB_CONN_ERROR] code=${code} msg=${msg}`);
  });
});

pool.on('error', (err) => {
  const code = String(err?.code || 'UNKNOWN');
  const msg = String(err?.message || 'db_pool_error').slice(0, 180);
  console.error(`[DB_POOL_ERROR] code=${code} msg=${msg}`);
});

module.exports = pool.promise();

