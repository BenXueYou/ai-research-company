import type { PoolClient } from 'pg';

export async function migrateCompanySearch(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS company_searches (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      name text NOT NULL,
      country_codes text NOT NULL,
      page_no integer NOT NULL CHECK(page_no BETWEEN 1 AND 1000),
      page_size integer NOT NULL CHECK(page_size BETWEEN 1 AND 20),
      total integer NOT NULL CHECK(total >= 0),
      trace_id text,
      status text NOT NULL CHECK(status IN ('pending_verification','verified')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS company_searches_tenant_created
      ON company_searches(organization_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS company_candidates (
      id uuid PRIMARY KEY,
      search_id uuid NOT NULL REFERENCES company_searches(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      source_id text NOT NULL,
      source_name text NOT NULL,
      source_country text NOT NULL,
      verification_status text NOT NULL DEFAULT 'pending'
        CHECK(verification_status IN ('pending','verified','not_selected')),
      verified_by uuid REFERENCES accounts(id),
      verified_at timestamptz,
      UNIQUE(search_id,source_id)
    );
    CREATE INDEX IF NOT EXISTS company_candidates_tenant
      ON company_candidates(organization_id,search_id);
    CREATE TABLE IF NOT EXISTS tengdao_call_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      organization_id uuid REFERENCES organizations(id),
      actor_id uuid REFERENCES accounts(id),
      endpoint text NOT NULL,
      call_class text NOT NULL CHECK(call_class IN ('business','data')),
      charge_kind text NOT NULL CHECK(charge_kind IN ('free','paid')),
      result text NOT NULL CHECK(result IN ('success','rejected','failed')),
      trace_id text,
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
