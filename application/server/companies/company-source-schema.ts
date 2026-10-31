import type { PoolClient } from 'pg';

export async function migrateCompanySources(db: PoolClient): Promise<void> {
  await db.query(`
    ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 0;
    ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS displayed_snapshot_id uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS company_sources_tenant_id ON company_profile_sources(organization_id,id);
    CREATE UNIQUE INDEX IF NOT EXISTS company_candidates_tenant_id ON company_candidates(organization_id,id);
    CREATE UNIQUE INDEX IF NOT EXISTS company_detail_queries_tenant_id ON company_detail_queries(organization_id,id);
    CREATE TABLE IF NOT EXISTS company_source_selections (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      profile_id uuid NOT NULL,
      source_id uuid NOT NULL,
      candidate_id uuid NOT NULL,
      version integer NOT NULL CHECK(version>0),
      request_id uuid NOT NULL,
      record_id text NOT NULL CHECK(length(record_id)>0),
      name text NOT NULL,
      country_code3 text NOT NULL CHECK(country_code3 ~ '^[A-Z]{3}$'),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(organization_id,id),
      UNIQUE(organization_id,profile_id,version),
      UNIQUE(organization_id,actor_id,request_id),
      FOREIGN KEY(organization_id,profile_id) REFERENCES company_profiles(organization_id,id),
      FOREIGN KEY(organization_id,source_id) REFERENCES company_profile_sources(organization_id,id),
      FOREIGN KEY(organization_id,candidate_id) REFERENCES company_candidates(organization_id,id)
    );
    CREATE TABLE IF NOT EXISTS company_operation_evidence (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      source_version integer NOT NULL CHECK(source_version>=0),
      operation text NOT NULL CHECK(operation IN ('contacts','email')),
      company_name text NOT NULL,
      country_code3 text NOT NULL,
      evidence_reference text NOT NULL CHECK(length(trim(evidence_reference))>0),
      evidence_kind text NOT NULL CHECK(evidence_kind IN ('supplier_verified','controlled_test')),
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(organization_id,profile_id) REFERENCES company_profiles(organization_id,id)
    );
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS target_profile_id uuid;
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS selection_id uuid;
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS result_state text NOT NULL DEFAULT 'absent'
      CHECK(result_state IN ('absent','ready','zero','conflict'));
    ALTER TABLE company_detail_queries ADD COLUMN IF NOT EXISTS request_snapshot jsonb;
    CREATE TABLE IF NOT EXISTS company_detail_snapshots (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      selection_id uuid NOT NULL,
      query_id uuid NOT NULL UNIQUE,
      state text NOT NULL CHECK(state IN ('ready','zero','conflict')),
      payload jsonb NOT NULL,
      reason text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,profile_id) REFERENCES company_profiles(organization_id,id),
      FOREIGN KEY(organization_id,selection_id) REFERENCES company_source_selections(organization_id,id),
      FOREIGN KEY(organization_id,query_id) REFERENCES company_detail_queries(organization_id,id)
    );
    CREATE TABLE IF NOT EXISTS company_detail_display_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      organization_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      snapshot_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(organization_id,profile_id) REFERENCES company_profiles(organization_id,id),
      FOREIGN KEY(organization_id,snapshot_id) REFERENCES company_detail_snapshots(organization_id,id)
    );
    ALTER TABLE company_contact_queries ADD COLUMN IF NOT EXISTS identity_version integer;
    ALTER TABLE email_previews ADD COLUMN IF NOT EXISTS identity_version integer;
    ALTER TABLE email_batches ADD COLUMN IF NOT EXISTS identity_version integer;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='detail_target_tenant_fk') THEN
        ALTER TABLE company_detail_queries ADD CONSTRAINT detail_target_tenant_fk
          FOREIGN KEY(organization_id,target_profile_id) REFERENCES company_profiles(organization_id,id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='detail_selection_tenant_fk') THEN
        ALTER TABLE company_detail_queries ADD CONSTRAINT detail_selection_tenant_fk
          FOREIGN KEY(organization_id,selection_id) REFERENCES company_source_selections(organization_id,id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profile_display_tenant_fk') THEN
        ALTER TABLE company_profiles ADD CONSTRAINT profile_display_tenant_fk
          FOREIGN KEY(organization_id,displayed_snapshot_id) REFERENCES company_detail_snapshots(organization_id,id);
      END IF;
    END $$;
  `);
}
