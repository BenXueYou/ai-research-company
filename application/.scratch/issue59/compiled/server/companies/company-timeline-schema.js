export async function migrateCompanyTimeline(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS timeline_manual_records (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      company_id uuid NOT NULL REFERENCES company_profiles(id),
      type text NOT NULL CHECK(type IN ('reply','note','whatsapp')),
      event_time timestamptz NOT NULL,
      contact_encrypted text,
      contact_display text,
      content text NOT NULL,
      created_by uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      deleted_by uuid REFERENCES accounts(id),
      deleted_at timestamptz,
      CHECK ((type='note' AND contact_encrypted IS NULL AND contact_display IS NULL)
        OR (type<>'note' AND contact_encrypted IS NOT NULL AND contact_display IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS timeline_manual_records_profile
      ON timeline_manual_records(organization_id,company_id,event_time DESC,id DESC) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS timeline_manual_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      record_id uuid NOT NULL REFERENCES timeline_manual_records(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      action text NOT NULL CHECK(action IN ('create','edit','delete')),
      at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
//# sourceMappingURL=company-timeline-schema.js.map