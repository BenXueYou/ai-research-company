import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import type { CompanyContactClient, ContactPageResult } from '../server/companies/company-contacts.js';
import { testDatabase } from './helpers.js';
import { HttpTengdaoCompanyClient, type TengdaoSharedState } from '../server/upstream/tengdao.js';

test('T14 supplier DTO uses companyName, comma positionTag and data.list', async () => {
  const urls: URL[] = [];
  const state: TengdaoSharedState = {
    token: async () => 'fixture-token', cacheToken: async () => undefined,
    tryTokenLock: async () => true, releaseTokenLock: async () => undefined,
    reserve: async () => undefined
  };
  const client = new HttpTengdaoCompanyClient(state, {
    baseUrl: 'https://vendor.example', apiKey: 'fixture-key', businessDailyLimit: 1,
    fetch: async input => {
      urls.push(new URL(String(input)));
      return { json: async () => ({ success: true, data: { list: [{ mailsouId: 'source-1',
        companyName: 'Returned Name' }], pageNo: 2, pageSize: 20, total: 200 } }) } as Response;
    }
  });
  const page = await client.contacts({ companyName: 'Verified Name', positionTags: ['TECHNOLGY', 'PURCHASING'],
    pageNo: 2, pageSize: 20 });
  assert.equal(urls[0].pathname, '/v2/contact');
  assert.deepEqual([...urls[0].searchParams], [
    ['companyName', 'Verified Name'], ['positionTag', 'TECHNOLGY,PURCHASING'],
    ['pageNo', '2'], ['pageSize', '20']
  ]);
  assert.equal(page.data?.list[0].mailsouId, 'source-1');
  assert.equal(page.actualUpstreamPoints, undefined);
});

