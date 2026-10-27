export async function migrateEmailPreview(client) {
    await client.query(`
    ALTER TABLE company_contacts ADD COLUMN IF NOT EXISTS unsubscribed boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS contact_ownership_confirmations (
      contact_id uuid PRIMARY KEY REFERENCES company_contacts(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      source_returned_company_name text NOT NULL,
      confirmed_by uuid NOT NULL REFERENCES accounts(id),
      reason text NOT NULL,
      confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS public_templates (
      id uuid PRIMARY KEY,
      name text NOT NULL UNIQUE,
      current_version integer NOT NULL CHECK(current_version>0)
    );
    CREATE TABLE IF NOT EXISTS public_template_attachments (
      id uuid PRIMARY KEY,
      sha256 text NOT NULL,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 2097152),
      content bytea,
      scanned_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '2 years',
      cleaned_at timestamptz,
      created_by uuid NOT NULL REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS public_template_versions (
      template_id uuid NOT NULL REFERENCES public_templates(id),
      version integer NOT NULL CHECK(version>0),
      subject text NOT NULL,
      content text NOT NULL,
      attachment_ids uuid[] NOT NULL DEFAULT '{}',
      created_by uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(template_id,version)
    );
    CREATE TABLE IF NOT EXISTS public_template_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      event text NOT NULL CHECK(event IN ('version_created','attachment_cleaned')),
      template_id uuid REFERENCES public_templates(id),
      version integer,
      attachment_id uuid REFERENCES public_template_attachments(id),
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS email_previews (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      profile_id uuid NOT NULL REFERENCES company_profiles(id),
      template_id uuid NOT NULL REFERENCES public_templates(id),
      template_version integer NOT NULL,
      subject text NOT NULL,
      content text NOT NULL,
      attachment_ids uuid[] NOT NULL,
      recipient_snapshot jsonb NOT NULL,
      preview_snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(template_id,template_version) REFERENCES public_template_versions(template_id,version)
    );
    CREATE TABLE IF NOT EXISTS email_drafts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      profile_id uuid NOT NULL REFERENCES company_profiles(id),
      template_id uuid NOT NULL REFERENCES public_templates(id),
      template_version integer NOT NULL,
      subject text NOT NULL,
      content text NOT NULL,
      selections jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(template_id,template_version) REFERENCES public_template_versions(template_id,version)
    );
  `);
}
//# sourceMappingURL=email-preview-schema.js.map