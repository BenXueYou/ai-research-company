import { migrateCompanySources } from '../companies/company-source-schema.js';
import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import type pg from 'pg';
import { transaction } from '../database.js';
import { migrateCompanyProfileImports } from '../companies/company-profile-import-schema.js';

export const BASELINE_VERSION = '2026-10-31.current';
export const IMPORT_VERSION = '2026-10-31.issue-02-initial-profiles';
export const CURRENT_VERSION = '2026-10-31.issue-04-05-sources';
export const UPGRADE_LOCK_KEY = 712011;

// This is deliberately a list of the structure owned by the current release. New
// business tables belong to their own tickets and must not be silently accepted here.
export const KNOWN_TABLES = [
  'accounts', 'application_keys', 'audit_events', 'bootstrap_marker', 'coefficient_changes',
  'company_attachment_audit', 'company_attachments', 'company_candidates', 'company_contact_late_results',
  'company_contact_losses', 'company_contact_page_items', 'company_contact_point_ledger', 'company_contact_queries',
  'company_contact_reconciliations', 'company_contact_source_history', 'company_contacts', 'company_detail_late_results',
  'company_detail_losses', 'company_detail_queries', 'company_detail_reconciliations', 'company_profile_events',
  'company_profiles', 'company_searches', 'contact_ownership_confirmations', 'distributor_inventory', 'email_batches',
  'email_daily_usage', 'email_drafts', 'email_evidence_checks', 'email_limit_audit', 'email_previews', 'email_recipients',
  'email_usage_events', 'interface_prices', 'internal_point_accounts', 'login_throttles', 'member_audit', 'member_creations',
  'opening_audit', 'organization_email_limits', 'organization_openings', 'organization_state_events', 'organizations',
  'password_reset_audit', 'password_reset_requests', 'platform_expenses', 'platform_inventory', 'platform_pricing',
  'point_order_ledger', 'point_order_refunds', 'point_order_requests', 'point_orders', 'point_purchases', 'point_transfers',
  'procurement_ledger', 'procurement_requests', 'product_candidate_checks', 'product_search_candidates',
  'product_search_late_results', 'product_search_ledger', 'product_search_losses', 'product_search_pages',
  'product_search_reconciliations', 'public_template_attachments', 'public_template_audit', 'public_template_versions',
  'public_templates', 'query_point_ledger', 'sending_channel_audit', 'sessions', 'smtp_configuration_requests',
  'team_sending_channels', 'tengdao_call_audit', 'timeline_manual_audit', 'timeline_manual_records', 'umail_audit_events',
  'umail_channel_requests', 'umail_resource_requests', 'umail_resources', 'upstream_account_snapshot', 'upstream_monitor_events',
].sort();
export const IMPORT_TABLES = [...KNOWN_TABLES,
  'company_profile_import_requests', 'company_profile_sources'
].sort();

const REQUIRED_COLUMNS: Record<string, string[]> = {
  organizations: ['id', 'name', 'kind', 'parent_id'],
  accounts: ['id', 'organization_id', 'password_hash', 'role'],
  company_profiles: ['id', 'organization_id'],
  company_contacts: ['id', 'organization_id'],
  company_attachments: ['id', 'organization_id'],
  timeline_manual_records: ['id', 'organization_id'],
  email_drafts: ['id', 'organization_id'],
  email_previews: ['id', 'organization_id'],
  company_detail_queries: ['id', 'organization_id'],
  company_contact_queries: ['id', 'organization_id'],
  product_search_pages: ['id', 'organization_id'],
  internal_point_accounts: ['organization_id', 'balance', 'query_frozen', 'sales_reserved'],
  query_point_ledger: ['id', 'organization_id'],
  procurement_ledger: ['id', 'event', 'reference'],
};
const IMPORT_REQUIRED_COLUMNS: Record<string, string[]> = {
  ...REQUIRED_COLUMNS,
  company_profiles: ['id', 'organization_id', 'identity_state', 'detail_state'],
  company_profile_sources: ['id', 'organization_id', 'profile_id', 'source_kind', 'source_record_id'],
  company_profile_import_requests: ['organization_id', 'actor_id', 'request_id', 'request_hash', 'response'],
};

export const CURRENT_TABLES = [...IMPORT_TABLES, 'company_source_selections', 'company_operation_evidence', 'company_detail_snapshots', 'company_detail_display_events'].sort();
const CURRENT_REQUIRED_COLUMNS = { ...IMPORT_REQUIRED_COLUMNS, company_profiles: ['id', 'organization_id', 'source_version', 'displayed_snapshot_id'], company_source_selections: ['id', 'version', 'record_id'], company_detail_snapshots: ['id', 'query_id', 'state'] };

