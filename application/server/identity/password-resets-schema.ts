import type { PoolClient } from 'pg';

export async function migratePasswordResets(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
      target_account_id uuid NOT NULL REFERENCES accounts(id), PRIMARY KEY(actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS password_reset_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES accounts(id), target_account_id uuid REFERENCES accounts(id),
      result text NOT NULL CHECK(result IN ('success','rejected')),
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
