import type { PoolClient } from 'pg';

export async function migrateCompanyAttachments(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS company_attachments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      company_id uuid NOT NULL REFERENCES company_profiles(id),
      communication_id uuid REFERENCES timeline_manual_records(id),
      original_name text NOT NULL,
      storage_key text NOT NULL UNIQUE,
      mime_type text NOT NULL,
      size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
      sha256 text NOT NULL,
      scanned_at timestamptz NOT NULL,
      uploaded_by uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '2 years',
      deleted_by uuid REFERENCES accounts(id),
      deleted_at timestamptz,
      cleaned_by uuid REFERENCES accounts(id),
      cleaned_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS company_attachments_active
      ON company_attachments(organization_id,company_id,created_at DESC)
      WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS company_attachment_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      attachment_id uuid NOT NULL REFERENCES company_attachments(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      action text NOT NULL CHECK(action IN ('upload','download','delete','clean_expired')),
      at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