type Fingerprint = { schema: string; data: Record<string, { count: number; digest: string }> };
export type UpgradePlan = { version: string; baseline: boolean; pending: string[]; checksum?: string; snapshot?: Fingerprint };

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`非法标识符: ${value}`);
  return `"${value}"`;
}

async function tableNames(client: pg.PoolClient): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  );
  return result.rows.map(row => row.table_name).filter(name => !['schema_migrations', 'upgrade_snapshots'].includes(name));
}

async function assertKnownStructure(
  client: pg.PoolClient,
  knownTables: string[],
  requiredColumns: Record<string, string[]>
): Promise<void> {
  const actual = await tableNames(client);
  const expected = new Set(knownTables);
  const unknown = actual.filter(name => !expected.has(name));
  const missing = knownTables.filter(name => !actual.includes(name));
  if (unknown.length || missing.length) {
    throw new Error(`结构不属于当前已知baseline；未知表=${unknown.join(',') || '-'}；缺失表=${missing.join(',') || '-'}`);
  }
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table],
    );
    const available = new Set(result.rows.map(row => row.column_name));
    const missingColumns = columns.filter(column => !available.has(column));
    if (missingColumns.length) throw new Error(`表 ${table} 缺少已知列: ${missingColumns.join(',')}`);
  }
}

async function fingerprint(
  client: pg.PoolClient,
  knownTables: string[],
  requiredColumns: Record<string, string[]>
): Promise<Fingerprint> {
  await assertKnownStructure(client, knownTables, requiredColumns);
  const schemaParts: string[] = [];
  const data: Fingerprint['data'] = {};
  for (const table of knownTables) {
    const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table],
    );
    schemaParts.push(`${table}:${columns.rows.map(column => `${column.column_name}:${column.data_type}:${column.is_nullable}`).join('|')}`);
    const q = quoteIdentifier(table);
    const rows = await client.query<{ count: string; digest: string }>(
      `SELECT count(*)::text AS count, COALESCE(md5(string_agg(md5(row_to_json(t)::text), ',' ORDER BY md5(row_to_json(t)::text))), md5('')) AS digest FROM ${q} t`,
    );
    data[table] = { count: Number(rows.rows[0].count), digest: rows.rows[0].digest };
  }
  return { schema: createHash('sha256').update(schemaParts.join('\n')).digest('hex'), data };
}

function checksum(value: Fingerprint): string {
  return value.schema;
}

async function metadata(client: pg.PoolClient): Promise<{ version: string; checksum: string; baseline: boolean } | undefined> {
  const result = await client.query<{ version: string; checksum: string; baseline: boolean }>(
    `SELECT version,checksum,baseline FROM schema_migrations ORDER BY applied_at DESC LIMIT 1`,
  ).catch(error => {
    if ((error as { code?: string }).code === '42P01') return { rows: [] } as { rows: [] };
    throw error;
  });
  return result.rows[0];
}

async function snapshot(client: pg.PoolClient): Promise<Fingerprint | undefined> {
  const result = await client.query<{ fingerprint: Fingerprint }>(
    `SELECT fingerprint FROM upgrade_snapshots ORDER BY created_at DESC LIMIT 1`,
  ).catch(error => {
    if ((error as { code?: string }).code === '42P01') return { rows: [] } as { rows: [] };
    throw error;
  });
  return result.rows[0]?.fingerprint;
}

async function planImportsUpgrade(pool: pg.Pool): Promise<UpgradePlan> {
  const client = await pool.connect();
  try {
    const migration = await metadata(client);
    if (migration && ![BASELINE_VERSION, IMPORT_VERSION].includes(migration.version))
      throw new Error(`未知迁移版本: ${migration.version}`);
    if (migration?.version === BASELINE_VERSION) {
      const baseline = await fingerprint(client, KNOWN_TABLES, REQUIRED_COLUMNS);
      if (migration.checksum !== checksum(baseline)) throw new Error('baseline校验和不符；拒绝继续升级');
      return {
        version: IMPORT_VERSION,
        baseline: true,
        pending: [IMPORT_VERSION],
        checksum: checksum(baseline),
        snapshot: baseline,
      };
    }
    if (migration?.version === IMPORT_VERSION) {
      const current = await fingerprint(client, IMPORT_TABLES, IMPORT_REQUIRED_COLUMNS);
      if (migration.checksum !== checksum(current)) throw new Error('当前版本校验和不符；拒绝继续升级');
      return {
        version: IMPORT_VERSION,
        baseline: false,
        pending: [],
        checksum: checksum(current),
        snapshot: current,
      };
    }
    let current: Fingerprint;
    try {
      const baseline = await fingerprint(client, KNOWN_TABLES, REQUIRED_COLUMNS);
      return {
        version: IMPORT_VERSION,
        baseline: false,
        pending: [BASELINE_VERSION, IMPORT_VERSION],
        checksum: checksum(baseline),
        snapshot: baseline,
      };
    } catch {
      current = await fingerprint(client, IMPORT_TABLES, IMPORT_REQUIRED_COLUMNS);
    }
    return {
      version: IMPORT_VERSION,
      baseline: false,
      pending: [IMPORT_VERSION],
      checksum: checksum(current),
      snapshot: current,
    };
  } finally { client.release(); }
}

