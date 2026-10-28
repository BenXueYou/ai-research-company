import type { PoolClient } from 'pg';

export async function migrateOrders(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS distributor_inventory (
      organization_id uuid PRIMARY KEY REFERENCES organizations(id),
      balance numeric(20,4) NOT NULL DEFAULT 0 CHECK(balance>=0),
      frozen numeric(20,4) NOT NULL DEFAULT 0 CHECK(frozen>=0),
      reserved numeric(20,4) NOT NULL DEFAULT 0 CHECK(reserved>=0),
      average_cost numeric(20,4) NOT NULL DEFAULT 0 CHECK(average_cost>=0),
      CHECK(balance>=frozen+reserved)
    );
    CREATE TABLE IF NOT EXISTS point_orders (
      id uuid PRIMARY KEY,
      seller_id uuid NOT NULL REFERENCES organizations(id),
      buyer_id uuid NOT NULL REFERENCES organizations(id),
      quantity numeric(20,4) NOT NULL CHECK(quantity>0),
      unit_price numeric(20,4) NOT NULL CHECK(unit_price>0),
      amount numeric(20,4) NOT NULL CHECK(amount>0),
      status text NOT NULL CHECK(status IN ('unpaid','reserved','transferred','refunded')),
      receipt_reference text UNIQUE,
      created_by uuid NOT NULL REFERENCES accounts(id),
      confirmed_by uuid REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      confirmed_at timestamptz,
      CHECK((status='unpaid' AND receipt_reference IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL)
        OR (status IN ('reserved','transferred','refunded') AND receipt_reference IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS point_orders_seller ON point_orders(seller_id,created_at);
    ALTER TABLE point_orders DROP CONSTRAINT IF EXISTS point_orders_status_check;
    ALTER TABLE point_orders ADD CONSTRAINT point_orders_status_check CHECK(status IN ('unpaid','reserved','transferred','refunded'));
    ALTER TABLE point_orders DROP CONSTRAINT IF EXISTS point_orders_check;
    ALTER TABLE point_orders ADD CONSTRAINT point_orders_check CHECK((status='unpaid' AND receipt_reference IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL)
      OR (status IN ('reserved','transferred','refunded') AND receipt_reference IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL));
    CREATE TABLE IF NOT EXISTS point_order_requests (
      request_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES accounts(id),
      operation text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS point_order_ledger (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id uuid NOT NULL UNIQUE REFERENCES point_orders(id),
      seller_id uuid NOT NULL REFERENCES organizations(id),
      quantity numeric(20,4) NOT NULL CHECK(quantity>0),
      balance_after numeric(20,4) NOT NULL,
      reserved_after numeric(20,4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS point_transfers (
      order_id uuid PRIMARY KEY REFERENCES point_orders(id),
      seller_id uuid NOT NULL REFERENCES organizations(id), buyer_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id), quantity numeric(20,4) NOT NULL CHECK(quantity>0),
      seller_balance_after numeric(20,4) NOT NULL, seller_reserved_after numeric(20,4) NOT NULL,
      buyer_balance_after numeric(20,4) NOT NULL, buyer_average_cost_after numeric(20,4),
      sales_unit_cost numeric(20,4) NOT NULL, sales_cost numeric(20,4) NOT NULL,
      sales_amount numeric(20,4) NOT NULL, gross_profit numeric(20,4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS point_order_refunds (
      order_id uuid PRIMARY KEY REFERENCES point_orders(id),
      seller_id uuid NOT NULL REFERENCES organizations(id),
      actor_id uuid NOT NULL REFERENCES accounts(id),
      amount numeric(20,4) NOT NULL CHECK(amount>0),
      evidence text NOT NULL CHECK(length(trim(evidence))>0),
      released_quantity numeric(20,4) NOT NULL CHECK(released_quantity>0),
      reserved_after numeric(20,4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE OR REPLACE TRIGGER immutable_point_order_refunds BEFORE UPDATE OR DELETE ON point_order_refunds
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
    CREATE OR REPLACE TRIGGER immutable_point_transfers BEFORE UPDATE OR DELETE ON point_transfers
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
    CREATE OR REPLACE TRIGGER immutable_point_order_ledger BEFORE UPDATE OR DELETE ON point_order_ledger
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
    CREATE OR REPLACE TRIGGER immutable_point_order_requests BEFORE UPDATE OR DELETE ON point_order_requests
      FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();
  `);
}
