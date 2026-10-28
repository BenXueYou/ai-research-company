import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import type { CompanyDetailClient, DetailResult } from '../server/companies/company-detail.js';
import { testDatabase } from './helpers.js';

test('T13 pending reconciliation, refund, late result and one expense per loss', async () => {
  const { pool } = await testDatabase();
  const port = Number(process.env.DETAIL_RECONCILIATION_TEST_PORT ?? 3103);
  const origin = `http://127.0.0.1:${port}`;
  let response: DetailResult | Error = new Error('timeout');
  let deferred: Promise<DetailResult> | null = null;
  const calls: Array<{ name: string; countryCode3: string }> = [];
  const adapter: CompanyDetailClient = { detail: async input => {
    calls.push(input);
    if (deferred) return deferred;
    if (response instanceof Error) throw response;
    return response;
  } };
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, adapter);
  await app.listen(port, '127.0.0.1');
  async function account(label: string, role: 'platform' | 'admin', parent?: string) {
    const org = randomUUID();
    const actor = randomUUID();
    const password = `safe-${label}-password-2026`;
    if (role === 'platform') await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'platform')", [org, label]);
    else await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'terminal',$3,'encrypted',$4,'***')`, [org, label, parent, `phone-${label}`]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [actor, org, `${label}@example.com`, await hashPassword(password), role]);
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json'
    }, body: JSON.stringify({ email: `${label}@example.com`, password }) });
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie().map(item => item.split(';')[0]);
    return { org, actor, cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  type Session = Awaited<ReturnType<typeof account>>;
  async function post(session: Session, path: string, body: object) {
    return fetch(`${origin}/api/${path}`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf
    }, body: JSON.stringify(body) });
  }
  async function quote(session: Session, name: string, execute = true) {
    const search = randomUUID();
    const candidate = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,$4,'TUR',1,20,1,'verified')`, [search, session.org, session.actor, name]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,$4,$5,'TUR','verified')`, [candidate, search, session.org, `list-${name}`, name]);
    const result = await post(session, 'company-details/quote', { candidateId: candidate });
    assert.equal(result.status, 200);
    const item = await result.json() as { queryId: string };
    if (execute) assert.equal((await post(session, 'company-details/execute', { queryId: item.queryId })).status, 200);
    return item.queryId;
  }
  try {
    const platform = await account('t13-platform', 'platform');
    const terminal = await account('t13-terminal', 'admin', platform.org);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,5.0000)', [terminal.org]);
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/company',0.5000,2,'fixture','controlled_test',$1,$2)`, [randomUUID(), platform.actor]);
    const settledId = await quote(terminal, 'Selected T13 Company');
    assert.deepEqual(calls[0], { name: 'Selected T13 Company', countryCode3: 'TUR' });
    assert.equal((await post(terminal, 'company-details/reconciliations', { queryId: settledId })).status, 403);
    const result = { id: 'detail-distinct-901', countryCode3: 'TUR', name: 'Selected T13 Company' };
    const settlement = {
      queryId: settledId, outcome: 'settled', billingReference: 'bill-t13-1', traceId: 'trace-t13-1',
      upstreamPoints: '1.2500', result, evidence: 'Supplier bill row 1 and viewable detail'
    };
    assert.equal((await post(platform, 'company-details/reconciliations', { ...settlement, result: { ...result, countryCode3: 'USA' } })).status, 400);
    assert.equal((await post(platform, 'company-details/reconciliations', settlement)).status, 200);
    assert.equal((await post(platform, 'company-details/reconciliations', settlement)).status, 200);
    assert.equal((await post(platform, 'company-details/reconciliations', { ...settlement, upstreamPoints: '1.5000' })).status, 409);
    const settled = (await pool.query('SELECT state,charged_points FROM company_detail_queries WHERE id=$1', [settledId])).rows[0];
    assert.deepEqual(settled, { state: 'settled', charged_points: '1.0000' });
    const loss = (await pool.query('SELECT purpose,upstream_points FROM company_detail_losses WHERE query_id=$1', [settledId])).rows[0];
    assert.deepEqual(loss, { purpose: 'excess', upstream_points: '0.2500' });
    const profile = (await pool.query('SELECT detail_id FROM company_profiles WHERE query_id=$1', [settledId])).rows[0];
    assert.equal(profile.detail_id, 'detail-distinct-901');
    const failedId = await quote(terminal, 'Failed T13 Company');
    const failure = {
      queryId: failedId, outcome: 'failed', billingReference: 'bill-t13-2', traceId: 'trace-t13-2',
      upstreamPoints: '0.4000', evidence: 'Supplier bill row 2, no viewable result'
    };
    assert.equal((await post(platform, 'company-details/reconciliations', failure)).status, 200);
    assert.equal((await post(platform, 'company-details/reconciliations', failure)).status, 200);
    const late = {
      queryId: failedId, billingReference: 'bill-t13-2', traceId: 'trace-t13-late',
      result: { id: 'late-detail-777', countryCode3: 'TUR' }, evidence: 'Later supplier response'
    };
    assert.equal((await post(platform, 'company-details/late-results', late)).status, 200);
    assert.equal((await post(platform, 'company-details/late-results', late)).status, 200);
    assert.equal((await post(platform, 'company-details/late-results', { ...late, result: { id: 'changed', countryCode3: 'TUR' } })).status, 409);
    assert.equal((await post(platform, 'company-details/late-results', { ...late, queryId: settledId })).status, 409);
    const failed = (await pool.query('SELECT state,charged_points FROM company_detail_queries WHERE id=$1', [failedId])).rows[0];
    assert.deepEqual(failed, { state: 'failed', charged_points: '0.0000' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_detail_late_results WHERE query_id=$1', [failedId])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM query_point_ledger WHERE query_id=$1', [failedId])).rows[0].n, 2);
    assert.deepEqual((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0],
      { balance: '4.0000', query_frozen: '0.0000' });
    const expense = {
      requestId: randomUUID(), purpose: 'failure', amount: '20.0000', sourceReference: 't13-failed-bill-2',
      evidence: 'Loss amount from supplier bill', detailLossQueryId: failedId
    };
    assert.equal((await post(platform, 'procurement/expenses', expense)).status, 201);
    assert.equal((await post(platform, 'procurement/expenses', { ...expense, requestId: randomUUID(), sourceReference: 'another-reference' })).status, 409);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM platform_expenses WHERE detail_loss_query_id=$1', [failedId])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_detail_reconciliations WHERE query_id IN ($1,$2)', [settledId, failedId])).rows[0].n, 2);
    const savedExpense = (await pool.query('SELECT id FROM platform_expenses WHERE detail_loss_query_id=$1', [failedId])).rows[0].id as string;
    assert.equal((await post(platform, 'procurement/purchases', {
      requestId: randomUUID(), purpose: 'failure', upstreamPoints: '0.4000', amount: '20.0000',
      receiptReference: 't13-recharge-1', evidence: 'Bank receipt', expenseId: savedExpense
    })).status, 201);
    assert.deepEqual((await pool.query('SELECT balance,average_cost FROM platform_inventory')).rows[0],
      { balance: '0.0000', average_cost: '0.0000' });
    const listing = await fetch(`${origin}/api/company-details/reconciliations`, { headers: { Cookie: platform.cookie } });
    assert.equal(listing.status, 200);
    const listed = await listing.json() as Array<{ queryId: string; reconciliationEvidence: string; reconciledBy: string; reconciledAt: string; expenseId: string }>;
    assert.equal(listed.find(item => item.queryId === failedId)?.expenseId, savedExpense);
    assert.equal(listed.find(item => item.queryId === failedId)?.reconciledBy, platform.actor);
    assert.ok(listed.find(item => item.queryId === failedId)?.reconciledAt);

    const racingId = await quote(terminal, 'Racing T13 Company', false);
    let resolveDetail!: (value: DetailResult) => void;
    deferred = new Promise(resolve => { resolveDetail = resolve; });
    const inFlight = post(terminal, 'company-details/execute', { queryId: racingId });
    while ((await pool.query('SELECT state FROM company_detail_queries WHERE id=$1', [racingId])).rows[0].state !== 'pending')
      await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await post(platform, 'company-details/reconciliations', {
      queryId: racingId, outcome: 'failed', billingReference: 'bill-t13-3', traceId: 'trace-t13-3',
      upstreamPoints: '0.2000', evidence: 'Final failure before response'
    })).status, 200);
    resolveDetail({ data: { id: 'late-race-990', countryCode3: 'TUR' }, traceId: 'trace-t13-race' });
    assert.equal((await inFlight).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_detail_late_results WHERE query_id=$1', [racingId])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT state,charged_points FROM company_detail_queries WHERE id=$1', [racingId])).rows[0].state, 'failed');
    assert.equal((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0].balance, '4.0000');
    const profileId = (await pool.query('SELECT id FROM company_profiles WHERE query_id=$1', [settledId])).rows[0].id as string;
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/contact',0.5000,2,'fixture','controlled_test',$1,$2)`, [randomUUID(), platform.actor]);
    async function contactQuote(pageNo: number) {
      const quoted = await post(terminal, 'company-contacts/quote', {
        profileId, positionTags: ['SALE'], pageNo, pageSize: 20
      });
      assert.equal(quoted.status, 200);
      const { queryId } = await quoted.json() as { queryId: string };
      assert.equal((await post(terminal, 'company-contacts/execute', { queryId })).status, 200);
      return queryId;
    }
    const contactId = await contactQuote(1);
    const contactPage = {
      list: [{ mailsouId: 'supplier-contact-id-77', companyName: 'Other Company', email: 'person@example.com',
        personalEmail: null, positionTag: 'SALE', credibility: 'HIGH' }], pageNo: 1, pageSize: 20, total: 1
    };
    const contactSettlement = {
      queryId: contactId, outcome: 'settled', billingReference: 'contact-bill-1', traceId: 'contact-trace-1',
      upstreamPoints: '0.4567', result: contactPage, evidence: 'Contact page and bill'
    };
    assert.equal((await post(platform, 'company-contacts/reconciliations', contactSettlement)).status, 200);
    assert.equal((await post(platform, 'company-contacts/reconciliations', contactSettlement)).status, 200);
    assert.deepEqual((await pool.query(`SELECT mailsou_id,query_company_name,returned_company_name,ownership_status
      FROM company_contacts WHERE query_id=$1`, [contactId])).rows[0], {
      mailsou_id: 'supplier-contact-id-77', query_company_name: 'Selected T13 Company',
      returned_company_name: 'Other Company', ownership_status: 'pending'
    });
    assert.equal((await pool.query('SELECT charged_points FROM company_contact_queries WHERE id=$1', [contactId])).rows[0].charged_points, '0.4567');
    const failedContactId = await contactQuote(2);
    assert.equal((await post(platform, 'company-contacts/reconciliations', {
      queryId: failedContactId, outcome: 'failed', billingReference: 'contact-bill-2', traceId: 'contact-trace-2',
      upstreamPoints: '0.3000', evidence: 'No viewable page'
    })).status, 200);
    assert.equal((await post(platform, 'company-contacts/late-results', {
      queryId: failedContactId, billingReference: 'contact-bill-2', traceId: 'contact-late-2',
      result: { list: [], pageNo: 2, pageSize: 20, total: 0 }, evidence: 'Late zero page'
    })).status, 200);
    assert.equal((await pool.query('SELECT state,charged_points FROM company_contact_queries WHERE id=$1', [failedContactId])).rows[0].state, 'failed');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contact_late_results WHERE query_id=$1', [failedContactId])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT upstream_points FROM company_contact_losses WHERE query_id=$1', [failedContactId])).rows[0].upstream_points, '0.3000');
    const productId = randomUUID();
    await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,
      start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,'ceramic pump','TUR','2026-01-01','2026-06-30',1,20,1.0000,1.0000,$4,'pending')`,
    [productId, terminal.org, terminal.actor, randomUUID()]);
    await pool.query('UPDATE internal_point_accounts SET query_frozen=query_frozen+1.0000 WHERE organization_id=$1', [terminal.org]);
    await pool.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
      VALUES($1,$2,$3,'freeze',1.0000,3.5433,1.0000)`, [productId, terminal.org, terminal.actor]);
    const productResult = { content: [{ name: 'Buyer Name from Trade' }], page: 1, size: 20, total: 1 };
    const productSettlement = {
      queryId: productId, outcome: 'settled', billingReference: 'product-bill-1', traceId: 'product-trace-1',
      upstreamPoints: '0.2500', result: productResult, evidence: 'Viewable name page and bill'
    };
    assert.equal((await post(platform, 'product-searches/reconciliations', productSettlement)).status, 200);
    assert.equal((await post(platform, 'product-searches/reconciliations', productSettlement)).status, 200);
    assert.equal((await pool.query('SELECT source_name FROM product_search_candidates WHERE page_id=$1', [productId])).rows[0].source_name,
      'Buyer Name from Trade');
    assert.equal((await pool.query('SELECT charged_points FROM product_search_pages WHERE id=$1', [productId])).rows[0].charged_points, '0.2500');
    const failedProductId = randomUUID();
    await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,
      start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,'industrial valve','TUR','2026-01-01','2026-06-30',1,20,1.0000,1.0000,$4,'pending')`,
    [failedProductId, terminal.org, terminal.actor, randomUUID()]);
    await pool.query('UPDATE internal_point_accounts SET query_frozen=query_frozen+1.0000 WHERE organization_id=$1', [terminal.org]);
    await pool.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
      VALUES($1,$2,$3,'freeze',1.0000,3.2933,1.0000)`, [failedProductId, terminal.org, terminal.actor]);
    assert.equal((await post(platform, 'product-searches/reconciliations', {
      queryId: failedProductId, outcome: 'failed', billingReference: 'product-bill-2',
      upstreamPoints: '0.1000', evidence: 'No viewable name page'
    })).status, 200);
    assert.equal((await post(platform, 'product-searches/late-results', {
      queryId: failedProductId, billingReference: 'product-bill-2', traceId: 'product-late-2',
      result: { content: [{ name: 'Late Buyer' }], page: 1, size: 20, total: 1 }, evidence: 'Late page'
    })).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_search_late_results WHERE page_id=$1', [failedProductId])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT state FROM product_search_pages WHERE id=$1', [failedProductId])).rows[0].state, 'failed');
    assert.equal((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0].balance, '3.2933');
    assert.equal((await post(platform, 'procurement/expenses', {
      requestId: randomUUID(), purpose: 'failure', amount: '5.0000', sourceReference: 'product-loss-bill-2',
      evidence: 'Supplier bill cash cost', productLossPageId: failedProductId
    })).status, 201);
    assert.equal((await post(platform, 'procurement/expenses', {
      requestId: randomUUID(), purpose: 'failure', amount: '5.0000', sourceReference: 'product-loss-duplicate',
      evidence: 'Duplicate bill cost', productLossPageId: failedProductId
    })).status, 409);
    deferred = null;
    const laterBilledId = await quote(terminal, 'Later Billed T13 Company');
    assert.equal((await post(platform, 'company-details/final-failure', {
      queryId: laterBilledId, evidence: 'Final failure before supplier bill'
    })).status, 200);
    assert.equal((await post(platform, 'company-details/late-results', {
      queryId: laterBilledId, billingReference: 'bill-t13-4', traceId: 'trace-t13-4',
      upstreamPoints: '0.3000', result: { id: 'late-billed-901', countryCode3: 'TUR' }, evidence: 'Later bill and result'
    })).status, 200);
    assert.deepEqual((await pool.query('SELECT purpose,upstream_points FROM company_detail_losses WHERE query_id=$1', [laterBilledId])).rows[0],
      { purpose: 'failure', upstream_points: '0.3000' });
    assert.equal((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0].balance, '3.2933');
  } finally {
    await app.close();
    await pool.end();
  }
});
