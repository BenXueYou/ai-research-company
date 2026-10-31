import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './app.js';
import { hashPassword } from './identity/policy.js';
import { applyUpgrade, CURRENT_VERSION, planUpgrade, verifyUpgrade } from './migrations/upgrade.js';
import type { CompanyListRequestDto, TengdaoCompanyClient } from './upstream/tengdao.js';
import { testDatabase } from '../tests/helpers.js';

type Session = { cookie: string; csrf: string };

test('票02 升级：从票01 baseline 增量升级并保留既有详情档案', async () => {
  const { pool } = await testDatabase();
  try {
    await pool.query(`
      DROP TABLE IF EXISTS company_profile_import_requests;
      DROP TABLE IF EXISTS company_profile_sources;
      DROP TABLE IF EXISTS schema_migrations;
      DROP TABLE IF EXISTS upgrade_snapshots;
      ALTER TABLE company_profiles DROP COLUMN IF EXISTS identity_state;
      ALTER TABLE company_profiles DROP COLUMN IF EXISTS detail_state;
      ALTER TABLE company_profiles ALTER COLUMN detail_id SET NOT NULL;
      ALTER TABLE company_profiles ALTER COLUMN country_code3 SET NOT NULL;
      ALTER TABLE company_profiles ALTER COLUMN detail SET NOT NULL;
      ALTER TABLE company_profiles ALTER COLUMN query_id SET NOT NULL;
    `);
    const parentId = randomUUID();
    const organizationId = randomUUID();
    const accountId = randomUUID();
    const searchId = randomUUID();
    const candidateId = randomUUID();
    const queryId = randomUUID();
    const profileId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'baseline-parent','platform')", [parentId]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'baseline-terminal','terminal',$2,'encrypted','baseline-phone','***')`, [organizationId, parentId]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'baseline@example.com',$3,'admin',false)`, [accountId, organizationId, await hashPassword('Ticket02-baseline-password')]);
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'Baseline Query','DEU',1,20,1,'verified')`, [searchId, organizationId, accountId]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'baseline-list-id','Baseline Company','DEU','verified')`, [candidateId, searchId, organizationId]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,
      coefficient,maximum_points,price_version,state,detail_id,result)
      VALUES($1,$2,$3,$4,'Baseline Company','DEU',1,1,$5,'settled','baseline-detail-id',$6)`,
    [queryId, organizationId, accountId, candidateId, randomUUID(), { id: 'baseline-detail-id', countryCode3: 'DEU' }]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'baseline-detail-id','Baseline Company','DEU',$3,$4)`,
    [profileId, organizationId, { id: 'baseline-detail-id', countryCode3: 'DEU', preserved: true }, queryId]);

    const plan = await planUpgrade(pool);
    assert.deepEqual(plan.pending, ['2026-10-31.current', CURRENT_VERSION]);
    const applied = await applyUpgrade(pool);
    assert.equal(applied.version, CURRENT_VERSION);
    assert.deepEqual(applied.pending, []);
    assert.deepEqual(await applyUpgrade(pool), applied);
    assert.deepEqual(await verifyUpgrade(pool), {
      ok: true,
      checksum: applied.checksum,
      unchanged: true
    });
    assert.deepEqual((await pool.query(`SELECT detail_id,name,country_code3,detail,query_id,identity_state,detail_state
      FROM company_profiles WHERE id=$1`, [profileId])).rows[0], {
      detail_id: 'baseline-detail-id',
      name: 'Baseline Company',
      country_code3: 'DEU',
      detail: { id: 'baseline-detail-id', countryCode3: 'DEU', preserved: true },
      query_id: queryId,
      identity_state: 'verified',
      detail_state: 'ready'
    });
  } finally {
    await pool.end();
  }
});

