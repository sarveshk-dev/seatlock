import oracledb from 'oracledb';

// node-oracledb 6 runs in "Thin" mode by default: no Oracle Instant Client needed.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool;

export async function initDb() {
  pool = await oracledb.createPool({
    user: process.env.DB_USER || 'seatlock',
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING || 'localhost:1521/XEPDB1',
    poolMin: 2,
    poolMax: 20,
    poolIncrement: 2,
  });
}

export const closeDb = () => pool?.close(0);

/** Current UTC time as an Oracle DATE (date + time to the second). All stored times are UTC. */
export const UTC_NOW = 'CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE)';

/** SQL expression that returns a DATE column as an ISO-8601 UTC string (avoids driver time-zone shifts). */
export const iso = (col) => `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z'`;

/** Bind definition for "RETURNING id INTO :id". Read the value from result.outBinds.id[0]. */
export const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/** Oracle returns column names in UPPER CASE; the rest of the app uses lower case. */
const lowerKeys = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * Oracle binds cannot take an array for "IN (...)", so build :p0, :p1, ... placeholders.
 *   const l = inList('s', [4, 7]);  ->  { sql: ':s0,:s1', binds: { s0: 4, s1: 7 } }
 */
export function inList(prefix, values) {
  const binds = {};
  const names = values.map((v, i) => {
    binds[`${prefix}${i}`] = v;
    return `:${prefix}${i}`;
  });
  return { sql: names.join(', '), binds };
}

/**
 * Run one statement. Without `conn` it borrows a pooled connection and auto-commits.
 * With `conn` (inside a transaction) it does NOT commit.
 * Returns { rows, rowsAffected, outBinds }.
 */
export async function exec(sql, binds = {}, conn) {
  const run = async (c, autoCommit) => {
    const r = await c.execute(sql, binds, { autoCommit });
    return { rows: (r.rows || []).map(lowerKeys), rowsAffected: r.rowsAffected, outBinds: r.outBinds };
  };
  if (conn) return run(conn, false);
  const c = await pool.getConnection();
  try {
    return await run(c, true);
  } finally {
    await c.close();
  }
}

/** Bulk insert with positional binds: insertMany('INSERT ... VALUES (:1, :2)', [[1, 'a'], [2, 'b']]) */
export async function insertMany(sql, rows) {
  const c = await pool.getConnection();
  try {
    await c.executeMany(sql, rows, { autoCommit: true });
  } finally {
    await c.close();
  }
}

/**
 * Runs `fn(tx)` in a transaction; use tx.exec(sql, binds).
 * Retries automatically if Oracle reports a deadlock (ORA-00060) or a row-lock
 * wait timeout (ORA-30006).
 */
export async function withTransaction(fn, maxAttempts = 3) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      const tx = { exec: (sql, binds) => exec(sql, binds, conn) };
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      const retryable = err.errorNum === 60 || err.errorNum === 30006;
      if (retryable && attempt < maxAttempts) continue;
      throw err;
    } finally {
      await conn.close();
    }
  }
}
