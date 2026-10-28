import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createApplication } from '../.scratch/issue46-dist/server/app.js';
import { hashPassword } from '../.scratch/issue46-dist/server/identity/policy.js';
import { database, migrate } from '../.scratch/issue46-dist/server/database.js';

const origin = 'http://127.0.0.1:3466';
const password = 'Issue46-browser-password-2026';
let pool, app;
let platform, terminal;
const fixtures = [];
const calls = [];
const submissions = [];
const reads = [];

async function account(role, parent, mustChange = false) {
  const org = randomUUID(), actor = randomUUID();
  const kind = role === 'platform' ? 'platform' : role === 'distributor' ? 'distributor' : 'terminal';
  await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
    VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [org, `issue46-${role}`, kind, parent ?? null, kind === 'distributor' ? 1 : 0, randomUUID()]);
  const email = `${actor}@example.com`;
  await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '72 hours')`, [actor, org, email, await hashPassword(password), role, mustChange]);
  return { org, actor, email, role, mustChange };
}
async function login(page, identity, credential = password) {
  await page.goto(`${origin}/platform/reconciliation`);
  await page.getByLabel('登录账号', { exact: true }).fill(identity.email);
  await page.getByLabel('密码', { exact: true }).fill(credential);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  if (identity.mustChange) await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible();
  else await expect(page).toHaveURL(`${origin}/${identity.role === 'platform' ? 'platform/overview' : identity.role === 'distributor' ? 'distribution/organizations' : 'terminal/search'}`);
}
async function api(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const csrf = document.cookie.split('; ').find(value => value.startsWith('identity_csrf='))?.slice(14) ?? '';
    const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? {
      'Content-Type': 'application/json', 'X-CSRF-Token': csrf
    } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }, { path, body });
}
function row(page, fixture) { return page.getByRole('row').filter({ hasText: fixture.id }); }
async function edit(page, fixture, late = false) {
  await row(page, fixture).getByRole('button', { name: late ? '登记迟到结果' : '核对', exact: true }).click();
  if (!late) await page.getByLabel('核对结论').selectOption(fixture.outcome);
  const body = {
    queryId: fixture.id,
    billingReference: `bill-${fixture.id}`,
    traceId: `trace-${fixture.id}${late ? '-late' : ''}`,
    evidence: `evidence-${fixture.id}${late ? '-late' : ''}`
  };
  await page.getByLabel('供应商账单引用').fill(body.billingReference);
  await page.getByLabel('traceId', { exact: true }).fill(body.traceId);
  await page.getByLabel('核对依据', { exact: true }).fill(body.evidence);
  await page.getByLabel('实际上游扣点（失败或迟到结果如已知请填写）').fill(late ? '' : fixture.outcome === 'settled' ? '1.2500' : '0.1000');
  if (!late) body.upstreamPoints = fixture.outcome === 'settled' ? '1.2500' : '0.1000';
  if (late || fixture.outcome !== 'failed') {
    body.result = late ? fixture.lateResult : fixture.result;
    await page.locator('#detail-result').fill(JSON.stringify(body.result));
  }
  if (!late) body.outcome = fixture.outcome;
  return body;
}
async function submit(page, fixture, body, late = false) {
  const path = `${fixture.base}/${late ? 'late-results' : 'reconciliations'}`;
  const response = page.waitForResponse(value => value.url() === `${origin}/api/${path}` && value.request().method() === 'POST');
  await page.getByRole('button', { name: '确认并留痕' }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText(late ? '迟到结果已留存' : '核对已完成');
  expect(submissions.at(-1)).toEqual({ path, body });
  expect(body.queryId).not.toBe(fixture.candidate);
  expect(body.queryId).not.toBe(fixture.profile);
  if (!late) await expect(row(page, fixture)).toContainText(`${fixture.outcome} /`);
}

test.beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).pathname !== '/issue46_test') throw new Error('仅允许专用 issue46_test 数据库');
  process.env.ORG_CONTACT_KEY ??= randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY ??= randomBytes(32).toString('hex');
  pool = database(url);
  await migrate(pool);
  await pool.query('TRUNCATE application_keys,login_throttles,audit_events,sessions,bootstrap_marker,accounts,organizations RESTART IDENTITY CASCADE');
  platform = await account('platform');
  terminal = await account('admin', platform.org);
  const search = randomUUID(), candidate = randomUUID(), seedQuery = randomUUID(), profile = randomUUID();
  await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
    VALUES($1,$2,$3,'search-term-distinct','TUR',1,20,1,'verified')`, [search, terminal.org, terminal.actor]);
  await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
    VALUES($1,$2,$3,'supplier-list-distinct','Selected Company','TUR','verified')`, [candidate, search, terminal.org]);
  await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
    VALUES($1,$2,$3,$4,'Seed Profile','TUR',1,1,$5,'settled')`, [seedQuery, terminal.org, terminal.actor, candidate, randomUUID()]);
  await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
    VALUES($1,$2,'supplier-detail-distinct','Selected Company','TUR','{}',$3)`, [profile, terminal.org, seedQuery]);
  await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen) VALUES($1,100,10)', [terminal.org]);
  for (const kind of ['detail', 'contact', 'product']) {
    for (const outcome of ['settled', 'zero', 'failed', ...(kind === 'detail' ? ['unknown'] : [])]) {
      const id = randomUUID(), name = `${kind}-${outcome}`;
      const f = { id, kind, name, outcome: outcome === 'unknown' ? 'settled' : outcome, candidate, profile,
        base: kind === 'detail' ? 'company-details' : kind === 'contact' ? 'company-contacts' : 'product-searches',
        table: kind === 'detail' ? 'company_detail_queries' : kind === 'contact' ? 'company_contact_queries' : 'product_search_pages',
        ledger: kind === 'detail' ? 'query_point_ledger' : kind === 'contact' ? 'company_contact_point_ledger' : 'product_search_ledger' };
      if (kind === 'detail') {
        const rowCandidate = randomUUID();
        await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
          VALUES($1,$2,$3,$4,$5,'TUR','verified')`, [rowCandidate, search, terminal.org, `list-${id}`, name]);
        f.candidate = rowCandidate;
        await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
          VALUES($1,$2,$3,$4,$5,'TUR',1,1,$6,'pending')`, [id, terminal.org, terminal.actor, rowCandidate, name, randomUUID()]);
        f.result = outcome === 'zero' ? { id: null } : { id: `supplier-result-${id}`, fileId: `file-${id}`, countryCode3: 'TUR' };
        f.lateResult = { id: `late-${id}`, countryCode3: 'TUR' };
      } else if (kind === 'contact') {
        const pageNo = fixtures.filter(item => item.kind === kind).length + 1;
        await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
          VALUES($1,$2,$3,$4,$5,ARRAY['SALE'],$6,20,1,1,$7,'pending')`, [id, terminal.org, terminal.actor, profile, name, pageNo, randomUUID()]);
        f.result = { list: outcome === 'zero' ? [] : [{ mailsouId: `mailsou-${id}`, companyName: 'Other Returned Company', email: 'person@example.com' }], pageNo, pageSize: 20, total: outcome === 'zero' ? 0 : 1 };
        f.lateResult = { list: [], pageNo, pageSize: 20, total: 0 };
      } else {
        await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
          VALUES($1,$2,$3,$4,'TUR','2026-01-01','2026-06-30',1,20,1,1,$5,'pending')`, [id, terminal.org, terminal.actor, name, randomUUID()]);
        f.result = { content: outcome === 'zero' ? [] : [{ name: 'Trade Buyer', id: 'upstream-item-distinct' }], page: 1, size: 20, total: outcome === 'zero' ? 0 : 1 };
        f.lateResult = { content: [{ name: 'Late Buyer' }], page: 1, size: 20, total: 1 };
      }
      const key = kind === 'product' ? 'page_id' : 'query_id';
      await pool.query(`INSERT INTO ${f.ledger}(${key},organization_id,actor_id,event,amount,balance_after,frozen_after) VALUES($1,$2,$3,'freeze',1,100,10)`, [id, terminal.org, terminal.actor]);
      fixtures.push(f);
    }
  }
  const detailAdapter = { detail: async input => { calls.push(input); throw new Error('unexpected supplier call'); } };
  app = await createApplication(pool, origin, false, undefined, { listCompanies: async input => { calls.push(input); throw new Error('unexpected'); } }, undefined, detailAdapter,
    undefined, { contacts: async input => { calls.push(input); throw new Error('unexpected'); } },
    { buyerCountryFilterVerified: true, importerNames: async input => { calls.push(input); throw new Error('unexpected'); } }, undefined, undefined, resolve('.scratch/issue46-web'));
  await app.listen(3466, '127.0.0.1');
});
test.afterAll(async () => { await app?.close(); await pool?.end(); });

test('真实浏览器核对三类查询、离开保护、迟到结果、幂等、权限和账务', async ({ page, browser }) => {
  page.on('request', request => {
    const path = new URL(request.url()).pathname.replace('/api/', '');
    if (/^(company-details|company-contacts|product-searches)\/(reconciliations|late-results)$/.test(path)) {
      if (request.method() === 'POST') submissions.push({ path, body: request.postDataJSON() });
      else reads.push(path);
    }
  });
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  await login(page, platform);
  await page.goto(`${origin}/platform/reconciliation`);
  await expect(page.getByRole('heading', { name: '查询结果人工核对' })).toBeVisible();
  await page.reload();
  await expect(row(page, fixtures[0])).toBeVisible();
  expect((await page.request.get(`${origin}/platform/reconciliation`)).status()).toBe(200);
  expect((await page.request.get(`${origin}/api/issue46-unknown`)).status()).toBe(404);
  const f = fixtures[0];
  let body = await edit(page, f);
  const readsBefore = reads.length;
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '查看上游监控页面' }).click();
  await expect(page).toHaveURL(`${origin}/platform/reconciliation`);
  await expect(page.locator('#detail-bill')).toHaveValue(body.billingReference);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '平台设置', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/platform/reconciliation`);
  const backDialog = page.waitForEvent('dialog');
  await page.evaluate(() => history.back());
  await (await backDialog).dismiss();
  await expect(page).toHaveURL(`${origin}/platform/reconciliation`);
  await expect(page.locator('#detail-bill')).toHaveValue(body.billingReference);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '查看上游监控页面' }).click();
  await expect(page).toHaveURL(`${origin}/platform/reconciliation/upstream`);
  await page.goBack();
  await expect(page.locator('#detail-bill')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(`${origin}/platform/reconciliation/upstream`);
  await page.goBack();
  await expect(row(page, f)).toBeVisible();
  expect(reads.length).toBe(readsBefore);
  expect(submissions.length).toBe(0);
  body = await edit(page, f);
  // Genuine backend validation refusal leaves the entered data available.
  await page.locator('#detail-result').fill(JSON.stringify({ id: 'wrong-country', countryCode3: 'USA' }));
  const refused = page.waitForResponse(r => r.url().endsWith('/company-details/reconciliations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '确认并留痕' }).click();
  expect((await refused).status()).toBe(400);
  await expect(page.locator('#detail-bill')).toHaveValue(body.billingReference);
  await page.locator('#detail-result').fill(JSON.stringify(body.result));
  await submit(page, f, body);
  expect((await api(page, `${f.base}/reconciliations`, body)).status).toBe(200);
  expect((await api(page, `${f.base}/reconciliations`, { ...body, upstreamPoints: '1.5000' })).status).toBe(409);
  for (const fixture of fixtures.slice(1)) {
    const expected = await edit(page, fixture);
    if (fixture.name === 'detail-unknown') {
      // Forward the POST to the real backend, then lose only its response.
      let dispatched;
      const started = new Promise(resolve => { dispatched = resolve; });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(`**/api/${fixture.base}/reconciliations`, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        dispatched();
        await gate;
        await route.abort('failed');
      });
      await page.getByRole('button', { name: '确认并留痕' }).click();
      await started;
      await page.getByRole('link', { name: '查看上游监控页面' }).click();
      await expect(page).toHaveURL(`${origin}/platform/reconciliation`);
      release();
      await expect(page.getByText('提交结果尚未确认，请刷新查询核实。离开不会取消或重试请求。', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '确认并留痕' })).toBeDisabled();
      const count = submissions.length;
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('link', { name: '查看上游监控页面' }).click();
      await page.goBack();
      await expect(page.locator('#detail-bill')).toHaveValue(expected.billingReference);
      expect(submissions.length).toBe(count);
      await page.unroute(`**/api/${fixture.base}/reconciliations`);
      await page.getByRole('button', { name: '刷新查询', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('查询已有处理记录');
      expect(submissions.length).toBe(count);
    } else {
      await submit(page, fixture, expected);
      expect((await api(page, `${fixture.base}/reconciliations`, expected)).status).toBe(200);
      expect((await api(page, `${fixture.base}/reconciliations`, { ...expected, evidence: 'conflicting-evidence' })).status).toBe(409);
    }
    if (fixture.outcome === 'failed') {
      const before = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0];
      const late = await edit(page, fixture, true);
      await submit(page, fixture, late, true);
      expect((await api(page, `${fixture.base}/late-results`, late)).status).toBe(200);
      expect((await api(page, `${fixture.base}/late-results`, { ...late, evidence: 'conflicting-late' })).status).toBe(409);
      expect((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0]).toEqual(before);
      const lateTable = fixture.kind === 'detail' ? 'company_detail_late_results' : fixture.kind === 'contact' ? 'company_contact_late_results' : 'product_search_late_results';
      expect((await pool.query(`SELECT count(*)::int n FROM ${lateTable} WHERE ${fixture.kind === 'product' ? 'page_id' : 'query_id'}=$1`, [fixture.id])).rows[0].n).toBe(1);
    }
  }
  expect((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0]).toEqual({ balance: '96.0000', query_frozen: '0.0000' });
  for (const fixture of fixtures) {
    const stored = (await pool.query(`SELECT state,charged_points,actual_upstream_points,billing_reference FROM ${fixture.table} WHERE id=$1`, [fixture.id])).rows[0];
    expect(stored).toEqual({ state: fixture.outcome, charged_points: fixture.outcome === 'settled' ? '1.0000' : '0.0000', actual_upstream_points: fixture.outcome === 'settled' ? '1.2500' : '0.1000', billing_reference: `bill-${fixture.id}` });
    const key = fixture.kind === 'product' ? 'page_id' : 'query_id';
    expect((await pool.query(`SELECT count(*)::int n FROM ${fixture.ledger} WHERE ${key}=$1 AND event='release'`, [fixture.id])).rows[0].n).toBe(1);
  }
  expect((await pool.query('SELECT detail_id FROM company_profiles WHERE query_id=$1', [f.id])).rows[0].detail_id).toBe(f.result.id);
  const cf = fixtures.find(item => item.kind === 'contact' && item.outcome === 'settled');
  expect((await pool.query('SELECT mailsou_id,ownership_status FROM company_contacts WHERE query_id=$1', [cf.id])).rows[0]).toEqual({ mailsou_id: cf.result.list[0].mailsouId, ownership_status: 'pending' });
  const pf = fixtures.find(item => item.kind === 'product' && item.outcome === 'settled');
  expect((await pool.query('SELECT source_name FROM product_search_candidates WHERE page_id=$1', [pf.id])).rows[0].source_name).toBe('Trade Buyer');
  expect(calls).toEqual([]);
  for (const fixture of fixtures.filter(item => item.outcome === 'failed')) {
    const lossKey = fixture.kind === 'detail' ? 'detailLossQueryId' : fixture.kind === 'contact' ? 'contactLossQueryId' : 'productLossPageId';
    const expense = {
      requestId: randomUUID(), purpose: 'failure', amount: '5.0000',
      sourceReference: `loss-${fixture.id}`, evidence: 'Supplier bill cash cost', [lossKey]: fixture.id
    };
    expect((await api(page, 'procurement/expenses', expense)).status).toBe(201);
    expect((await api(page, 'procurement/expenses', { ...expense, requestId: randomUUID(), sourceReference: `duplicate-${fixture.id}` })).status).toBe(409);
    const column = fixture.kind === 'detail' ? 'detail_loss_query_id' : fixture.kind === 'contact' ? 'contact_loss_query_id' : 'product_loss_page_id';
    expect((await pool.query(`SELECT count(*)::int n FROM platform_expenses WHERE ${column}=$1`, [fixture.id])).rows[0].n).toBe(1);
  }
  // Reuse the same browser session across logout and each role login.
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  for (const role of ['distributor', 'admin', 'sales']) {
    const identity = role === 'admin' ? terminal : await account(role, platform.org);
    const other = page;
    await login(other, identity);
    await other.goto(`${origin}/platform/reconciliation`);
    await expect(other).toHaveURL(`${origin}/${role === 'distributor' ? 'distribution/organizations' : 'terminal/search'}`);
    await expect(other.getByRole('heading', { name: '查询结果人工核对' })).toHaveCount(0);
    for (const base of ['company-details', 'company-contacts', 'product-searches']) {
      expect((await api(other, `${base}/reconciliations`)).status).toBe(403);
      expect((await api(other, `${base}/reconciliations`, { queryId: f.id })).status).toBe(403);
      expect((await api(other, `${base}/late-results`, { queryId: f.id })).status).toBe(403);
    }
    await other.getByRole('button', { name: '退出登录' }).click();
    await expect(other.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  }
  const temporary = await account('admin', platform.org, true);
  const context = await browser.newContext();
  const other = await context.newPage();
  await login(other, temporary);
  await expect(other.getByRole('heading', { name: '设置新密码' })).toBeVisible();
  await other.goto(`${origin}/platform/reconciliation`);
  await expect(other.getByRole('heading', { name: '设置新密码' })).toBeVisible();
  expect((await api(other, 'company-details/reconciliations')).status).toBe(403);
  const newPassword = 'Issue46-changed-password-2026';
  await other.getByLabel('当前密码', { exact: true }).fill(password);
  await other.getByLabel('新密码', { exact: true }).fill(newPassword);
  await other.getByLabel('确认新密码', { exact: true }).fill(newPassword);
  await other.getByRole('button', { name: '确认修改并重新登录' }).click();
  await expect(other.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await login(other, { ...temporary, mustChange: false }, newPassword);
  await expect(other).toHaveURL(`${origin}/terminal/search`);
  await context.close();
  const balances = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminal.org])).rows[0];
  await writeFile(resolve('.scratch/issue46-evidence.json'), JSON.stringify({
    database: 'issue46_test', port: 3466, databasePort: 55466,
    selectedRecords: fixtures, requests: submissions, balances, supplierCalls: calls,
    platformActor: platform.actor, terminalOrganization: terminal.org,
    storedProfiles: (await pool.query('SELECT id,query_id,detail_id FROM company_profiles')).rows,
    contacts: (await pool.query('SELECT id,query_id,profile_id,mailsou_id,ownership_status FROM company_contacts')).rows,
    expenses: (await pool.query('SELECT id,detail_loss_query_id,contact_loss_query_id,product_loss_page_id FROM platform_expenses')).rows
  }, null, 2));
});

