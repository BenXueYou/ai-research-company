import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import type { ImporterNameClient, ImporterNameInput, ImporterNamePage } from '../server/companies/product-search.js';
import type { TengdaoCompanyClient } from '../server/upstream/tengdao.js';
import type { CompanyDetailClient, DetailResult } from '../server/companies/company-detail.js';
import { testDatabase } from './helpers.js';

test('T12 paid importer name pages and free identity check preserve the selected parameter sources', async () => {
  const { pool } = await testDatabase();
  const port = Number(process.env.PRODUCT_SEARCH_TEST_PORT ?? 3122);
  const origin = `http://127.0.0.1:${port}`;
  const importerCalls: ImporterNameInput[] = [];
  const companyCalls: Array<{ name: string; countryCodes: string }> = [];
  let companyCountry = 'TUR';
  const detailCalls: Array<{ name: string; countryCode3: string }> = [];
  let pageOutcome: ImporterNamePage | Error = {
    content: [{ name: 'Buyer Name from Trade' }],
    page: 1, size: 20, total: 21, actualUpstreamPoints: '0.4321', traceId: 'trade-trace-1'
  };
  let detailOutcome: DetailResult | Error = new Error('detail lookup failed');
  const importer: ImporterNameClient = {
    buyerCountryFilterVerified: true,
    importerNames: async input => {
      importerCalls.push(input);
      if (pageOutcome instanceof Error) throw pageOutcome;
      return pageOutcome;
    }
  };
  const companies: TengdaoCompanyClient = {
    listCompanies: async input => {
      companyCalls.push({ name: input.name, countryCodes: input.countryCodes });
      return {
        content: [{ id: 'list-source-id-42', name: 'Confirmed Buyer Legal Name', country: companyCountry }],
        page: input.pageNo, size: input.pageSize, total: 1, traceId: 'free-list-trace'
      };
    }
  };
  const details: CompanyDetailClient = {
    detail: async input => {
      detailCalls.push(input);
      if (detailOutcome instanceof Error) throw detailOutcome;
      return detailOutcome;
    }
  };
  const app = await createApplication(pool, origin, false, undefined, companies, undefined, details, undefined, undefined, importer);
  await app.listen(port, '127.0.0.1');
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
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
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
  const selection = {
    productDesc: 'ceramic pump', buyerCountryCode3: 'TUR', startDate: '2026-01-01',
    endDate: '2026-06-30', pageNo: 1, pageSize: 20
  };
  try {
    const alpha = await fixture('product-alpha');
    const beta = await fixture('product-beta');
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,3.0000),($2,3.0000)',
      [alpha.organization, beta.organization]);
    assert.equal((await post(alpha, 'product-searches/quote', selection)).status, 409);
    assert.equal(importerCalls.length, 0);
    assert.equal((await post(alpha, 'product-searches/quote', { ...selection, countryOfDestinationCode: 'USA' })).status, 400);
    assert.equal((await post(alpha, 'product-searches/quote', { ...selection, buyerCountryCode3: '' })).status, 400);
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/trade/importers-name',0.5000,2,'controlled fixture','controlled_test',$1,$2),
        ('/v2/company',0.5000,2,'controlled fixture','controlled_test',$3,$2)`, [randomUUID(), alpha.actor, randomUUID()]);
    const quoted = await (await post(alpha, 'product-searches/quote', selection)).json() as { pageId: string; maximumPoints: string; state: string };
    assert.equal(quoted.state, 'quoted');
    assert.equal(quoted.maximumPoints, '1.0000');
    assert.equal((await post(beta, 'product-searches/execute', { pageId: quoted.pageId })).status, 404);
    await pool.query('UPDATE internal_point_accounts SET balance=0.5000 WHERE organization_id=$1', [alpha.organization]);
    assert.equal((await post(alpha, 'product-searches/execute', { pageId: quoted.pageId })).status, 409);
    assert.equal(importerCalls.length, 0);
    await pool.query('UPDATE internal_point_accounts SET balance=3.0000 WHERE organization_id=$1', [alpha.organization]);
    const [first, repeat] = await Promise.all([
      post(alpha, 'product-searches/execute', { pageId: quoted.pageId }),
      post(alpha, 'product-searches/execute', { pageId: quoted.pageId })
    ]);
    assert.equal(first.status, 200);
    assert.equal(repeat.status, 200);
    const settled = await first.json() as { state: string; chargedPoints: string; content: Array<{ candidateId: string; name: string }> };
    assert.equal(settled.state, 'settled');
    assert.equal(settled.chargedPoints, '0.4321');
    assert.equal(settled.content[0].name, 'Buyer Name from Trade');
    assert.deepEqual(importerCalls, [{ catalog: 'imports', ...selection }]);
    assert.equal((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',
      [alpha.organization])).rows[0].balance, '2.5679');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_search_ledger WHERE page_id=$1',
      [quoted.pageId])).rows[0].n, 3);
    const local = await (await post(alpha, 'product-searches/quote', selection)).json() as { state: string };
    assert.equal(local.state, 'settled');
    assert.equal(importerCalls.length, 1);
    const checked = await post(alpha, 'product-candidates/check', { candidateId: settled.content[0].candidateId });
    assert.equal(checked.status, 200);
    const list = await checked.json() as { content: Array<{ candidateId: string; sourceId: string; name: string; country: string }> };
    assert.deepEqual(companyCalls, [{ name: 'Buyer Name from Trade', countryCodes: 'TUR' }]);
    assert.equal(list.content[0].sourceId, 'list-source-id-42');
    assert.equal((await post(alpha, 'company-details/quote', { candidateId: list.content[0].candidateId })).status, 404);
    assert.equal((await post(alpha, 'company-candidates/verify', { candidateId: list.content[0].candidateId })).status, 200);
    const detailQuote = await (await post(alpha, 'company-details/quote', { candidateId: list.content[0].candidateId })).json() as { queryId: string; name: string; countryCode3: string };
    assert.deepEqual([detailQuote.name, detailQuote.countryCode3], ['Confirmed Buyer Legal Name', 'TUR']);
    const failedDetail = await (await post(alpha, 'company-details/execute', { queryId: detailQuote.queryId })).json() as { state: string };
    assert.equal(failedDetail.state, 'pending');
    assert.deepEqual(detailCalls, [{ name: 'Confirmed Buyer Legal Name', countryCode3: 'TUR' }]);
    assert.equal((await pool.query('SELECT charged_points FROM product_search_pages WHERE id=$1', [quoted.pageId])).rows[0].charged_points, '0.4321');
    assert.equal((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1', [alpha.organization])).rows[0].balance, '2.5679');
    pageOutcome = { content: [{ name: 'Second Page Buyer' }], page: 2, size: 20, total: 21, actualUpstreamPoints: '0.2000' };
    const nextQuote = await (await post(alpha, 'product-searches/quote', { ...selection, pageNo: 2 })).json() as { pageId: string; state: string };
    assert.equal(nextQuote.state, 'quoted');
    assert.equal(importerCalls.length, 1);
    const next = await (await post(alpha, 'product-searches/execute', { pageId: nextQuote.pageId })).json() as { state: string; chargedPoints: string };
    assert.equal(next.state, 'settled');
    assert.equal(next.chargedPoints, '0.2000');
    assert.equal(importerCalls[1].pageNo, 2);
    pageOutcome = { content: [], page: 3, size: 20, total: 0, actualUpstreamPoints: '0.2000' };
    const zeroQuote = await (await post(alpha, 'product-searches/quote', { ...selection, pageNo: 3 })).json() as { pageId: string };
    const zero = await (await post(alpha, 'product-searches/execute', { pageId: zeroQuote.pageId })).json() as { state: string; chargedPoints: string };
    assert.deepEqual([zero.state, zero.chargedPoints], ['zero', '0.0000']);
    pageOutcome = new Error('network timeout');
    const pendingQuote = await (await post(alpha, 'product-searches/quote', { ...selection, pageNo: 4 })).json() as { pageId: string };
    const pending = await (await post(alpha, 'product-searches/execute', { pageId: pendingQuote.pageId })).json() as { state: string };
    assert.equal(pending.state, 'pending');
    await post(alpha, 'product-searches/execute', { pageId: pendingQuote.pageId });
    assert.equal(importerCalls.length, 4);
    assert.equal((await post(beta, 'product-candidates/check', { candidateId: settled.content[0].candidateId })).status, 404);
    companyCountry = 'USA';
    const mismatched = await (await post(alpha, 'product-candidates/check', { candidateId: settled.content[0].candidateId })).json() as { content: Array<{ candidateId: string }> };
    assert.equal((await post(alpha, 'company-candidates/verify', { candidateId: mismatched.content[0].candidateId })).status, 409);
  } finally {
    await app.close();
    await pool.end();
  }
});
