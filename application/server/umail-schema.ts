import type { PoolClient } from 'pg';

export async function migrateUMail(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS umail_resources (
      organization_id uuid PRIMARY KEY REFERENCES organizations(id),
      external_resource_id text COLLATE "C" NOT NULL UNIQUE,
      resource_status text NOT NULL CHECK (resource_status IN ('active','suspended','unavailable')),
      billing_responsibility text NOT NULL DEFAULT 'platform_phase_one'
        CHECK (billing_responsibility = 'platform_phase_one'),
      checked_at timestamptz NOT NULL,
      configured_by uuid NOT NULL REFERENCES accounts(id),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS umail_channels (
      organization_id uuid PRIMARY KEY REFERENCES umail_resources(organization_id),
      domain text NOT NULL,
      sender_address text NOT NULL,
      reply_address text NOT NULL,
      is_default boolean NOT NULL,
      domain_status text NOT NULL CHECK (domain_status IN ('pending','verified','failed')),
      account_status text NOT NULL CHECK (account_status IN ('active','suspended','unavailable')),
      dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
      checked_at timestamptz NOT NULL,
      updated_by uuid NOT NULL REFERENCES accounts(id),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS umail_audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event text NOT NULL CHECK (event IN ('resource_configured','channel_saved')),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      resource_status text,
      domain_status text,
      account_status text,
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
