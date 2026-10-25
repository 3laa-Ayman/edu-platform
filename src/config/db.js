const { Pool, types } = require('pg');
const env = require('./env');

// BIGINT ids and NUMERIC money come back as JS numbers (all values are well below 2^53).
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

const pool = new Pool({
  connectionString: env.databaseUrl,
  // Serverless: many small instances, each with its own pool → keep it small.
  max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 20),
  idleTimeoutMillis: 30000,
  // Hosted databases reached over the public network need TLS (set DATABASE_SSL=true).
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('[pg] idle client error', err));

/** Every query in the codebase goes through parameterized statements ($1, $2 ...) — never string concatenation of user input. */
const query = (text, params) => pool.query(text, params);

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
