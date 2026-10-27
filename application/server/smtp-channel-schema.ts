import type { PoolClient } from 'pg';

export async function migrateSmtpChannels(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS team_sending_channels (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      kind text NOT NULL CHECK (kind IN ('SMTP','UMAIL')),
      smtp_host text,
      smtp_port integer,
      smtp_security text,
      smtp_username text,
      credential_encrypted text NOT NULL,
      reply_to text NOT NULL,
      verification_state text NOT NULL CHECK (verification_state IN ('available','unavailable','not_live_verified')),
      verification_detail text NOT NULL,
      default_flag boolean NOT NULL DEFAULT false,
      verified_at timestamptz NOT NULL,
      updated_by uuid NOT NULL REFERENCES accounts(id),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id,kind),
      CHECK (kind <> 'SMTP' OR (smtp_host IS NOT NULL AND smtp_port IS NOT NULL AND smtp_security IS NOT NULL AND smtp_username IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_default_sending_channel_per_organization
      ON team_sending_channels(organization_id) WHERE default_flag;
    CREATE TABLE IF NOT EXISTS smtp_configuration_requests (
      actor_id uuid NOT NULL REFERENCES accounts(id),
      request_id uuid NOT NULL,
      input_fingerprint text NOT NULL,
      channel_id uuid NOT NULL REFERENCES team_sending_channels(id),
      PRIMARY KEY(actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS sending_channel_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      channel_id uuid NOT NULL REFERENCES team_sending_channels(id),
      action text NOT NULL CHECK(action IN ('smtp_configured')),
      verification_state text NOT NULL,
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
