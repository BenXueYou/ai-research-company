import type { PoolClient } from 'pg';

export async function migrateCompanyProfileImports(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE company_profiles ALTER COLUMN detail_id DROP NOT NULL;
    ALTER TABLE company_profiles ALTER COLUMN country_code3 DROP NOT NULL;
    ALTER TABLE company_profiles ALTER COLUMN detail DROP NOT NULL;
    ALTER TABLE company_profiles ALTER COLUMN query_id DROP NOT NULL;
    ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS identity_state text NOT NULL DEFAULT 'verified'
      CHECK(identity_state IN ('pending','verified','conflict'));
    ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS detail_state text NOT NULL DEFAULT 'ready'
      CHECK(detail_state IN ('absent','ready'));
    CREATE UNIQUE INDEX IF NOT EXISTS company_profiles_tenant_id ON company_profiles(organization_id,id);
    CREATE TABLE IF NOT EXISTS company_profile_sources (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      profile_id uuid NOT NULL,
      source_kind text NOT NULL CHECK(source_kind IN ('company_candidate','product_candidate','legacy_detail')),
      source_record_id uuid NOT NULL,
      source_payload jsonb NOT NULL,
      search_conditions jsonb NOT NULL,
      page_no integer NOT NULL CHECK(page_no BETWEEN 1 AND 1000),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(organization_id,profile_id) REFERENCES company_profiles(organization_id,id),
      UNIQUE(organization_id,source_kind,source_record_id)
    );
    CREATE INDEX IF NOT EXISTS company_profile_sources_profile
      ON company_profile_sources(organization_id,profile_id,created_at,id);
    CREATE TABLE IF NOT EXISTS company_profile_import_requests (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      request_id uuid NOT NULL,
      request_hash text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(organization_id,actor_id,request_id)
    );
  `);
}
