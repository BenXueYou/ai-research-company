export async function migrateOrganizationState(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS organization_state_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    actor_id uuid NOT NULL REFERENCES accounts(id),
    active boolean NOT NULL,
    paused_recipients integer NOT NULL DEFAULT 0,
    happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE OR REPLACE TRIGGER immutable_organization_state_events BEFORE UPDATE OR DELETE ON organization_state_events
    FOR EACH ROW EXECUTE FUNCTION reject_procurement_rewrite();`);
}
//# sourceMappingURL=organization-state-schema.js.map