async function applyImportsUpgrade(pool: pg.Pool, options: { backupDir?: string; failAfterBaseline?: boolean } = {}): Promise<UpgradePlan> {
  let applied: UpgradePlan | undefined;
  if (options.backupDir) await writeBackup(options.backupDir);
  await transaction(pool, async client => {
    await client.query(`SELECT pg_advisory_xact_lock(${UPGRADE_LOCK_KEY})`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp(), baseline boolean NOT NULL DEFAULT false)`);
    await client.query(`CREATE TABLE IF NOT EXISTS upgrade_snapshots (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, version text NOT NULL, fingerprint jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const existing = await client.query<{ version: string; checksum: string; baseline: boolean }>(`SELECT version,checksum,baseline FROM schema_migrations ORDER BY applied_at DESC LIMIT 1`);
    const latest = existing.rows[0];
    if (latest?.version === IMPORT_VERSION) {
      const current = await fingerprint(client, IMPORT_TABLES, IMPORT_REQUIRED_COLUMNS);
      const currentChecksum = checksum(current);
      if (latest.checksum !== currentChecksum) throw new Error('当前版本校验和不符；拒绝继续升级');
      applied = { version: IMPORT_VERSION, baseline: false, pending: [], checksum: currentChecksum, snapshot: current };
      return;
    }
    if (latest && latest.version !== BASELINE_VERSION) throw new Error(`未知迁移版本: ${latest.version}`);
    let needsMigration = true;
    if (latest?.version === BASELINE_VERSION) {
      const baseline = await fingerprint(client, KNOWN_TABLES, REQUIRED_COLUMNS);
      if (latest.checksum !== checksum(baseline)) throw new Error('baseline校验和不符；拒绝继续升级');
    } else {
      try {
        const baseline = await fingerprint(client, KNOWN_TABLES, REQUIRED_COLUMNS);
        const baselineChecksum = checksum(baseline);
        await client.query(`INSERT INTO schema_migrations(version,checksum,baseline) VALUES($1,$2,true)`,
          [BASELINE_VERSION, baselineChecksum]);
        await client.query(`INSERT INTO upgrade_snapshots(version,fingerprint) VALUES($1,$2)`,
          [BASELINE_VERSION, JSON.stringify(baseline)]);
        if (options.failAfterBaseline) throw new Error('测试故障：baseline后故意失败，事务应回滚');
      } catch (error) {
        if (options.failAfterBaseline) throw error;
        await fingerprint(client, IMPORT_TABLES, IMPORT_REQUIRED_COLUMNS);
        needsMigration = false;
      }
    }
    if (needsMigration) await migrateCompanyProfileImports(client);
    const current = await fingerprint(client, IMPORT_TABLES, IMPORT_REQUIRED_COLUMNS);
    const currentChecksum = checksum(current);
    await client.query(`INSERT INTO schema_migrations(version,checksum,baseline) VALUES($1,$2,false)
      ON CONFLICT(version) DO NOTHING`, [IMPORT_VERSION, currentChecksum]);
    await client.query(`INSERT INTO upgrade_snapshots(version,fingerprint) VALUES($1,$2)`,
      [IMPORT_VERSION, JSON.stringify(current)]);
    applied = { version: IMPORT_VERSION, baseline: false, pending: [], checksum: currentChecksum, snapshot: current };
  });
  return applied as UpgradePlan;
}

export async function verifyUpgrade(pool: pg.Pool): Promise<{ ok: true; checksum: string; unchanged: boolean }> {
  const client = await pool.connect();
  try {
    const migration = await metadata(client);
    if (!migration) throw new Error('尚未建立版本记录');
    if (migration.version !== CURRENT_VERSION) throw new Error(`当前版本未完成: ${migration.version}`);
    const current = await fingerprint(client, CURRENT_TABLES, CURRENT_REQUIRED_COLUMNS);
    const currentChecksum = checksum(current);
    if (currentChecksum !== migration.checksum) throw new Error('当前结构校验和与baseline不符');
    const expected = await snapshot(client);
    if (!expected) throw new Error('缺少升级快照，拒绝核验');
    const unchanged = expected.schema === current.schema && Object.keys(expected.data).every(table =>
      expected.data[table].count === current.data[table]?.count && expected.data[table].digest === current.data[table]?.digest);
    return { ok: true, checksum: currentChecksum, unchanged };
  } finally { client.release(); }
}

async function writeBackup(backupDir: string): Promise<void> {
  await mkdir(backupDir, { recursive: true });
  const file = join(backupDir, `upgrade-${BASELINE_VERSION}.dump`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('必须设置 DATABASE_URL');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', ['--dbname', url, '--format=custom', '--file', file], { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`pg_dump失败(${code ?? 'unknown'})`)));
  });
  const info = await stat(file);
  if (!info.size) throw new Error('备份文件为空');
  await stat(dirname(file));
}

