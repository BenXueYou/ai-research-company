export async function migrateCompanyDetail(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS internal_point_accounts (
      organization_id uuid PRIMARY KEY REFERENCES organizations(id),
      balance numeric(20,4) NOT NULL DEFAULT 0 CHECK(balance>=0),
      query_frozen numeric(20,4) NOT NULL DEFAULT 0 CHECK(query_frozen>=0),
      sales_reserved numeric(20,4) NOT NULL DEFAULT 0 CHECK(sales_reserved>=0),
      CHECK(balance>=query_frozen+sales_reserved)
    );
    CREATE TABLE IF NOT EXISTS company_detail_queries (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      candidate_id uuid NOT NULL REFERENCES company_candidates(id),
      name text NOT NULL,
      country_code3 text NOT NULL,
      coefficient numeric(20,4) NOT NULL CHECK(coefficient>0),
      maximum_points numeric(20,4) NOT NULL CHECK(maximum_points>0),
      price_version uuid NOT NULL,
      state text NOT NULL CHECK(state IN ('quoted','pending','settled','zero','failed')),
      actual_upstream_points numeric(20,4),
      charged_points numeric(20,4),
      detail_id text,
      result jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS company_detail_queries_tenant ON company_detail_queries(organization_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS company_detail_one_active_candidate
      ON company_detail_queries(organization_id,candidate_id) WHERE state IN ('quoted','pending');
    CREATE TABLE IF NOT EXISTS query_point_ledger (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      query_id uuid NOT NULL REFERENCES company_detail_queries(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      event text NOT NULL CHECK(event IN ('freeze','settle','release')),
      amount numeric(20,4) NOT NULL CHECK(amount>=0),
      balance_after numeric(20,4) NOT NULL,
      frozen_after numeric(20,4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(query_id,event)
    );
    CREATE TABLE IF NOT EXISTS company_profiles (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      detail_id text NOT NULL,
      name text NOT NULL,
      country_code3 text NOT NULL,
      detail jsonb NOT NULL,
      query_id uuid NOT NULL REFERENCES company_detail_queries(id),
      fetched_at timestamptz,
      UNIQUE(organization_id,detail_id)
    );
    ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS fetched_at timestamptz;
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS refresh_profile_id uuid REFERENCES company_profiles(id);
    CREATE TABLE IF NOT EXISTS company_detail_reconciliations (
      query_id uuid PRIMARY KEY REFERENCES company_detail_queries(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      evidence text NOT NULL,
      resolved_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS trace_id text;
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS billing_reference text;
    ALTER TABLE company_detail_reconciliations ADD COLUMN IF NOT EXISTS outcome text;
    ALTER TABLE company_detail_reconciliations ADD COLUMN IF NOT EXISTS billing_reference text;
    ALTER TABLE company_detail_reconciliations ADD COLUMN IF NOT EXISTS trace_id text;
    ALTER TABLE company_detail_reconciliations ADD COLUMN IF NOT EXISTS result_evidence jsonb;
    CREATE TABLE IF NOT EXISTS company_detail_late_results (
      id uuid PRIMARY KEY,
      query_id uuid NOT NULL REFERENCES company_detail_queries(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      trace_id text NOT NULL,
      billing_reference text NOT NULL,
      result jsonb NOT NULL,
      evidence text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(query_id,trace_id,billing_reference)
    );
    CREATE TABLE IF NOT EXISTS company_detail_losses (
      query_id uuid PRIMARY KEY REFERENCES company_detail_queries(id),
      purpose text NOT NULL CHECK(purpose IN ('failure','excess')),
      upstream_points numeric(20,4) NOT NULL CHECK(upstream_points>0),
      billing_reference text NOT NULL,
      evidence text NOT NULL,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE platform_expenses ADD COLUMN IF NOT EXISTS detail_loss_query_id uuid UNIQUE REFERENCES company_detail_losses(query_id);
  `);
}
//# sourceMappingURL=company-detail-schema.js.map