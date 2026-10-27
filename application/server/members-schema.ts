import type { PoolClient } from 'pg';

export async function migrateMembers(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name text;
    CREATE TABLE IF NOT EXISTS member_creations (
      actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
      account_id uuid NOT NULL REFERENCES accounts(id), PRIMARY KEY(actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS member_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES accounts(id), target_organization_id uuid REFERENCES organizations(id),
      target_account_id uuid REFERENCES accounts(id), action text NOT NULL CHECK(action IN ('create','disable')),
      result text NOT NULL CHECK(result IN ('success','rejected')),
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
