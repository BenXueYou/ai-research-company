export async function migrateUpstreamMonitor(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS upstream_account_snapshot (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      balance text NOT NULL,
      expires_in text NOT NULL,
      trace_id text,
      fetched_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS upstream_monitor_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES accounts(id),
      endpoint text NOT NULL,
      result text NOT NULL CHECK(result IN ('success','failed')),
      category text,
      trace_id text,
      duration_ms integer NOT NULL CHECK(duration_ms>=0),
      happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
}
//# sourceMappingURL=upstream-monitor-schema.js.map