export async function migrateUMail(client) {
    await client.query(`
    ALTER TABLE team_sending_channels ALTER COLUMN credential_encrypted DROP NOT NULL;
    ALTER TABLE team_sending_channels ADD COLUMN IF NOT EXISTS umail_domain text;
    ALTER TABLE team_sending_channels ADD COLUMN IF NOT EXISTS umail_sender_address text;
    ALTER TABLE team_sending_channels ADD COLUMN IF NOT EXISTS umail_domain_status text;
    ALTER TABLE team_sending_channels ADD COLUMN IF NOT EXISTS umail_account_status text;
    ALTER TABLE team_sending_channels ADD COLUMN IF NOT EXISTS umail_dns_records jsonb;
    DO $$ BEGIN
      ALTER TABLE team_sending_channels ADD CONSTRAINT team_sending_channel_kind_fields CHECK (
        (kind='SMTP' AND credential_encrypted IS NOT NULL AND smtp_host IS NOT NULL AND smtp_port IS NOT NULL
          AND smtp_security IS NOT NULL AND smtp_username IS NOT NULL
          AND umail_domain IS NULL AND umail_sender_address IS NULL)
        OR
        (kind='UMAIL' AND credential_encrypted IS NULL AND smtp_host IS NULL AND smtp_port IS NULL
          AND smtp_security IS NULL AND smtp_username IS NULL
          AND umail_domain IS NOT NULL AND umail_sender_address IS NOT NULL
          AND umail_domain_status IS NOT NULL AND umail_account_status IS NOT NULL
          AND umail_dns_records IS NOT NULL)
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE IF NOT EXISTS umail_resources (
      organization_id uuid PRIMARY KEY REFERENCES organizations(id),
      external_resource_id text COLLATE "C" NOT NULL UNIQUE,
      resource_status text NOT NULL CHECK (resource_status IN ('available','unavailable','not_live_verified')),
      billing_responsibility text NOT NULL DEFAULT 'platform_phase_one'
        CHECK (billing_responsibility = 'platform_phase_one'),
      verification_detail text NOT NULL,
      checked_at timestamptz NOT NULL,
      configured_by uuid NOT NULL REFERENCES accounts(id),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS umail_resource_requests (
      actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
      input_fingerprint text NOT NULL, organization_id uuid NOT NULL REFERENCES organizations(id),
      PRIMARY KEY(actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS umail_channel_requests (
      actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
      input_fingerprint text NOT NULL, channel_id uuid NOT NULL REFERENCES team_sending_channels(id),
      PRIMARY KEY(actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS umail_audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event text NOT NULL CHECK (event IN ('resource_configured','channel_saved')),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      channel_id uuid REFERENCES team_sending_channels(id),
      resource_status text, domain_status text, account_status text,
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
//# sourceMappingURL=umail-schema.js.map