import { randomUUID } from 'node:crypto';
import { hashPassword } from './policy.js';
import pg, { type PoolClient } from 'pg';
import { migrateProcurement } from './procurement-schema.js';
import { migrateMembers } from './members-schema.js';
import { migrateSmtpChannels } from './smtp-channel-schema.js';

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
        id uuid PRIMARY KEY, name text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('platform','distributor','terminal')),
        parent_id uuid REFERENCES organizations(id), distributor_level integer NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        phone_encrypted text, phone_key text UNIQUE, phone_masked text,
        CHECK ((kind='platform' AND parent_id IS NULL AND distributor_level=0) OR
          (kind='distributor' AND parent_id IS NOT NULL AND distributor_level IN (1,2)) OR
          (kind='terminal' AND parent_id IS NOT NULL AND distributor_level=0)),
        CHECK (kind='platform' OR (phone_encrypted IS NOT NULL AND phone_key IS NOT NULL AND phone_masked IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
        email text COLLATE "C" UNIQUE, username text COLLATE "C" UNIQUE, password_hash text NOT NULL,
        CHECK ((username IS NOT NULL AND username = 'super_admin' AND email IS NULL AND role = 'platform') OR (username IS NULL AND email IS NOT NULL)),
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
      CREATE TABLE IF NOT EXISTS organization_openings (
        actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id), account_id uuid NOT NULL REFERENCES accounts(id),
        PRIMARY KEY(actor_id,request_id)
      );
      CREATE TABLE IF NOT EXISTS application_keys (
        purpose text PRIMARY KEY, fingerprint text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opening_audit (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        actor_id uuid NOT NULL REFERENCES accounts(id), target_organization_id uuid REFERENCES organizations(id),
        target_account_id uuid REFERENCES accounts(id), result text NOT NULL CHECK(result IN ('created','rejected')),
        happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE OR REPLACE FUNCTION enforce_organization_tree() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE parent organizations;
      BEGIN
        IF TG_OP='UPDATE' THEN
          IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.kind<>OLD.kind OR NEW.distributor_level<>OLD.distributor_level THEN
            RAISE EXCEPTION 'Organization relationship is immutable';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW.kind='platform' THEN RETURN NEW; END IF;
        SELECT * INTO parent FROM organizations WHERE id=NEW.parent_id FOR SHARE;
        IF NOT FOUND OR parent.kind='terminal' OR
          (NEW.kind='distributor' AND NEW.distributor_level<>parent.distributor_level+1) THEN
          RAISE EXCEPTION 'Invalid organization hierarchy';
        END IF;
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER organization_tree BEFORE INSERT OR UPDATE ON organizations
        FOR EACH ROW EXECUTE FUNCTION enforce_organization_tree();
    `);
    await migrateProcurement(client);
    await migrateMembers(client);
    await migrateSmtpChannels(client);
    // The migration lock covers schema and seed together, including concurrent deployments.
    // This release targets new databases, not the earlier disposable email-only schema.
    await client.query('SELECT username FROM accounts LIMIT 0');
    await client.query('SELECT parent_id,phone_key FROM organizations LIMIT 0');
    const initialized = await client.query('SELECT 1 FROM bootstrap_marker');
    if (!initialized.rowCount) {
      const organizationId = randomUUID();
      const accountId = randomUUID();
      const hash = await hashPassword('init@Base123');
      await client.query("INSERT INTO organizations(id,name,kind) VALUES($1,'平台','platform')", [organizationId]);
      await client.query(`INSERT INTO accounts(id,organization_id,username,password_hash,role,temporary_expires_at)
        VALUES($1,$2,'super_admin',$3,'platform',clock_timestamp() + interval '72 hours')`, [accountId, organizationId, hash]);
      await client.query('INSERT INTO bootstrap_marker(account_id) VALUES($1)', [accountId]);
      await client.query("INSERT INTO audit_events(event,account_id) VALUES('bootstrap',$1)", [accountId]);
    }
  });
}
