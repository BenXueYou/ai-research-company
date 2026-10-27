import type { PoolClient } from 'pg';

export async function migrateProcurement(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_pricing (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      coefficient numeric(20,4) NOT NULL DEFAULT 1 CHECK(coefficient>0),
      minimum_markup numeric(20,4) NOT NULL DEFAULT 0.01 CHECK(minimum_markup>=0)
    );
    INSERT INTO platform_pricing(singleton) VALUES(true) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS platform_inventory (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      balance numeric(20,4) NOT NULL DEFAULT 0 CHECK(balance>=0),
      frozen numeric(20,4) NOT NULL DEFAULT 0 CHECK(frozen>=0),
      reserved numeric(20,4) NOT NULL DEFAULT 0 CHECK(reserved>=0),
      average_cost numeric(20,4) NOT NULL DEFAULT 0 CHECK(average_cost>=0),
      CHECK(balance>=frozen+reserved)
    );
    INSERT INTO platform_inventory(singleton) VALUES(true) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS procurement_requests (
      request_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES accounts(id),
      operation text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interface_prices (
      interface_path text PRIMARY KEY, upstream_unit_price numeric(20,4) NOT NULL CHECK(upstream_unit_price>=0),
      maximum_billable_units integer NOT NULL CHECK(maximum_billable_units>0),
      evidence text NOT NULL, evidence_type text NOT NULL CHECK(evidence_type IN ('supplier_verified','controlled_test')),
      version uuid NOT NULL, actor_id uuid NOT NULL REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS platform_expenses (
      id uuid PRIMARY KEY, purpose text NOT NULL CHECK(purpose IN ('coverage','failure','excess')),
      source_reference text NOT NULL UNIQUE, amount numeric(20,4) NOT NULL CHECK(amount>0),
      evidence text NOT NULL, actor_id uuid NOT NULL REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS point_purchases (
      id uuid PRIMARY KEY, purpose text NOT NULL CHECK(purpose IN ('sale','coverage','failure','excess')),
      upstream_points numeric(20,4) NOT NULL CHECK(upstream_points>0),
      coefficient_snapshot numeric(20,4) NOT NULL CHECK(coefficient_snapshot>0),
      generated_internal_points numeric(20,4) NOT NULL CHECK(generated_internal_points>=0),
      amount numeric(20,4) NOT NULL CHECK(amount>0), receipt_reference text NOT NULL UNIQUE,
      evidence text NOT NULL, expense_id uuid UNIQUE REFERENCES platform_expenses(id),
      actor_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK((purpose='sale' AND generated_internal_points>0 AND expense_id IS NULL) OR
        (purpose<>'sale' AND generated_internal_points=0 AND expense_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS procurement_ledger (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event text NOT NULL CHECK(event IN ('purchase','expense','pricing')),
      reference text NOT NULL, actor_id uuid NOT NULL REFERENCES accounts(id),
      internal_delta numeric(20,4) NOT NULL DEFAULT 0,
      upstream_delta numeric(20,4) NOT NULL DEFAULT 0,
      cash_outflow numeric(20,4) NOT NULL DEFAULT 0,
      expense_delta numeric(20,4) NOT NULL DEFAULT 0,
      balance_after numeric(20,4) NOT NULL, average_cost_after numeric(20,4) NOT NULL,
      details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE OR REPLACE FUNCTION reject_procurement_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Accounting records are append only'; END $$;
    CREATE OR REPLACE TRIGGER immutable_procurement_ledger BEFORE UPDATE OR DELETE ON procurement_ledger
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
    CREATE OR REPLACE TRIGGER immutable_point_purchases BEFORE UPDATE OR DELETE ON point_purchases
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
    CREATE OR REPLACE TRIGGER immutable_platform_expenses BEFORE UPDATE OR DELETE ON platform_expenses
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
    CREATE OR REPLACE TRIGGER immutable_procurement_requests BEFORE UPDATE OR DELETE ON procurement_requests
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
  `);
}