test('T14 confirmed profile page, source identifiers, settlement and isolation', async () => {
  const { pool } = await testDatabase();
  const origin = 'http://127.0.0.1:3098';
  const calls: Parameters<CompanyContactClient['contacts']>[0][] = [];
  let outcome: ContactPageResult | Error = {
    data: { list: [
      { mailsouId: 'mail-source-707', id: 'irrelevant-id-3', fileId: 'irrelevant-file-4',
        companyName: 'Other Returned Company', email: '', personalEmail: '',
        positionTag: 'TECHNOLGY', credibility: 'POSSIBLE_MATCH' },
      { mailsouId: 'mail-source-708', id: null, fileId: 'irrelevant-file-5',
        companyName: 'Verified Profile Name', email: 'company@example.net', personalEmail: 'person@example.org',
        positionTag: 'PURCHASING', credibility: 'PERFECT_MATCH' }
    ], pageNo: 1, pageSize: 20, total: 200 }, actualUpstreamPoints: '0.4000'
  };
  const vendor: CompanyContactClient = { contacts: async input => {
    calls.push(input);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  } };
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, undefined, vendor);
  await app.listen(3098, '127.0.0.1');
  async function fixture(label: string) {
    const parent = randomUUID();
    const organization = randomUUID();
    const actor = randomUUID();
    const email = `${label}@example.com`;
    const password = `safe-${label}-password-2026`;
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'platform')", [parent, label]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'terminal',$3,$4,$5,'***')`, [organization, label, parent, `encrypted-${label}`, `phone-${label}`]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,'admin',false)`, [actor, organization, email, await hashPassword(password)]);
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie().map(item => item.split(';')[0]);
    return { organization, actor, cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  type Session = Awaited<ReturnType<typeof fixture>>;
  async function post(session: Session, path: string, body: object) {
    return fetch(`${origin}/api/${path}`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf
    }, body: JSON.stringify(body) });
  }
  try {
    const alpha = await fixture('contact-alpha');
    const beta = await fixture('contact-beta');
    const candidateId = randomUUID();
    const searchId = randomUUID();
    const detailQueryId = randomUUID();
    const profileId = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'unrelated search','TUR',1,20,1,'verified')`, [searchId, alpha.organization, alpha.actor]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'list-id-404','Verified Profile Name','TUR','verified')`, [candidateId, searchId, alpha.organization]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,
      coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Verified Profile Name','TUR',1,1,$5,'settled')`,
    [detailQueryId, alpha.organization, alpha.actor, candidateId, randomUUID()]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'detail-data-id-909','Verified Profile Name','TUR','{}',$3)`, [profileId, alpha.organization, detailQueryId]);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,2.0000),($2,2.0000)',
      [alpha.organization, beta.organization]);
    const body = { profileId, positionTags: ['TECHNOLGY', 'PURCHASING'], pageNo: 1, pageSize: 20 };
    assert.equal((await post(beta, 'company-contacts/quote', body)).status, 404);
    assert.equal((await post(alpha, 'company-contacts/quote', body)).status, 409);
    assert.equal(calls.length, 0);
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/contact',0.2500,2,'controlled fixture','controlled_test',$1,$2)`, [randomUUID(), alpha.actor]);
    const quote = await (await post(alpha, 'company-contacts/quote', body)).json() as { queryId: string; companyName: string; maximumPoints: string };
    assert.equal(quote.companyName, 'Verified Profile Name');
    assert.equal(quote.maximumPoints, '0.5000');
    assert.equal((await post(beta, 'company-contacts/execute', { queryId: quote.queryId })).status, 404);
    assert.equal(calls.length, 0);
    await pool.query('UPDATE internal_point_accounts SET balance=0.1000 WHERE organization_id=$1', [alpha.organization]);
    assert.equal((await post(alpha, 'company-contacts/execute', { queryId: quote.queryId })).status, 409);
    assert.equal(calls.length, 0);
    await pool.query('UPDATE internal_point_accounts SET balance=2.0000 WHERE organization_id=$1', [alpha.organization]);
    const responses = await Promise.all([post(alpha, 'company-contacts/execute', { queryId: quote.queryId }),
      post(alpha, 'company-contacts/execute', { queryId: quote.queryId })]);
    assert.deepEqual(responses.map(item => item.status), [200, 200]);
    assert.deepEqual(calls, [{ companyName: 'Verified Profile Name', positionTags: ['TECHNOLGY', 'PURCHASING'], pageNo: 1, pageSize: 20 }]);
    const page = await responses[0].json() as { state: string; chargedPoints: string; total: number; contacts: Array<{ mailsouId: string; returnedCompanyName: string; ownershipStatus: string; credibility: string }> };
    assert.deepEqual([page.state, page.chargedPoints, page.total], ['settled', '0.4000', 200]);
    assert.deepEqual(page.contacts.map(item => [item.mailsouId, item.returnedCompanyName, item.ownershipStatus, item.credibility]).sort(), [
      ['mail-source-707', 'Other Returned Company', 'pending', 'POSSIBLE_MATCH'],
      ['mail-source-708', 'Verified Profile Name', 'matched', 'PERFECT_MATCH']
    ]);
    assert.deepEqual((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',
      [alpha.organization])).rows[0], { balance: '1.6000', query_frozen: '0.0000' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contact_point_ledger WHERE query_id=$1', [quote.queryId])).rows[0].n, 3);
    const local = await (await post(alpha, 'company-contacts/quote', body)).json() as { chargedPoints: string };
    assert.equal(local.chargedPoints, '0.0000');
    assert.equal(calls.length, 1);
    assert.equal((await post(beta, 'company-contacts/profile', { profileId })).status, 404);
    assert.equal((await post(alpha, 'company-contacts/quote', { ...body, pageNo: 2 })).status, 200);
    const next = await (await post(alpha, 'company-contacts/quote', { ...body, pageNo: 2 })).json() as { queryId: string };
    outcome = new Error('timeout');
    const pending = await (await post(alpha, 'company-contacts/execute', { queryId: next.queryId })).json() as { state: string };
    assert.equal(pending.state, 'pending');
    assert.equal((await post(alpha, 'company-contacts/execute', { queryId: next.queryId })).status, 200);
    assert.equal(calls.length, 2);
    assert.equal((await pool.query('SELECT query_frozen FROM internal_point_accounts WHERE organization_id=$1', [alpha.organization])).rows[0].query_frozen, '0.5000');
    const platformId = randomUUID();
    const platformActor = randomUUID();
    const platformEmail = 'contact-platform@example.com';
    const platformPassword = 'safe-contact-platform-password-2026';
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'contact platform','platform')", [platformId]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,'platform',false)`, [platformActor, platformId, platformEmail, await hashPassword(platformPassword)]);
    const platformLogin = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json'
    }, body: JSON.stringify({ email: platformEmail, password: platformPassword }) });
    const platformCookies = platformLogin.headers.getSetCookie().map(item => item.split(';')[0]);
    const platform = { organization: platformId, actor: platformActor, cookie: platformCookies.join('; '),
      csrf: platformCookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
    assert.equal((await post(alpha, 'company-contacts/final-failure', { queryId: next.queryId, evidence: 'final failure' })).status, 403);
    assert.equal((await post(platform, 'company-contacts/final-failure', {
      queryId: next.queryId, evidence: 'controlled final failure'
    })).status, 200);
    assert.equal((await post(platform, 'company-contacts/final-failure', {
      queryId: next.queryId, evidence: 'controlled final failure'
    })).status, 200);
    assert.equal((await pool.query('SELECT query_frozen FROM internal_point_accounts WHERE organization_id=$1', [alpha.organization])).rows[0].query_frozen, '0.0000');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contact_reconciliations WHERE query_id=$1', [next.queryId])).rows[0].n, 1);
    outcome = { data: { list: [], pageNo: 3, pageSize: 20, total: 0 }, actualUpstreamPoints: '0.2500' };
    const zeroQuote = await (await post(alpha, 'company-contacts/quote', { ...body, pageNo: 3 })).json() as { queryId: string };
    const zero = await (await post(alpha, 'company-contacts/execute', { queryId: zeroQuote.queryId })).json() as { state: string; chargedPoints: string };
    assert.deepEqual([zero.state, zero.chargedPoints], ['zero', '0.0000']);
    assert.equal((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',
      [alpha.organization])).rows[0].balance, '1.6000');
  } finally {
    await app.close();
    await pool.end();
  }
});
