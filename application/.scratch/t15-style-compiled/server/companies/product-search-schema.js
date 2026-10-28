export async function migrateProductSearch(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS product_search_pages (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      product_desc text NOT NULL,
      buyer_country_code3 text NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      page_no integer NOT NULL CHECK(page_no BETWEEN 1 AND 1000),
      page_size integer NOT NULL CHECK(page_size BETWEEN 1 AND 20),
      coefficient numeric(20,4) NOT NULL CHECK(coefficient>0),
      maximum_points numeric(20,4) NOT NULL CHECK(maximum_points>0),
      price_version uuid NOT NULL,
      state text NOT NULL CHECK(state IN ('quoted','pending','settled','zero','failed')),
      actual_upstream_points numeric(20,4),
      charged_points numeric(20,4),
      total integer,
      trace_id text,
      result jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS product_search_pages_tenant ON product_search_pages(organization_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS product_search_one_active_page
      ON product_search_pages(organization_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size)
      WHERE state IN ('quoted','pending');
    CREATE TABLE IF NOT EXISTS product_search_candidates (
      id uuid PRIMARY KEY,
      page_id uuid NOT NULL REFERENCES product_search_pages(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      position integer NOT NULL,
      source_name text NOT NULL,
      UNIQUE(page_id,position)
    );
    CREATE TABLE IF NOT EXISTS product_search_ledger (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      page_id uuid NOT NULL REFERENCES product_search_pages(id),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      event text NOT NULL CHECK(event IN ('freeze','settle','release')),
      amount numeric(20,4) NOT NULL CHECK(amount>=0),
      balance_after numeric(20,4) NOT NULL,
      frozen_after numeric(20,4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(page_id,event)
    );
    CREATE TABLE IF NOT EXISTS product_candidate_checks (
      product_candidate_id uuid NOT NULL REFERENCES product_search_candidates(id),
      company_search_id uuid NOT NULL REFERENCES company_searches(id),
      PRIMARY KEY(product_candidate_id,company_search_id)
    );
    ALTER TABLE product_search_pages ADD COLUMN IF NOT EXISTS billing_reference text;
    CREATE TABLE IF NOT EXISTS product_search_reconciliations (
      page_id uuid PRIMARY KEY REFERENCES product_search_pages(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      outcome text NOT NULL,
      evidence text NOT NULL,
      billing_reference text NOT NULL,
      trace_id text,
      result_evidence jsonb,
      resolved_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS product_search_late_results (
      id uuid PRIMARY KEY,
      page_id uuid NOT NULL REFERENCES product_search_pages(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      trace_id text NOT NULL,
      billing_reference text NOT NULL,
      result jsonb NOT NULL,
      evidence text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(page_id,trace_id,billing_reference)
    );
    CREATE TABLE IF NOT EXISTS product_search_losses (
      page_id uuid PRIMARY KEY REFERENCES product_search_pages(id),
      purpose text NOT NULL CHECK(purpose IN ('failure','excess')),
      upstream_points numeric(20,4) NOT NULL CHECK(upstream_points>0),
      billing_reference text NOT NULL,
      evidence text NOT NULL,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE platform_expenses ADD COLUMN IF NOT EXISTS product_loss_page_id uuid UNIQUE REFERENCES product_search_losses(page_id);
  `);
}
//# sourceMappingURL=product-search-schema.js.map