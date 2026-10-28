import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import type { Identity } from '../identity/identity.js';
import { ReportingService } from './reporting.js';

test('business data queries use the authorized organization scope and exclude distributor access', async () => {
  const queries: { sql: string; params: unknown[] | undefined }[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes('SELECT kind FROM organizations')) return { rows: [{ kind: 'platform' }] };
      if (sql.includes('WITH RECURSIVE visible')) return { rows: [{ id: 'platform' }, { id: 'child' }] };
      if (sql.includes('AS "salesGrossProfit"')) return { rows: [{}] };
      return { rows: [] };
    }
  } as unknown as pg.Pool;
  const service = new ReportingService(pool);
  await service.overview({ role: 'platform', organization_id: 'platform' } as Identity);
  const customers = queries.find(query => query.sql.includes('FROM company_profiles'));
  const emails = queries.find(query => query.sql.includes('FROM email_batches b JOIN email_recipients'));
  assert.match(customers?.sql ?? '', /WHERE organization_id=ANY\(\$1::uuid\[\]\)/);
  assert.match(emails?.sql ?? '', /WHERE b\.organization_id=ANY\(\$1::uuid\[\]\)/);
  assert.match(emails?.sql ?? '', /r\.organization_id=b\.organization_id/);
  assert.deepEqual(customers?.params, [['platform', 'child']]);
  assert.deepEqual(emails?.params, [['platform', 'child']]);
  queries.length = 0;
  await assert.rejects(service.overview({ role: 'distributor', organization_id: 'platform' } as Identity));
  assert.equal(queries.some(query => query.sql.includes('FROM company_profiles')), false);
});