test('票02 HTTP：显式保存已取得名单为待核实初始档案，保持幂等、租户和零账务边界', async () => {
  const { pool } = await testDatabase();
  const vendorCalls: CompanyListRequestDto[] = [];
  const vendor: TengdaoCompanyClient = {
    listCompanies: async input => {
      vendorCalls.push(input);
      return {
        content: [
          { id: 'list-source-id-A', name: 'Alpha Source Name', country: 'USA' },
          { id: 'list-source-id-B', name: 'Beta Source Name', country: 'TUR' }
        ],
        page: input.pageNo,
        size: input.pageSize,
        total: 2,
        traceId: 'trace-company-list-page'
      };
    }
  };
  const origin = 'http://127.0.0.1:3192';
  const app = await createApplication(pool, origin, false, undefined, vendor);
  await app.listen(3192, '127.0.0.1');

  async function fixture(label: string) {
    const parentId = randomUUID();
    const organizationId = randomUUID();
    const accountId = randomUUID();
    const email = `${label}@example.com`;
    const password = `Ticket02-${label}-password`;
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'platform')", [parentId, `parent-${label}`]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'terminal',$3,$4,$5,'***')`,
    [organizationId, `tenant-${label}`, parentId, `encrypted-${label}`, `phone-${label}`]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
      VALUES($1,$2,$3,$4,'admin',false,NULL)`, [accountId, organizationId, email, await hashPassword(password)]);
    return { organizationId, accountId, email, password };
  }

  async function login(email: string, password: string): Promise<Session> {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return {
      cookie: cookies.join('; '),
      csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14)
    };
  }

  async function post(session: Session, path: string, body: object) {
    return fetch(`${origin}/api/${path}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf
      },
      body: JSON.stringify(body)
    });
  }

  try {
    const alpha = await fixture('ticket02-alpha');
    const beta = await fixture('ticket02-beta');
    const alphaSession = await login(alpha.email, alpha.password);
    const betaSession = await login(beta.email, beta.password);
    const searchResponse = await post(alphaSession, 'company-searches', {
      name: 'Original Company Query',
      countryCodes: 'USA,TUR',
      pageNo: 1,
      pageSize: 20
    });
    assert.equal(searchResponse.status, 200);
    const search = await searchResponse.json() as {
      content: Array<{ candidateId: string; sourceId: string }>;
    };
    const selectedCandidateId = search.content[1]!.candidateId;
    assert.notEqual(selectedCandidateId, search.content[1]!.sourceId);
    const requestId = randomUUID();
    const payload = {
      requestId,
      items: [{
        sourceKind: 'company_candidate',
        sourceRecordId: selectedCandidateId,
        decision: 'create'
      }]
    };
    const vendorCallsBeforeImport = vendorCalls.length;
    const ledgerBefore = Number((await pool.query('SELECT count(*) FROM query_point_ledger')).rows[0].count);
    const accountBefore = await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [alpha.organizationId]);
    const firstResponse = await post(alphaSession, 'company-profile-imports', payload);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as {
      requestId: string;
      items: Array<{ sourceRecordId: string; status: string; profileId: string; reasonCode?: string }>;
    };
    assert.equal(first.requestId, requestId);
    assert.equal(first.items[0]!.sourceRecordId, selectedCandidateId);
    assert.equal(first.items[0]!.status, 'created');
    const profileId = first.items[0]!.profileId;

    const repeatedResponse = await post(alphaSession, 'company-profile-imports', payload);
    assert.equal(repeatedResponse.status, 200);
    assert.deepEqual(await repeatedResponse.json(), first);
    const sameSourceResponse = await post(alphaSession, 'company-profile-imports', { ...payload, requestId: randomUUID() });
    assert.equal(sameSourceResponse.status, 200);
    const sameSource = await sameSourceResponse.json() as typeof first;
    assert.equal(sameSource.items[0]!.status, 'linked');
    assert.equal(sameSource.items[0]!.profileId, profileId);
    assert.equal((await post(alphaSession, 'company-profile-imports', {
      requestId,
      items: [{
        sourceKind: 'company_candidate',
        sourceRecordId: search.content[0]!.candidateId,
        decision: 'create'
      }]
    })).status, 409);

    const listResponse = await post(alphaSession, 'company-profiles/list', { deleted: false });
    assert.equal(listResponse.status, 200);
    const profiles = await listResponse.json() as Array<{
      id: string;
      name: string;
      countryCode3: string | null;
      detail: Record<string, unknown> | null;
      identityState: string;
      detailState: string;
      sources: Array<{
        sourceKind: string;
        sourceRecordId: string;
        sourcePayload: { sourceId: string };
        searchConditions: Record<string, unknown>;
        pageNo: number;
        createdAt: string;
      }>;
    }>;
    assert.equal(profiles.length, 1);
    assert.deepEqual(profiles[0], {
      ...profiles[0],
      id: profileId,
      name: 'Beta Source Name',
      countryCode3: 'TUR',
      detail: null,
      identityState: 'pending',
      detailState: 'absent'
    });
    assert.equal(typeof profiles[0]!.sources[0]!.createdAt, 'string');
    assert.deepEqual({ ...profiles[0]!.sources[0], createdAt: undefined }, {
      sourceKind: 'company_candidate',
      sourceRecordId: selectedCandidateId,
      sourcePayload: { sourceId: 'list-source-id-B', name: 'Beta Source Name', country: 'TUR' },
      searchConditions: { name: 'Original Company Query', countryCodes: 'USA,TUR', pageSize: 20 },
      pageNo: 1,
      createdAt: undefined
    });
    assert.equal(vendorCalls.length, vendorCallsBeforeImport);
    assert.equal(Number((await pool.query('SELECT count(*) FROM query_point_ledger')).rows[0].count), ledgerBefore);
    const accountAfter = await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [alpha.organizationId]);
    assert.deepEqual(accountAfter.rows, accountBefore.rows);

    const crossTenantResponse = await post(betaSession, 'company-profile-imports', {
      requestId: randomUUID(),
      items: [{ sourceKind: 'company_candidate', sourceRecordId: selectedCandidateId, decision: 'create' }]
    });
    assert.equal(crossTenantResponse.status, 200);
    const crossTenant = await crossTenantResponse.json() as typeof first;
    assert.equal(crossTenant.items[0]!.status, 'rejected');
    assert.equal(crossTenant.items[0]!.reasonCode, 'SOURCE_NOT_FOUND');

    const concurrentSourceId = search.content[0]!.candidateId;
    const concurrentPayloads = [randomUUID(), randomUUID()].map(concurrentRequestId => ({
      requestId: concurrentRequestId,
      items: [{ sourceKind: 'company_candidate', sourceRecordId: concurrentSourceId, decision: 'create' }]
    }));
    const concurrentResponses = await Promise.all(concurrentPayloads.map(concurrentPayload =>
      post(alphaSession, 'company-profile-imports', concurrentPayload)
    ));
    assert.ok(concurrentResponses.every(response => response.status === 200));
    const concurrentResults = await Promise.all(concurrentResponses.map(response =>
      response.json() as Promise<typeof first>
    ));
    assert.deepEqual(concurrentResults.map(result => result.items[0]!.status).sort(), ['created', 'linked']);
    assert.equal(new Set(concurrentResults.map(result => result.items[0]!.profileId)).size, 1);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM company_profile_sources
      WHERE organization_id=$1 AND source_kind='company_candidate' AND source_record_id=$2`,
    [alpha.organizationId, concurrentSourceId])).rows[0].count), 1);

    const productPageId = randomUUID();
    const productCandidateId = randomUUID();
    await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,
      start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state,total)
      VALUES($1,$2,$3,'industrial pump','USA','2026-01-01','2026-06-30',2,20,1,5,$4,'settled',21)`,
    [productPageId, alpha.organizationId, alpha.accountId, randomUUID()]);
    await pool.query(`INSERT INTO product_search_candidates(id,page_id,organization_id,position,source_name)
      VALUES($1,$2,$3,0,'Product Result Name')`, [productCandidateId, productPageId, alpha.organizationId]);
    const productResponse = await post(alphaSession, 'company-profile-imports', {
      requestId: randomUUID(),
      items: [{ sourceKind: 'product_candidate', sourceRecordId: productCandidateId, decision: 'create' }]
    });
    assert.equal(productResponse.status, 200);
    const productImport = await productResponse.json() as typeof first;
    const productProfileId = productImport.items[0]!.profileId;
    assert.deepEqual((await pool.query(`SELECT name,country_code3,identity_state,detail_state
      FROM company_profiles WHERE id=$1`, [productProfileId])).rows[0], {
      name: 'Product Result Name',
      country_code3: null,
      identity_state: 'pending',
      detail_state: 'absent'
    });
    const productSource = (await pool.query(`SELECT search_conditions,page_no FROM company_profile_sources
      WHERE profile_id=$1`, [productProfileId])).rows[0];
    assert.deepEqual(productSource.search_conditions, {
      productDesc: 'industrial pump',
      buyerCountryCode3: 'USA',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      pageSize: 20
    });
    assert.equal(productSource.page_no, 2);

    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [alpha.organizationId]);
    assert.equal((await post(alphaSession, 'company-profile-imports', {
      requestId: randomUUID(),
      items: [{ sourceKind: 'company_candidate', sourceRecordId: search.content[0]!.candidateId, decision: 'create' }]
    })).status, 401);

    await pool.query('UPDATE organizations SET active=true WHERE id=$1', [alpha.organizationId]);
    await pool.query('UPDATE accounts SET active=false WHERE id=$1', [alpha.accountId]);
    assert.equal((await post(alphaSession, 'company-profile-imports', {
      requestId: randomUUID(),
      items: [{ sourceKind: 'company_candidate', sourceRecordId: search.content[0]!.candidateId, decision: 'create' }]
    })).status, 401);
  } finally {
    await app.close();
    await pool.end();
  }
});
