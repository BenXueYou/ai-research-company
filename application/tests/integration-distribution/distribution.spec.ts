import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { database, migrate } from '../../server/database.js';
import { createApplication } from '../../server/app.js';

test('two-level distribution: fulfillment, scoped accounts, profit, CSV and unknown-result navigation', async ({ page, playwright }) => {
  const url = process.env.TEST_DATABASE_URL!;
  if (!/^\/integration_distribution_[0-9a-f]{16}_test$/.test(new URL(url).pathname)) throw new Error('Dedicated database required');
  const pool = database(url); await migrate(pool);
  const run = process.env.DISTRIBUTION_RUN!;
  const origin = 'http://127.0.0.1:' + process.env.DISTRIBUTION_PORT;
  const calls = { list: 0, detail: 0, contacts: 0 };
  const vendor = {
    listCompanies: async () => { calls.list++; throw new Error('Unexpected query'); },
    detail: async () => { calls.detail++; throw new Error('Unexpected query'); },
    contacts: async () => { calls.contacts++; throw new Error('Unexpected query'); }
  };
  const app = await createApplication(pool, origin, false, undefined, vendor, undefined, vendor, undefined, vendor, undefined, undefined, undefined, resolve(run, 'web'));
  const clients: APIRequestContext[] = [];
  const password = 'DistributionIntegration123!';
  const evidence: Record<string, unknown> = { environment: JSON.parse(readFileSync(run + '/environment.json', 'utf8')) };
  const submissions: { path: string; body: any }[] = [];
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', r => { const path = new URL(r.url()).pathname; if (r.method() === 'POST' && path.startsWith('/api/point-orders')) submissions.push({ path, body: r.postDataJSON() }); });
  async function client(email: string, secret = password) {
    const api = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }); clients.push(api);
    expect((await api.post('/api/auth/login', { data: { email, password: secret } })).status()).toBe(200); return api;
  }
  async function post(api: APIRequestContext, path: string, data: object, status = 201) {
    const csrf = (await api.storageState()).cookies.find(c => c.name === 'identity_csrf')!.value;
    const response = await api.post('/api/' + path, { data, headers: { 'X-CSRF-Token': csrf } });
    expect(response.status(), path).toBe(status); return response;
  }
  async function activate(email: string, secret: string) {
    const api = await client(email, secret);
    await post(api, 'auth/password', { currentPassword: secret, newPassword: password, confirmPassword: password }, 200);
    return client(email);
  }
  let serial = 0;
  async function open(api: APIRequestContext, kind: string) {
    serial++;
    const body = { name: '集成组织' + serial, kind, countryCode: '+852', phone: '1398800' + String(serial).padStart(4, '0'), email: 'integration' + serial + '@example.com', requestId: randomUUID() };
    const result = await (await post(api, 'organizations', body)).json();
    expect(result.organizationId).not.toBe(result.accountId); return { ...result, name: body.name };
  }
  async function login(email: string) {
    await page.goto(origin + '/');
    await page.getByLabel('登录账号', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: email + ' 的账号菜单', exact: true })).toBeVisible();
  }
  async function logout(email: string) {
    await page.getByRole('button', { name: email + ' 的账号菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  }
  async function link(name: string) { await page.getByRole('link', { name, exact: true }).click(); }
  try {
    await app.listen(Number(process.env.DISTRIBUTION_PORT), '127.0.0.1');
    const root = await activate('super_admin', 'init@Base123');
    const d1 = await open(root, 'distributor'), a1 = await activate(d1.email, d1.temporaryPassword);
    const d2 = await open(a1, 'distributor'), a2 = await activate(d2.email, d2.temporaryPassword);
    const leaf = await open(a2, 'terminal'); await activate(leaf.email, leaf.temporaryPassword);
    const sibling = await open(root, 'distributor'), other = await activate(sibling.email, sibling.temporaryPassword);
    evidence.identifiers = [d1, d2, leaf, sibling].map(o => ({ organizationId: o.organizationId, accountId: o.accountId, email: o.email }));
    await post(root, 'procurement/purchases', { requestId: randomUUID(), purpose: 'sale', upstreamPoints: '100', amount: '100', receiptReference: 'INTEGRATION-PURCHASE', evidence: 'controlled fixture' });
    const funding = (await (await post(root, 'point-orders', { requestId: randomUUID(), buyerId: d1.organizationId, quantity: '20', unitPrice: '2' })).json()).orderId;
    await post(root, 'point-orders/confirm', { requestId: randomUUID(), orderId: funding, receiptReference: 'INTEGRATION-FUNDING' });
    await post(root, 'point-orders/transfer', { requestId: randomUUID(), orderId: funding });
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,11.1234,1.0001,2.0002)', [leaf.organizationId]);
    await pool.query("INSERT INTO email_daily_usage(organization_id,usage_day,reserved,used) VALUES($1,'2026-10-28',2,7)", [leaf.organizationId]);
    const references = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, actor] of [d1, d2, leaf].entries()) {
      await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,'PRIVATE-INTEGRATION-QUERY','USA','2026-01-01','2026-02-01',1,20,1,4,$4,'settled')`, [references[index], actor.organizationId, actor.accountId, randomUUID()]);
      await pool.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',4,11.1234,1.0001)`, [references[index], actor.organizationId, actor.accountId]);
    }
    evidence.references = references;
    const orders: string[] = [];
    for (const [seller, buyer, quantity, price, gross] of [[d1, d2, '10', '3', '10.0000'], [d2, leaf, '4', '4', '4.0000']] as const) {
      await login(seller.email);
      const sellerApi = await client(seller.email);
      await expect(page).toHaveURL(origin + '/distribution/organizations');
      await page.locator('.organization-row').filter({ hasText: buyer.name }).getByRole('link', { name: '查看详情 →', exact: true }).click();
      await expect(page).toHaveURL(origin + '/distribution/organizations?id=' + buyer.organizationId);
      await expect(page.getByLabel('面包屑', { exact: true }).locator('[aria-current="page"]')).toHaveText(buyer.name);
      await link('点数订单与售价'); await expect(page.getByLabel('直属买方')).toHaveValue('');
      await page.goBack(); await expect(page).toHaveURL(origin + '/distribution/organizations?id=' + buyer.organizationId);
      await link('下级账户'); await expect(page.getByLabel('面包屑', { exact: true }).locator('[aria-current="page"]')).toHaveText('下级账户');
      await link('点数订单');
      await page.getByLabel('直属买方').selectOption(buyer.organizationId);
      await page.getByLabel('点数数量', { exact: true }).fill(quantity);
      await page.getByLabel('每点售价（人民币）').fill(price);
      await page.getByRole('button', { name: '建单', exact: true }).click();
      await expect(page.getByRole('button', { name: '确认足额收款', exact: true })).toBeVisible();
      const orderId = (await pool.query('SELECT id FROM point_orders WHERE seller_id=$1', [seller.organizationId])).rows[0].id; orders.push(orderId);
      expect(submissions.at(-1)!.body).toMatchObject({ buyerId: buyer.organizationId, quantity, unitPrice: price });
      expect(orderId).not.toBe(buyer.organizationId); expect(orderId).not.toBe(buyer.accountId);
      await page.getByRole('button', { name: '确认足额收款', exact: true }).click();
      const receipt = 'INTEGRATION-RECEIPT-' + seller.organizationId;
      const buyerBalance = async () => (await pool.query(
        buyer === d2 ? 'SELECT balance FROM distributor_inventory WHERE organization_id=$1' : 'SELECT balance FROM internal_point_accounts WHERE organization_id=$1',
        [buyer.organizationId])).rows[0]?.balance ?? '0.0000';
      const buyerBefore = await buyerBalance();
      await page.getByLabel('唯一线下收款凭证').fill(receipt);
      await page.route('**/api/point-orders/confirm', async route => { expect((await route.fetch()).status()).toBe(201); await route.abort(); }, { times: 1 });
      await page.getByRole('button', { name: '登记足额收款', exact: true }).click();
      await expect(page.getByRole('button', { name: '重试原操作' })).toBeVisible();
      expect(await buyerBalance()).toBe(buyerBefore);
      const unknownCount = submissions.length;
      const reserved = (await pool.query('SELECT balance,reserved FROM distributor_inventory WHERE organization_id=$1', [seller.organizationId])).rows[0];
      expect(reserved.reserved).toBe(Number(quantity).toFixed(4));
      await link('交易与利润'); await expect(page.getByRole('region', { name: '分销交易与利润' })).toContainText('自有交易毛利：0.0000');
      await link('下级管理'); await link('下级账户'); await page.goBack(); await page.goForward();
      await link('点数订单'); await expect(page.getByLabel('唯一线下收款凭证')).toHaveValue(receipt);
      expect(submissions).toHaveLength(unknownCount);
      expect(await buyerBalance()).toBe(buyerBefore);
      await page.getByRole('button', { name: '重试原操作' }).click();
      await expect(page.getByRole('button', { name: '完整划拨', exact: true })).toBeVisible();
      expect(submissions.at(-1)).toEqual(submissions.at(-2));
      // Stop the direct buyer between receipt and transfer, preserving the reservation.
      await post(sellerApi, 'organizations/state', { organizationId: buyer.organizationId, active: false });
      await page.getByRole('button', { name: '刷新订单', exact: true }).click();
      await expect(page.getByRole('button', { name: '完整划拨', exact: true })).toBeDisabled();
      await post(sellerApi, 'point-orders/transfer', { requestId: randomUUID(), orderId }, 409);
      expect((await pool.query('SELECT balance,reserved FROM distributor_inventory WHERE organization_id=$1', [seller.organizationId])).rows[0]).toEqual(reserved);
      await post(sellerApi, 'organizations/state', { organizationId: buyer.organizationId, active: true });
      await page.getByRole('button', { name: '刷新订单', exact: true }).click();
      await page.getByRole('button', { name: '完整划拨', exact: true }).click();
      await expect(page.getByRole('heading', { name: buyer.name + ' · 已划拨' })).toBeVisible();
      expect(await buyerBalance()).toBe((Number(buyerBefore) + Number(quantity)).toFixed(4));
      await link('交易与利润'); await expect(page.getByRole('region', { name: '分销交易与利润' })).toContainText('自有交易毛利：' + gross);
      const report = await (await page.request.get(origin + '/api/reports')).json();
      expect(report.sales.map((s: any) => s.orderId)).toEqual([orderId]); expect(report.grossProfit).toBe(gross);
      expect(report.transactions.map((s: any) => s.id)).toEqual([orderId]);
      const downloadPromise = page.waitForEvent('download'); await link('导出自有账务'); const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('own-ledger.csv');
      const csv = readFileSync((await download.path())!, 'utf8'); expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('"sale","' + orderId + '","transferred"');
      expect(csv).not.toContain(funding); for (const prior of orders.filter(id => id !== orderId)) expect(csv).not.toContain(prior);
      const ownReference = references[seller === d1 ? 0 : 1];
      expect(csv).toContain(ownReference); for (const ref of references.filter(ref => ref !== ownReference)) expect(csv).not.toContain(ref);
      expect(csv).not.toContain('PRIVATE-INTEGRATION-QUERY');
      const ledger = (await pool.query('SELECT page_id,event,amount,balance_after,frozen_after,created_at FROM product_search_ledger WHERE organization_id=$1', [seller.organizationId])).rows;
      const sales = (await pool.query('SELECT order_id,sales_amount,sales_cost,gross_profit,created_at FROM point_transfers WHERE seller_id=$1 ORDER BY created_at', [seller.organizationId])).rows;
      const csvRows = [['type','reference','event','amount','balance_or_cost','frozen_or_gross','created_at'],
        ...ledger.map(r => ['product',r.page_id,r.event,r.amount,r.balance_after,r.frozen_after,r.created_at]),
        ...sales.map(r => ['sale',r.order_id,'transferred',r.sales_amount,r.sales_cost,r.gross_profit,r.created_at])];
      const expectedCsv = '\ufeff' + csvRows.map(row => row.map(v => '"' + String(v).replaceAll('"','""') + '"').join(',')).join('\r\n') + '\r\n';
      expect(csv).toBe(expectedCsv);
      evidence[seller.organizationId] = { orderId, reserved, buyerBefore, buyerAfter: await buyerBalance(), report, csv };
      await page.getByRole('button', { name: seller.email + ' 的账号菜单', exact: true }).click();
      await page.getByRole('menuitem', { name: '账号设置', exact: true }).click();
      await page.getByRole('button', { name: '返回工作台', exact: true }).click(); await expect(page).toHaveURL(origin + '/distribution/profit');
      await link('下级管理'); await page.getByRole('button', { name: '刷新列表', exact: true }).click(); await link('下级账户');
      await expect(page.locator('.account-row')).toHaveCount(seller === d1 ? 2 : 1);
      await page.reload(); await expect(page.getByLabel('面包屑', { exact: true }).locator('[aria-current="page"]')).toHaveText('下级账户');
      await logout(seller.email);
    }
    expect((await pool.query('SELECT balance,query_frozen,sales_reserved FROM internal_point_accounts WHERE organization_id=$1', [leaf.organizationId])).rows[0]).toEqual({ balance: '15.1234', query_frozen: '1.0001', sales_reserved: '2.0002' });
    await login(d1.email); await link('下级账户');
    const row = page.locator('.account-row').filter({ hasText: leaf.name });
    for (const value of ['15.1234','1.0001','2.0002','12.1231']) await expect(row.getByText(value, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: d1.email + ' 的账号菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '账号设置', exact: true }).click();
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page).toHaveURL(origin + '/distribution/organizations?view=accounts');
    // Change average inventory cost through real parent procurement and trade; historical profit stays fixed.
    await post(root, 'procurement/purchases', { requestId: randomUUID(), purpose: 'sale', upstreamPoints: '20', amount: '200', receiptReference: 'INTEGRATION-COST-CHANGE', evidence: 'controlled fixture' });
    const topup = (await (await post(root, 'point-orders', { requestId: randomUUID(), buyerId: d1.organizationId, quantity: '5', unitPrice: '12' })).json()).orderId;
    await post(root, 'point-orders/confirm', { requestId: randomUUID(), orderId: topup, receiptReference: 'INTEGRATION-COST-TOPUP' });
    await post(root, 'point-orders/transfer', { requestId: randomUUID(), orderId: topup });
    expect((await pool.query('SELECT balance,reserved,average_cost FROM distributor_inventory WHERE organization_id=$1', [d1.organizationId])).rows[0]).toEqual({ balance:'15.0000',reserved:'0.0000',average_cost:'5.3333' });
    expect((await pool.query('SELECT balance,reserved,average_cost FROM distributor_inventory WHERE organization_id=$1', [d2.organizationId])).rows[0]).toEqual({ balance:'6.0000',reserved:'0.0000',average_cost:'3.0000' });
    await link('交易与利润'); await expect(page.getByRole('region', { name: '分销交易与利润' })).toContainText('自有交易毛利：10.0000');
    expect((await pool.query('SELECT sales_cost,gross_profit FROM point_transfers WHERE order_id=$1', [orders[0]])).rows[0]).toEqual({ sales_cost:'20.0000',gross_profit:'10.0000' });
    const finalCsv = await (await a1.get('/api/reports/own-ledger.csv')).text();
    expect(finalCsv).toContain('"20.0000","10.0000"'); expect(finalCsv).not.toContain(topup); expect(finalCsv).not.toContain(orders[1]);
    evidence.afterCostChange = { topup, csv: finalCsv };
    async function businessSnapshot() {
      const snapshot: Record<string, unknown> = {};
      for (const table of ['internal_point_accounts','distributor_inventory','platform_inventory','point_orders','point_transfers','point_order_ledger','point_order_requests','point_order_refunds','product_search_ledger','query_point_ledger','company_contact_point_ledger','email_daily_usage','email_batches','email_recipients']) {
        snapshot[table] = (await pool.query(`SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY row_to_json(t)::text),'[]') AS data FROM ${table} t`)).rows[0].data;
      }
      return snapshot;
    }
    const beforeReadOnlyNavigation = await businessSnapshot();
    await post(a1, 'point-orders', { requestId: randomUUID(), buyerId: leaf.organizationId, quantity: '1', unitPrice: '5' }, 403);
    await post(await client(d2.email), 'point-orders/transfer', { requestId: randomUUID(), orderId: orders[0] }, 403);
    await post(other, 'organizations/state', { organizationId: leaf.organizationId, active: false }, 403);
    expect((await a1.get('/api/company-profiles')).status()).toBe(403);
    await logout(d1.email); await login(sibling.email); await link('交易与利润');
    await expect(page.getByRole('region', { name: '分销交易与利润' })).toContainText('自有交易毛利：0.0000');
    for (const order of orders) await expect(page.getByText(order, { exact: true })).toHaveCount(0);
    await logout(sibling.email); await login(leaf.email); await page.goto(origin + '/distribution/profit');
    await expect(page).toHaveURL(origin + '/terminal/search'); await expect(page.locator('.distribution-profit')).toHaveCount(0);
    expect((await (await client(leaf.email)).get('/api/reports/own-ledger.csv')).status()).toBe(403);
    const usage = (await pool.query('SELECT reserved,used FROM email_daily_usage WHERE organization_id=$1', [leaf.organizationId])).rows;
    expect(usage).toEqual([{ reserved: 2, used: 7 }]); expect(calls).toEqual({ list: 0, detail: 0, contacts: 0 }); expect(errors).toEqual([]);
    expect(await businessSnapshot()).toEqual(beforeReadOnlyNavigation);
    evidence.readOnlyNavigationBusinessSnapshotUnchanged = true;
    expect((await pool.query('SELECT count(*)::int AS n FROM point_transfers')).rows[0].n).toBe(4);
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger')).rows[0].n).toBe(4);
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_refunds')).rows[0].n).toBe(0);
    evidence.final = {
      submissions, calls, errors, usage,
      distributorInventory: (await pool.query('SELECT * FROM distributor_inventory ORDER BY organization_id')).rows,
      accounts: (await pool.query('SELECT * FROM internal_point_accounts ORDER BY organization_id')).rows,
      transfers: (await pool.query('SELECT * FROM point_transfers ORDER BY created_at')).rows,
      reservations: (await pool.query('SELECT * FROM point_order_ledger ORDER BY id')).rows,
      queryLedger: (await pool.query('SELECT id,page_id,organization_id,event,amount FROM product_search_ledger ORDER BY id')).rows,
      businessCounts: (await pool.query('SELECT (SELECT count(*)::int FROM email_batches) AS batches,(SELECT count(*)::int FROM email_recipients) AS recipients,(SELECT count(*)::int FROM query_point_ledger) AS detail,(SELECT count(*)::int FROM company_contact_point_ledger) AS contacts')).rows,
      requests: (await pool.query('SELECT operation,payload,result FROM point_order_requests ORDER BY request_id')).rows
    };
    evidence.sourceHashes = Object.fromEntries(['web/App.vue','web/router/index.ts','web/layout/ConsoleBreadcrumb.vue','web/pages/commerce/PointOrders.vue','web/pages/organizations/DistributionOrganizationsPage.vue','web/pages/reports/DistributionProfitPage.vue'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
    writeFileSync(run + '/evidence.json', JSON.stringify(evidence, null, 2));
  } finally { for (const api of clients) await api.dispose(); await app.close(); await pool.end(); }
});
