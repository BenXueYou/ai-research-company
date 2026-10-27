import type { PoolClient } from 'pg';

export async function migrateEmailSend(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS organization_email_limits (
      organization_id uuid PRIMARY KEY REFERENCES organizations(id),
      daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000000),
      updated_by uuid NOT NULL REFERENCES accounts(id),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS email_limit_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      daily_limit integer NOT NULL,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS email_daily_usage (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      usage_day date NOT NULL,
      reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),
      used integer NOT NULL DEFAULT 0 CHECK(used>=0),
      PRIMARY KEY(organization_id,usage_day)
    );
    CREATE TABLE IF NOT EXISTS email_batches (
      id uuid PRIMARY KEY,
      preview_id uuid NOT NULL UNIQUE REFERENCES email_previews(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      profile_id uuid NOT NULL REFERENCES company_profiles(id),
      channel_id uuid NOT NULL REFERENCES team_sending_channels(id),
      channel_kind text NOT NULL CHECK(channel_kind IN ('SMTP','UMAIL')),
      umail_resource_id text,
      umail_sender_address text,
      reply_to text NOT NULL,
      usage_day date NOT NULL,
      attachment_ids uuid[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS email_recipients (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES email_batches(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      profile_id uuid NOT NULL REFERENCES company_profiles(id),
      email text NOT NULL,
      email_key text NOT NULL,
      contact_id uuid NOT NULL REFERENCES company_contacts(id),
      mailsou_id text,
      subject text NOT NULL,
      content text NOT NULL,
      status text NOT NULL CHECK(status IN ('queued','submitting','accepted','not_submitted','uncertain','paused','delivered')),
      parent_recipient_id uuid REFERENCES email_recipients(id),
      checked_at timestamptz,
      retry_usage_day date,
      submitted_at timestamptz,
      resolved_at timestamptz,
      detail text
    );
    CREATE TABLE IF NOT EXISTS email_usage_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      recipient_id uuid NOT NULL REFERENCES email_recipients(id),
      event text NOT NULL CHECK(event IN ('reserved','used','released')),
      usage_day date NOT NULL,
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(recipient_id,event,usage_day)
    );
  `);
  await client.query(`
    ALTER TABLE email_batches ADD COLUMN IF NOT EXISTS umail_resource_id text;
    ALTER TABLE email_batches ADD COLUMN IF NOT EXISTS umail_sender_address text;
    ALTER TABLE email_batches DROP CONSTRAINT IF EXISTS email_batches_channel_kind_check;
    ALTER TABLE email_batches ADD CONSTRAINT email_batches_channel_kind_check CHECK(channel_kind IN ('SMTP','UMAIL'));
    ALTER TABLE email_batches DROP CONSTRAINT IF EXISTS email_batches_umail_resource_check;
    ALTER TABLE email_batches ADD CONSTRAINT email_batches_umail_resource_check CHECK (
      (channel_kind='SMTP' AND umail_resource_id IS NULL AND umail_sender_address IS NULL) OR
      (channel_kind='UMAIL' AND umail_resource_id IS NOT NULL AND umail_sender_address IS NOT NULL)
    );
  `);
  await client.query(`
    ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS parent_recipient_id uuid REFERENCES email_recipients(id);
    ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS checked_at timestamptz;
    ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS retry_usage_day date;
    ALTER TABLE email_usage_events DROP CONSTRAINT IF EXISTS email_usage_events_recipient_id_event_key;
    CREATE UNIQUE INDEX IF NOT EXISTS email_usage_events_recipient_event_day_unique
      ON email_usage_events(recipient_id,event,usage_day);
    ALTER TABLE email_recipients DROP CONSTRAINT IF EXISTS email_recipients_batch_id_email_key_key;
    ALTER TABLE email_recipients DROP CONSTRAINT IF EXISTS email_recipients_status_check;
    ALTER TABLE email_recipients ADD CONSTRAINT email_recipients_status_check
      CHECK(status IN ('queued','submitting','accepted','not_submitted','uncertain','paused','delivered'));
    CREATE UNIQUE INDEX IF NOT EXISTS email_recipients_initial_address_unique
      ON email_recipients(batch_id,email_key) WHERE parent_recipient_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS email_recipients_one_retry_per_parent
      ON email_recipients(parent_recipient_id) WHERE parent_recipient_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS email_evidence_checks (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      recipient_id uuid NOT NULL REFERENCES email_recipients(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      evidence_id text,
      finding text NOT NULL CHECK(finding IN ('unknown','accepted','not_submitted','delivered')),
      detail text NOT NULL,
      checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(recipient_id,evidence_id)
    );
  `);
}