export async function planUpgrade(pool: pg.Pool): Promise<UpgradePlan> {
  const client = await pool.connect();
  try {
    const latest = await metadata(client);
    if (latest?.version === CURRENT_VERSION || (!latest && (await tableNames(client)).includes('company_source_selections'))) {
      const current = await fingerprint(client, CURRENT_TABLES, CURRENT_REQUIRED_COLUMNS);
      if (latest && latest.checksum !== checksum(current)) throw new Error('当前版本校验和不符');
      return { version: CURRENT_VERSION, baseline: false, pending: latest ? [] : [CURRENT_VERSION], checksum: checksum(current), snapshot: current };
    }
  } finally { client.release(); }
  const old = await planImportsUpgrade(pool);
  return { ...old, version: CURRENT_VERSION, pending: [...old.pending, CURRENT_VERSION] };
}
export async function applyUpgrade(pool: pg.Pool, options: { backupDir?: string; failAfterBaseline?: boolean } = {}): Promise<UpgradePlan> {
  const plan = await planUpgrade(pool);
  if (!plan.pending.length) return plan;
  const probe = await pool.connect();
  let latestVersion: string | undefined;
  try { latestVersion = (await metadata(probe))?.version; } finally { probe.release(); }
  if (plan.pending.some(version => version !== CURRENT_VERSION) || latestVersion === IMPORT_VERSION) await applyImportsUpgrade(pool, options);
  else if (options.backupDir) await writeBackup(options.backupDir);
  return transaction(pool, async client => {
    await client.query(`SELECT pg_advisory_xact_lock(${UPGRADE_LOCK_KEY})`);
    const latest = await metadata(client);
    if (latest?.version === CURRENT_VERSION) {
      const current = await fingerprint(client, CURRENT_TABLES, CURRENT_REQUIRED_COLUMNS);
      if (latest.checksum !== checksum(current)) throw new Error('当前版本校验和不符');
      return { version: CURRENT_VERSION, baseline: false, pending: [], checksum: checksum(current), snapshot: current };
    }
    if (latest && latest.version !== IMPORT_VERSION) throw new Error('来源升级前置版本无效');
    if (latest) {
      const old = await fingerprint(client, IMPORT_TABLES, IMPORT_REQUIRED_COLUMNS);
      if (latest.checksum !== checksum(old)) throw new Error('来源升级前旧版本校验和不符');
      await client.query('INSERT INTO upgrade_snapshots(version,fingerprint) VALUES($1,$2)', [IMPORT_VERSION, JSON.stringify(old)]);
      await migrateCompanySources(client);
    }
    const current = await fingerprint(client, CURRENT_TABLES, CURRENT_REQUIRED_COLUMNS);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp(), baseline boolean NOT NULL DEFAULT false)`);
    await client.query(`CREATE TABLE IF NOT EXISTS upgrade_snapshots (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, version text NOT NULL, fingerprint jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [CURRENT_VERSION, checksum(current)]);
    await client.query('INSERT INTO upgrade_snapshots(version,fingerprint) VALUES($1,$2)', [CURRENT_VERSION, JSON.stringify(current)]);
    return { version: CURRENT_VERSION, baseline: false, pending: [], checksum: checksum(current), snapshot: current };
  });
}
