import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { database, migrate } from '../../server/database.js';
import { createApplication } from '../../server/app.js';

test('issue41 purchase, expenses, accounting, permissions and navigation with real PostgreSQL', async ({ page, playwright, browser }) => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('Dedicated _test database URL required');
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = database(adminUrl.toString());
  const name = `issue41_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const pool = database(url.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:3441';
  const path = '/platform/ledger/procurement';
  const contexts: APIRequestContext[] = [];
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const writes: Record<string, unknown>[] = [];
  let reads = 0;
  page.on('request', req => {
    if (req.url().includes('/api/procurement')) {
      if (req.method() === 'POST') writes.push({ path: new URL(req.url()).pathname, ...req.postDataJSON() });
      else reads++;
    }
  });
  async function login(email: string, password = 'Issue41Password123!') {
    const api = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    contexts.push(api);
    expect((await api.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
    return api;
  }
  async function post(api: APIRequestContext, endpoint: string, data: Record<string, unknown>) {
    const token = (await api.storageState()).cookies.find(item => item.name === 'identity_csrf')!.value;
    return api.post('/api/' + endpoint, { data, headers: { 'X-CSRF-Token': token } });
  }
  async function purchaseForm(purpose: string, reference: string, amount = '40') {
    await page.locator('#purchase-purpose').selectOption(purpose);
    await page.locator('#purchase-points').fill('10');
    await page.locator('#purchase-amount').fill(amount);
    await page.locator('#purchase-reference').fill(reference);
    await page.locator('#purchase-evidence').fill('supplier receipt verified');
  }
  async function expenseForm(purpose: string, reference: string, field?: string, id?: string) {
    await page.locator('#expense-purpose').selectOption(purpose);
    await page.locator('#expense-amount').fill('7');
    await page.locator('#expense-reference').fill(reference);
    await page.locator('#expense-evidence').fill('loss bill verified');
    for (const selector of ['#expense-detail-loss', '#expense-contact-loss', '#expense-product-loss']) await page.locator(selector).fill('');
    if (field) await page.locator(field).fill(id!);
  }
  async function submit(label: string, status = 201) {
    const response = page.waitForResponse(res => res.request().method() === 'POST' && res.url().includes('/api/procurement/'));
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await response).status()).toBe(status);
    await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
  }
  try {
    await migrate(pool);
    await pool.query('UPDATE platform_pricing SET coefficient=3');
    await pool.query('UPDATE platform_inventory SET balance=10,average_cost=2');
    app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, resolve('.scratch/issue41-web'));
    await app.listen(3441, '127.0.0.1');
    const initial = await login('super_admin', 'init@Base123');
    expect((await initial.get('/api/procurement')).status()).toBe(403);
    expect((await post(initial, 'auth/password', { currentPassword: 'init@Base123', newPassword: 'Issue41Password123!', confirmPassword: 'Issue41Password123!' })).status()).toBe(200);
    const platform = await login('super_admin');
    const actor = (await pool.query("SELECT id,organization_id,password_hash FROM accounts WHERE username='super_admin'")).rows[0];
    const org = randomUUID(), candidate = randomUUID(), search = randomUUID(), detail = randomUUID(), profile = randomUUID(), contact = randomUUID(), product = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,'fixture','terminal',$2,'fixture',$3,'***')", [org, actor.organization_id, randomUUID()]);
    for (const role of ['admin', 'sales', 'distributor']) {
      const roleOrg = role === 'distributor' ? randomUUID() : org;
      if (role === 'distributor') await pool.query("INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked) VALUES($1,'dist','distributor',$2,1,'fixture',$3,'***')", [roleOrg, actor.organization_id, randomUUID()]);
      await pool.query('INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,false)', [randomUUID(), roleOrg, `${role}41@example.com`, actor.password_hash, role]);
    }
    await pool.query("INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status) VALUES($1,$2,$3,'Company','USA',1,10,1,'verified')", [search, org, actor.id]);
    await pool.query("INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country) VALUES($1,$2,$3,'supplier-id-distinct','Company','USA')", [candidate, search, org]);
    await pool.query("INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Company','USA',3,3,$5,'failed')", [detail, org, actor.id, candidate, randomUUID()]);
    await pool.query("INSERT INTO company_detail_losses(query_id,purpose,upstream_points,billing_reference,evidence,actor_id) VALUES($1,'failure',1,'detail-bill','fixture',$2)", [detail, actor.id]);
    await pool.query("INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id) VALUES($1,$2,'supplier-detail','Company','USA','{}',$3)", [profile, org, detail]);
    await pool.query("INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Company','{}',1,10,3,3,$5,'failed')", [contact, org, actor.id, profile, randomUUID()]);
    await pool.query("INSERT INTO company_contact_losses(query_id,purpose,upstream_points,billing_reference,evidence,actor_id) VALUES($1,'failure',1,'contact-bill','fixture',$2)", [contact, actor.id]);
    await pool.query("INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,'valve','USA','2026-01-01','2026-02-01',1,10,3,3,$4,'failed')", [product, org, actor.id, randomUUID()]);
    await pool.query("INSERT INTO product_search_losses(page_id,purpose,upstream_points,billing_reference,evidence,actor_id) VALUES($1,'excess',1,'product-bill','fixture',$2)", [product, actor.id]);
    await page.context().addCookies((await platform.storageState()).cookies);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(origin + path);
    await expect(page.getByRole('heading', { name: '平台采购与承担费用', exact: true })).toHaveCount(1);
    await expect(page.locator('#compat-settings')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '基础计价配置' })).toHaveCount(0);
    await expect(page.getByTestId('inventory-balance')).toHaveText('10.0000');
    expect(reads).toBe(1);
    await expect(page.getByText('暂无费用记录，请在上方登记平台承担费用。')).toBeVisible();
    const cards = await page.locator('.entry-card').all();
    const left = (await cards[0].boundingBox())!;
    const right = (await cards[1].boundingBox())!;
    expect(Math.abs(left.width - right.width)).toBeLessThan(2);
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    expect(right.x).toBeGreaterThan(left.x + left.width);
    await page.locator('#purchase-amount').fill('123');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await expect(page).toHaveURL(origin + path);
    await expect(page.locator('#purchase-amount')).toHaveValue('123');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await page.goBack();
    await expect(page.locator('#purchase-amount')).toHaveValue('');
    await page.locator('#purchase-amount').fill('456');
    page.once('dialog', dialog => dialog.dismiss());
    await page.goForward();
    await expect(page).toHaveURL(origin + path);
    await expect(page.locator('#purchase-amount')).toHaveValue('456');
    page.once('dialog', dialog => dialog.accept());
    await page.goForward();
    await expect(page).toHaveURL(origin + '/help');
    await page.goBack();
    await expect(page.locator('#purchase-amount')).toHaveValue('');
    expect(reads).toBe(1);
    expect(writes).toHaveLength(0);

    await purchaseForm('sale', 'SALE41');
    await submit('确认采购入账');
    expect(writes[0]).toMatchObject({ purpose: 'sale', upstreamPoints: '10', amount: '40', receiptReference: 'SALE41', evidence: 'supplier receipt verified' });
    expect(writes[0]).not.toHaveProperty('expenseId');
    await expect(page.getByTestId('inventory-balance')).toHaveText('40.0000');
    await expect(page.getByTestId('inventory-cost')).toHaveText('1.5000');
    expect((await pool.query("SELECT coefficient_snapshot,generated_internal_points,amount FROM point_purchases WHERE receipt_reference='SALE41'")).rows[0])
      .toEqual({ coefficient_snapshot: '3.0000', generated_internal_points: '30.0000', amount: '40.0000' });
    await submit('确认采购入账');
    expect(writes[1]).toEqual(writes[0]);
    expect((await pool.query('SELECT count(*)::int n FROM point_purchases')).rows[0].n).toBe(1);

    const expenseIds: string[] = [];
    for (const [purpose, ref, field, id, column, key] of [
      ['failure', 'DETAIL41', '#expense-detail-loss', detail, 'detail_loss_query_id', 'detailLossQueryId'],
      ['failure', 'CONTACT41', '#expense-contact-loss', contact, 'contact_loss_query_id', 'contactLossQueryId'],
      ['excess', 'PRODUCT41', '#expense-product-loss', product, 'product_loss_page_id', 'productLossPageId']
    ]) {
      await expenseForm(purpose, ref, field, id);
      if (ref === 'DETAIL41') await page.route('**/api/procurement', route => route.abort(), { times: 1 });
      await submit('确认费用');
      if (ref === 'DETAIL41') {
        await expect(page.getByText('已记账，账务刷新失败：Network Error', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '使用原请求核对' })).toHaveCount(0);
      }
      const row = (await pool.query('SELECT * FROM platform_expenses WHERE source_reference=$1', [ref])).rows[0];
      expenseIds.push(row.id);
      expect(row[column]).toBe(id);
      expect(writes.at(-1)).toMatchObject({ purpose, sourceReference: ref, amount: '7', [key]: id });
      expect(Object.keys(writes.at(-1)!).filter(key => key.endsWith('LossQueryId') || key === 'productLossPageId')).toEqual([key]);
    }
    expect(new Set([detail, contact, product, ...expenseIds]).size).toBe(6);
    await expenseForm('failure', 'DETAIL-DUPLICATE41', '#expense-detail-loss', detail);
    await submit('确认费用', 409);
    await expenseForm('excess', 'WRONG-PURPOSE41', '#expense-contact-loss', contact);
    await submit('确认费用', 400);
    await expenseForm('failure', 'TWO-LOSSES41', '#expense-detail-loss', detail);
    await page.locator('#expense-contact-loss').fill(contact);
    await submit('确认费用', 400);
    await purchaseForm('failure', 'NO-EXPENSE41', '5');
    await submit('确认采购入账', 400);
    const bad = { purpose: 'failure', amount: '5', upstreamPoints: '10', receiptReference: 'BAD41', evidence: 'verified', expenseId: expenseIds[2], requestId: randomUUID() };
    expect((await post(platform, 'procurement/purchases', bad)).status()).toBe(400);
    expect((await post(platform, 'procurement/purchases', { ...bad, purpose: 'sale', requestId: randomUUID() })).status()).toBe(400);
    for (const [purpose, expenseId, ref] of [['failure', expenseIds[0], 'TOPUP41A'], ['failure', expenseIds[0], 'TOPUP41B'], ['excess', expenseIds[2], 'TOPUP41C']]) {
      await purchaseForm(purpose, ref, '5');
      await page.locator('#purchase-expense').selectOption(expenseId);
      await submit('确认采购入账');
      expect(writes.at(-1)).toMatchObject({ expenseId, purpose, amount: '5', receiptReference: ref });
    }
    await purchaseForm('coverage', 'COVERAGE41', '9');
    await page.locator('#purchase-expense').selectOption('');
    await submit('确认采购入账');
    expect(writes.at(-1)).not.toHaveProperty('expenseId');
    await expect(page.getByTestId('inventory-cost')).toHaveText('1.5000');
    await expect(page.getByTestId('inventory-balance')).toHaveText('40.0000');
    await expect(page.getByTestId('borne-expenses')).toHaveText('30.0000');

    // Commit succeeds, but the browser loses the response. No navigation may replay it.
    await purchaseForm('sale', 'LOST41');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let reached!: () => void;
    const committed = new Promise<void>(resolve => { reached = resolve; });
    await page.route('**/api/procurement/purchases', async route => {
      await route.fetch();
      reached();
      await held;
      await route.abort();
    }, { times: 1 });
    await page.getByRole('button', { name: '确认采购入账', exact: true }).click();
    await committed;
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await expect(page).toHaveURL(origin + path);
    release();
    await expect(page.getByRole('button', { name: '使用原请求核对' })).toBeVisible();
    const uncertain = writes.at(-1)!;
    await page.locator('#purchase-reference').fill('NEW-DRAFT41');
    await page.locator('#purchase-amount').fill('99');
    const writeCount = writes.length, readCount = reads;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await page.goBack();
    await expect(page.getByRole('button', { name: '使用原请求核对' })).toBeVisible();
    await expect(page.locator('#purchase-reference')).toHaveValue('NEW-DRAFT41');
    expect(writes).toHaveLength(writeCount);
    expect(reads).toBe(readCount);
    await page.getByRole('button', { name: '使用原请求核对' }).click();
    await expect(page.getByRole('button', { name: '使用原请求核对' })).toHaveCount(0);
    expect(writes.at(-1)).toEqual(uncertain);
    await expect(page.locator('#purchase-amount')).toHaveValue('99');
    await expect(page.getByTestId('inventory-balance')).toHaveText('70.0000');
    await expect(page.getByTestId('inventory-cost')).toHaveText('1.4286');
    const { path: _path, ...payload } = uncertain;
    expect((await post(platform, 'procurement/purchases', { ...payload, amount: '99' })).status()).toBe(409);
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(page.getByTestId('inventory-balance')).toHaveText('70.0000');
    expect(writes).toHaveLength(writeCount + 1);
    expect((await page.request.get(origin + '/api/unknown41')).status()).toBe(404);
    expect((await page.request.get(origin + '/assets/missing41.js')).status()).toBe(404);
    await expenseForm('coverage', 'EXPENSE-LOST41');
    await page.route('**/api/procurement/expenses', async route => {
      await route.fetch();
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '响应待确认' }) });
    }, { times: 1 });
    await submit('确认费用', 503);
    await expect(page.getByRole('button', { name: '使用原请求核对' })).toBeVisible();
    const unknownExpense = writes.at(-1)!;
    const expenseWriteCount = writes.length, expenseReadCount = reads;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await page.goBack();
    await expect(page.getByRole('button', { name: '使用原请求核对' })).toBeVisible();
    expect(writes).toHaveLength(expenseWriteCount);
    expect(reads).toBe(expenseReadCount);
    await page.getByRole('button', { name: '使用原请求核对' }).click();
    await expect(page.getByRole('button', { name: '使用原请求核对' })).toHaveCount(0);
    expect(writes.at(-1)).toEqual(unknownExpense);
    expect((await pool.query("SELECT count(*)::int n FROM platform_expenses WHERE source_reference='EXPENSE-LOST41'")).rows[0].n).toBe(1);
    for (const role of ['distributor', 'admin', 'sales']) {
      const api = await login(`${role}41@example.com`);
      expect((await api.get('/api/procurement')).status()).toBe(403);
      expect((await post(api, 'procurement/purchases', { ...payload, requestId: randomUUID() })).status()).toBe(403);
      expect((await post(api, 'procurement/expenses', { purpose: 'failure', amount: '7', sourceReference: 'unauthorized', evidence: 'fixture', requestId: randomUUID() })).status()).toBe(403);
      const context = await browser.newContext();
      await context.addCookies((await api.storageState()).cookies);
      const denied = await context.newPage();
      await denied.goto(origin + path);
      await expect(denied).not.toHaveURL(origin + path);
      await expect(denied.getByRole('heading', { name: '平台采购与承担费用' })).toHaveCount(0);
      await context.close();
    }
    const snapshot = await (await platform.get('/api/procurement')).json();
    expect(snapshot.expenses.find((item: { id: string }) => item.id === expenseIds[0])).toMatchObject({ amount: '7.0000', replenished_amount: '10.0000', reconciliation_difference: '3.0000' });
    expect(snapshot.totals).toEqual({ recorded_upstream_credits: '60.0000', cash_outflow: '104.0000', expenses: '37.0000' });
    expect(snapshot.purchases).toHaveLength(6);
    expect(snapshot.ledger).toHaveLength(11);
    expect((await pool.query('SELECT count(*)::int n FROM tengdao_call_audit')).rows[0].n).toBe(0);
    const browsingWrites = writes.length, browsingReads = reads;
    await page.getByRole('tab', { name: /费用来源与核对/ }).click();
    const expenseTable = page.getByRole('table', { name: '费用来源与核对', exact: true });
    await expect(expenseTable.getByRole('row').filter({ hasText: 'DETAIL41' })).toContainText('3.0000');
    await expect(expenseTable.getByRole('row').filter({ hasText: 'DETAIL41' })).toContainText('需核对');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await expenseTable.getByRole('button', { name: `复制编号 ${expenseIds[0]}`, exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expenseIds[0]);
    await page.getByRole('tab', { name: /采购及费用关联/ }).click();
    await expect(page.getByRole('table', { name: '采购及费用关联', exact: true }).getByText('SALE41', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /账务流水/ }).click();
    await expect(page.getByRole('table', { name: '账务流水', exact: true })).toBeVisible();
    const recordTabs = await page.getByRole('tab').all();
    const tabBoxes = await Promise.all(recordTabs.map(tab =>
      tab.boundingBox()
    ));
    expect(Math.abs(tabBoxes[0]!.y - tabBoxes[2]!.y)).toBeLessThan(2);
    expect(writes).toHaveLength(browsingWrites);
    expect(reads).toBe(browsingReads);
    await page.getByRole('tab', { name: /账务流水/ }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /采购及费用关联/ })).toBeFocused();
    await page.getByRole('tab', { name: /费用来源与核对/ }).click();
    await page.locator('.console-main').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: resolve('.scratch/procurement-style/desktop.png') });
    await page.locator('.procurement-forms').screenshot({ path: resolve('.scratch/procurement-style/forms-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCards = await page.locator('.entry-card').all();
    const mobileLeft = (await mobileCards[0].boundingBox())!;
    const mobileRight = (await mobileCards[1].boundingBox())!;
    expect(Math.abs(mobileLeft.x - mobileRight.x)).toBeLessThan(2);
    expect(mobileRight.y).toBeGreaterThanOrEqual(mobileLeft.y + mobileLeft.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('.console-main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.locator('#purchase-amount').fill('98.7654');
    await page.getByRole('tab', { name: /账务流水/ }).click();
    await page.getByRole('tab', { name: /费用来源与核对/ }).click();
    await expect(page.locator('#purchase-amount')).toHaveValue('98.7654');
    await page.locator('.console-main').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: resolve('.scratch/procurement-style/mobile.png') });
    await page.locator('#expense-purpose').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('.scratch/procurement-style/expense-mobile.png') });
    await page.getByRole('tab', { name: /费用来源与核对/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('.scratch/procurement-style/records-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1100 });
    async function logout() {
      await page.getByRole('button', { name: /的账号菜单/ }).click();
      await page.getByRole('menuitem', { name: '退出登录' }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    }
    async function uiLogin(email: string) {
      await page.getByLabel('登录账号', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill('Issue41Password123!');
      await page.getByRole('button', { name: '登录', exact: true }).click();
    }
    // Switching accounts in the same browser destroys the previous procurement cache.
    await page.locator('#purchase-reference').fill('SESSION-DRAFT41');
    page.once('dialog', dialog => dialog.accept());
    await logout();
    await uiLogin('sales41@example.com');
    await expect(page).toHaveURL(origin + '/terminal/search');
    await expect(page.getByRole('heading', { name: '平台采购与承担费用' })).toHaveCount(0);
    await logout();
    await uiLogin('super_admin');
    await expect(page).toHaveURL(origin + '/platform/overview');
    await page.getByRole('button', { name: '点数与账务', exact: true }).click();
    await page.getByRole('link', { name: '采购与费用', exact: true }).click();
    await expect(page.locator('#purchase-reference')).toHaveValue('');
    expect(writes).toHaveLength(expenseWriteCount + 1);
    writeFileSync(resolve('.scratch/issue41-evidence.json'), JSON.stringify({ database: name, stagedIntegration: false, ids: { detail, contact, product, expenseIds }, writes, snapshot, supplierCalls: 0 }, null, 2));
  } finally {
    for (const context of contexts) await context.dispose();
    await app?.close();
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
