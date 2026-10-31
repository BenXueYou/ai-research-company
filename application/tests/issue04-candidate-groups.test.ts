import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CompanySearchService } from '../server/companies/company-search.js';
import type { Identity } from '../server/identity/identity.js';
import { testDatabase } from './helpers.js';

test('名单企业独立核实，产品线索的身份候选互斥', async () => {
  const { pool } = await testDatabase();
  try {
    const parent = randomUUID(), org = randomUUID(), actor = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'platform','platform')", [parent]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'terminal','terminal',$2,'encrypted',$3,'***')`, [org, parent, randomUUID()]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'identity04@example.test','hash','admin',false)`, [actor, org]);
    const identity: Identity = { id: actor, organization_id: org, email: 'identity04@example.test',
      username: null, role: 'admin', must_change: false, csrf_hash: '' };
    const service = new CompanySearchService(pool, { listCompanies: async () => { throw new Error('unexpected call'); } });
    async function search() {
      const id = randomUUID();
      await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
        VALUES($1,$2,$3,'buyer','USA',1,20,2,'pending_verification')`, [id, org, actor]);
      const ids = [randomUUID(), randomUUID()];
      for (const candidateId of ids) await pool.query(`INSERT INTO company_candidates
        (id,search_id,organization_id,source_id,source_name,source_country) VALUES($1,$2,$3,$4,'Buyer','USA')`,
      [candidateId, id, org, `vendor-${randomUUID()}`]);
      return { id, ids };
    }
    const list = await search();
    await service.verify(identity, { candidateId: list.ids[0] });
    await service.verify(identity, { candidateId: list.ids[1] });
    const group = await search();
    const page = randomUUID(), product = randomUUID();
    await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,
      start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,'product','USA','2026-01-01','2026-01-31',1,20,1,1,$4,'settled')`,
    [page, org, actor, randomUUID()]);
    await pool.query(`INSERT INTO product_search_candidates(id,page_id,organization_id,position,source_name)
      VALUES($1,$2,$3,1,'Buyer')`, [product, page, org]);
    await pool.query('INSERT INTO product_candidate_checks(product_candidate_id,company_search_id) VALUES($1,$2)', [product, group.id]);
    await service.verify(identity, { candidateId: group.ids[0] });
    await service.verify(identity, { candidateId: group.ids[0] });
    await assert.rejects(service.verify(identity, { candidateId: group.ids[1] }), /此线索已选择其他身份候选/);
    const statuses = await pool.query('SELECT id,verification_status FROM company_candidates WHERE search_id=$1', [group.id]);
    assert.deepEqual(Object.fromEntries(statuses.rows.map(row => [row.id, row.verification_status])),
      { [group.ids[0]]: 'verified', [group.ids[1]]: 'not_selected' });
  } finally {
    await pool.end();
  }
});
