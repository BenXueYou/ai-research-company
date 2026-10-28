export async function migrateCoefficient(client) {
    await client.query(`
    ALTER TABLE company_detail_queries DROP CONSTRAINT IF EXISTS company_detail_queries_state_check;
    ALTER TABLE company_detail_queries ADD CONSTRAINT company_detail_queries_state_check
      CHECK(state IN ('quoted','pending','settled','zero','failed','expired'));
    ALTER TABLE company_contact_queries DROP CONSTRAINT IF EXISTS company_contact_queries_state_check;
    ALTER TABLE company_contact_queries ADD CONSTRAINT company_contact_queries_state_check
      CHECK(state IN ('quoted','pending','settled','zero','failed','expired'));
    ALTER TABLE product_search_pages DROP CONSTRAINT IF EXISTS product_search_pages_state_check;
    ALTER TABLE product_search_pages ADD CONSTRAINT product_search_pages_state_check
      CHECK(state IN ('quoted','pending','settled','zero','failed','expired'));
    CREATE TABLE IF NOT EXISTS coefficient_changes (
      id uuid PRIMARY KEY,
      request_id uuid NOT NULL UNIQUE,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      previous_coefficient numeric(20,4) NOT NULL CHECK(previous_coefficient>0),
      proposed_coefficient numeric(20,4) NOT NULL CHECK(proposed_coefficient>0),
      effective_at timestamptz NOT NULL,
      notice text NOT NULL,
      announced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      activated_at timestamptz,
      coverage jsonb,
      CHECK((activated_at IS NULL AND coverage IS NULL) OR (activated_at IS NOT NULL AND coverage IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS coefficient_one_pending ON coefficient_changes((true)) WHERE activated_at IS NULL;
    CREATE OR REPLACE FUNCTION reject_coefficient_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.activated_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.request_id<>OLD.request_id
        OR NEW.actor_id<>OLD.actor_id OR NEW.previous_coefficient<>OLD.previous_coefficient
        OR NEW.proposed_coefficient<>OLD.proposed_coefficient OR NEW.effective_at<>OLD.effective_at
        OR NEW.notice<>OLD.notice OR NEW.announced_at<>OLD.announced_at THEN
        RAISE EXCEPTION 'Coefficient history is immutable';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER coefficient_history_guard BEFORE UPDATE ON coefficient_changes
      FOR EACH ROW EXECUTE FUNCTION reject_coefficient_history_rewrite();
  `);
}
//# sourceMappingURL=coefficient-schema.js.map