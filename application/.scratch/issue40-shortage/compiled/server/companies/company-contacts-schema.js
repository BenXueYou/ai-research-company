export async function migrateCompanyContacts(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS company_contact_queries (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      profile_id uuid NOT NULL REFERENCES company_profiles(id),
      company_name text NOT NULL,
      position_tags text[] NOT NULL,
      page_no integer NOT NULL CHECK(page_no>0),
      page_size integer NOT NULL CHECK(page_size>0),
      coefficient numeric(20,4) NOT NULL CHECK(coefficient>0),
      maximum_points numeric(20,4) NOT NULL CHECK(maximum_points>0),
      price_version uuid NOT NULL,
      state text NOT NULL CHECK(state IN ('quoted','pending','settled','zero','failed')),
      actual_upstream_points numeric(20,4),
      charged_points numeric(20,4),
      total integer,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS company_contact_one_active_page
      ON company_contact_queries(organization_id,profile_id,position_tags,page_no,page_size)
      WHERE state IN ('quoted','pending');
    CREATE TABLE IF NOT EXISTS company_contacts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      profile_id uuid NOT NULL REFERENCES company_profiles(id),
      query_id uuid NOT NULL REFERENCES company_contact_queries(id),
      mailsou_id text NOT NULL,
      query_company_name text NOT NULL,
      returned_company_name text NOT NULL,
      ownership_status text NOT NULL CHECK(ownership_status IN ('matched','pending')),
      email text,
      personal_email text,
      position_tag text,
      credibility text,
      source_payload jsonb NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(organization_id,profile_id,mailsou_id)
    );
    CREATE TABLE IF NOT EXISTS company_contact_page_items (
      query_id uuid NOT NULL REFERENCES company_contact_queries(id),
      contact_id uuid NOT NULL REFERENCES company_contacts(id),
      PRIMARY KEY(query_id,contact_id)
    );
    ALTER TABLE company_contact_queries ADD COLUMN IF NOT EXISTS refresh_requested boolean NOT NULL DEFAULT false;
    ALTER TABLE company_contacts ADD COLUMN IF NOT EXISTS not_returned_in_last_update boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS company_contact_source_history (
      query_id uuid NOT NULL REFERENCES company_contact_queries(id),
      contact_id uuid NOT NULL REFERENCES company_contacts(id),
      mailsou_id text NOT NULL,
      source_payload jsonb NOT NULL,
      returned_company_name text NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(query_id,contact_id)
    );
    INSERT INTO company_contact_source_history(query_id,contact_id,mailsou_id,source_payload,returned_company_name,fetched_at)
      SELECT query_id,id,mailsou_id,source_payload,returned_company_name,fetched_at FROM company_contacts
      ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS company_contact_point_ledger (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      query_id uuid NOT NULL REFERENCES company_contact_queries(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      event text NOT NULL CHECK(event IN ('freeze','settle','release')),
      amount numeric(20,4) NOT NULL CHECK(amount>=0),
      balance_after numeric(20,4) NOT NULL,
      frozen_after numeric(20,4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(query_id,event)
    );
    CREATE TABLE IF NOT EXISTS company_contact_reconciliations (
      query_id uuid PRIMARY KEY REFERENCES company_contact_queries(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      evidence text NOT NULL,
      resolved_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE company_contact_queries ADD COLUMN IF NOT EXISTS trace_id text;
    ALTER TABLE company_contact_queries ADD COLUMN IF NOT EXISTS billing_reference text;
    ALTER TABLE company_contact_queries ADD COLUMN IF NOT EXISTS result_evidence jsonb;
    ALTER TABLE company_contact_reconciliations ADD COLUMN IF NOT EXISTS outcome text;
    ALTER TABLE company_contact_reconciliations ADD COLUMN IF NOT EXISTS billing_reference text;
    ALTER TABLE company_contact_reconciliations ADD COLUMN IF NOT EXISTS trace_id text;
    ALTER TABLE company_contact_reconciliations ADD COLUMN IF NOT EXISTS result_evidence jsonb;
    CREATE TABLE IF NOT EXISTS company_contact_late_results (
      id uuid PRIMARY KEY,
      query_id uuid NOT NULL REFERENCES company_contact_queries(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      trace_id text NOT NULL,
      billing_reference text NOT NULL,
      result jsonb NOT NULL,
      evidence text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(query_id,trace_id,billing_reference)
    );
    CREATE TABLE IF NOT EXISTS company_contact_losses (
      query_id uuid PRIMARY KEY REFERENCES company_contact_queries(id),
      purpose text NOT NULL CHECK(purpose IN ('failure','excess')),
      upstream_points numeric(20,4) NOT NULL CHECK(upstream_points>0),
      billing_reference text NOT NULL,
      evidence text NOT NULL,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE platform_expenses ADD COLUMN IF NOT EXISTS contact_loss_query_id uuid UNIQUE REFERENCES company_contact_losses(query_id);
  `);
}
//# sourceMappingURL=company-contacts-schema.js.map