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
      channel_kind text NOT NULL CHECK(channel_kind='SMTP'),
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
      status text NOT NULL CHECK(status IN ('queued','submitting','accepted','not_submitted','uncertain','paused')),
      submitted_at timestamptz,
      resolved_at timestamptz,
      detail text,
      UNIQUE(batch_id,email_key)
    );
    CREATE TABLE IF NOT EXISTS email_usage_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      recipient_id uuid NOT NULL REFERENCES email_recipients(id),
      event text NOT NULL CHECK(event IN ('reserved','used','released')),
      usage_day date NOT NULL,
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(recipient_id,event)
    );
  `);
}
