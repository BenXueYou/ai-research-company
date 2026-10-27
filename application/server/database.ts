import pg, { type PoolClient } from 'pg';

export function database(url = process.env.DATABASE_URL): pg.Pool {
  if (!url)
    throw new Error('必须设置 DATABASE_URL');
  return new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
}
export async function transaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool: pg.Pool): Promise<void> {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(712010)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK (kind = 'platform')
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
        email text COLLATE "C" NOT NULL UNIQUE, password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('platform', 'distributor', 'admin', 'sales')),
        must_change boolean NOT NULL DEFAULT true, temporary_expires_at timestamptz,
        active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS bootstrap_marker (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        account_id uuid NOT NULL REFERENCES accounts(id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
        csrf_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '8 hours'
      );
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
      CREATE TABLE IF NOT EXISTS audit_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event text NOT NULL CHECK (event IN ('bootstrap', 'login_ok', 'login_failed', 'password_changed', 'password_rejected', 'logout')),
        account_id uuid REFERENCES accounts(id), happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS login_throttles (
        key_hash text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL
      );
    `);
  });
}
