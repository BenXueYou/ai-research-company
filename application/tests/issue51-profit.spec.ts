import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';

test('Issue51 real scoped reporting, CSV SQL reconciliation, navigation and session isolation', async ({ page }) => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const url = new URL(base); url.pathname = '/postgres';
  const admin = database(url.toString());
  const dbName = `issue51_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  url.pathname = `/${dbName}`;
  const pool = database(url.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:3351';
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: typeof app;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const supplierCalls: string[] = [];
  const unexpected = async () => { supplierCalls.push('unexpected'); throw new Error('Unexpected supplier call'); };
  const vendor = { listCompanies: unexpected, detail: unexpected, contacts: unexpected };
  const password = 'Issue51-Fixture-Password!';
  const evidence: Record<string, unknown> = { database: dbName, origin };
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  try {
    await migrate(pool);
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const d1 = randomUUID(), d2 = randomUUID(), a = randomUUID(), b = randomUUID(), sibling = randomUUID(), outside = randomUUID();
    for (const [id, name, kind, parent, level] of [
      [d1, '一级分销51', 'distributor', platform.organization_id, 1],
      [d2, '二级分销51', 'distributor', d1, 2],
      [a, '二级直属企业51', 'terminal', d2, 0],
      [b, '一级直属企业51', 'terminal', d1, 0],
      [sibling, '旁支分销51', 'distributor', platform.organization_id, 1],
      [outside, '旁支企业51', 'terminal', sibling, 0]
    ]) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [id, name, kind, parent, level, randomUUID()]);
    const actors = [
      { id: randomUUID(), org: d1, role: 'distributor', email: 'd1@issue51.test' },
      { id: randomUUID(), org: d2, role: 'distributor', email: 'd2@issue51.test' },
      { id: randomUUID(), org: a, role: 'admin', email: 'admin@issue51.test' },
      { id: randomUUID(), org: a, role: 'sales', email: 'sales@issue51.test' },
      { id: randomUUID(), org: sibling, role: 'distributor', email: 'sibling@issue51.test' }
    ];
    for (const actor of actors) await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [actor.id, actor.org, actor.email, hash, actor.role]);
    for (const [index, org] of [d1, d2, a, b, sibling, outside].entries()) await pool.query(
      'INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,$2,2,3)', [org, 100 + index]);
    const orders: Array<{ id: string; seller: string; buyer: string; amount: number; cost: number }> = [];
    for (const [seller, buyer, actor, amount, cost] of [
      [platform.organization_id, d1, platform.id, 11, 8], [d1, d2, actors[0].id, 17, 12],
      [d1, b, actors[0].id, 19, 13], [d2, a, actors[1].id, 23, 15], [sibling, outside, actors[4].id, 29, 16]
    ] as const) {
      const id = randomUUID(); orders.push({ id, seller, buyer, amount, cost });
      await pool.query(`INSERT INTO point_orders(id,seller_id,buyer_id,quantity,unit_price,amount,status,receipt_reference,created_by,confirmed_by,confirmed_at)
        VALUES($1,$2,$3,1,$4,$4,'transferred',$5,$6,$6,clock_timestamp())`, [id, seller, buyer, amount, randomUUID(), actor]);
      await pool.query(`INSERT INTO point_transfers(order_id,seller_id,buyer_id,actor_id,quantity,seller_balance_after,seller_reserved_after,buyer_balance_after,sales_unit_cost,sales_cost,sales_amount,gross_profit)
        VALUES($1,$2,$3,$4,1,90,0,101,$5,$5,$6,$6::numeric-$5::numeric)`, [id, seller, buyer, actor, cost, amount]);
    }
    const references: string[] = [];
    // Different query, profile, upstream, actor, order and organization identifiers.
    for (const actor of [actors[0], actors[1], actors[2], actors[4]]) {
      const product = randomUUID(); references.push(product);
      await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,'私有查询词51','USA','2026-01-01','2026-02-01',1,20,1,4,$4,'settled')`, [product, actor.org, actor.id, randomUUID()]);
      await pool.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',4,96,0)`, [product, actor.org, actor.id]);
      await pool.query('INSERT INTO email_daily_usage(organization_id,usage_day,reserved,used) VALUES($1,\'2026-10-28\',2,7)', [actor.org]);
    }
    // A settled detail/profile fixture containing fields that must never enter distributor responses or CSV.
    const search = randomUUID(), candidate = randomUUID(), query = randomUUID(), profile = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'私有客户51','USA',1,20,1,'verified')`, [search, a, actors[2].id]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country)
      VALUES($1,$2,$3,'list51','私有客户51','USA')`, [candidate, search, a]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'私有客户51','USA',1,2,$5,'settled')`, [query, a, actors[2].id, candidate, randomUUID()]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'upstream51','私有客户51','USA','{"id":"upstream51","fileId":"different51","email":"private@issue51.test","content":"私有邮件51"}',$3)`, [profile, a, query]);
    const ownReferences: Record<string, string[]> = {};
    for (const actor of actors.slice(0, 2)) {
      const s = randomUUID(), c = randomUUID(), q = randomUUID(), p = randomUUID(), contact = randomUUID();
      ownReferences[actor.org] = [s, c, q, p, contact];
      await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
        VALUES($1,$2,$3,'私有查询51','USA',1,20,1,'verified')`, [s, actor.org, actor.id]);
      await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country)
        VALUES($1,$2,$3,$4,'私有客户51','USA')`, [c, s, actor.org, `list-${actor.org}`]);
      await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'私有客户51','USA',1,2,$5,'settled')`, [q, actor.org, actor.id, c, randomUUID()]);
      await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
        VALUES($1,$2,$3,'私有客户51','USA','{}',$4)`, [p, actor.org, `upstream-${actor.org}`, q]);
      await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'私有客户51',ARRAY['buyer'],1,20,1,3,$5,'settled')`, [contact, actor.org, actor.id, p, randomUUID()]);
      await pool.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',2,98,0)`, [q, actor.org, actor.id]);
      await pool.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',3,95,0)`, [contact, actor.org, actor.id]);
    }
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [b]);
    app = await createApplication(pool, origin, false, undefined, vendor, undefined, vendor, undefined, vendor,
      { buyerCountryFilterVerified: true, importerNames: unexpected }, undefined, undefined, resolve('.scratch/issue51/web'));
    await app.listen(3351, '127.0.0.1');
    const login = async (email: string, root = origin, pwd = password) => {
      if (!page.url().startsWith(root) || !await page.getByRole('button', { name: '登录', exact: true }).isVisible()) await page.goto(`${root}/distribution/profit`);
      await expect(page.getByLabel('登录账号', { exact: true }), `Login UI; browser errors: ${browserErrors.join('; ')}`).toBeVisible();
      await page.getByLabel('登录账号', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(pwd);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${email} 的账号菜单`, exact: true })).toBeVisible();
    };
    const logout = async (email: string) => {
      await page.getByRole('button', { name: `${email} 的账号菜单`, exact: true }).click();
      await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    };
    const region = page.getByRole('region', { name: '分销交易与利润' });
    const read = async (path = 'reports') => page.request.get(`${origin}/api/${path}`);
    expect((await read()).status()).toBe(401); expect((await read('reports/own-ledger.csv')).status()).toBe(401);
    const businessTables = ['internal_point_accounts', 'platform_inventory', 'distributor_inventory', 'point_orders', 'point_transfers', 'point_order_requests', 'point_order_ledger', 'point_order_refunds',
      'product_search_pages', 'product_search_ledger', 'query_point_ledger', 'company_contact_point_ledger', 'procurement_ledger', 'platform_expenses', 'email_daily_usage', 'email_batches', 'email_recipients'];
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of businessTables) result[table] = (await pool.query(`SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY row_to_json(t)::text),'[]') AS rows FROM ${table} t`)).rows[0].rows;
      return result;
    };
    const before = await snapshot();
    await login(actors[0].email);
    await page.getByRole('link', { name: '交易与利润', exact: true }).click();
    await expect(region).toContainText('自有交易毛利：11.0000');
    await expect(page.locator('.sidebar-link[aria-current="page"]')).toHaveText('交易与利润');
    await expect(page.locator('.console-breadcrumb [aria-current="page"]')).toHaveText('交易与利润');
    await expect(page.locator('.usage-reports')).toHaveCount(0);
    const reads: string[] = [], writes: string[] = [];
    page.on('request', request => { const u = new URL(request.url()); if (u.pathname === '/api/reports') reads.push(`${request.method()} ${u.search}`); if (u.pathname.startsWith('/api/') && request.method() !== 'GET' && !u.pathname.startsWith('/api/auth/')) writes.push(u.pathname); });
    const report1 = await (await read()).json();
    expect(report1.organizations.map((r: { id: string }) => r.id).sort()).toEqual([d1, d2, a, b].sort());
    expect(report1.organizations.find((r: { id: string }) => r.id === b).active).toBe(false);
    expect(report1.transactions.map((r: { id: string }) => r.id).sort()).toEqual(orders.filter(o => o.seller === d1).map(o => o.id).sort());
    expect(report1.grossProfit).toBe('11.0000'); expect(report1.sales).toHaveLength(2);
    expect(report1.ledger).toHaveLength(3); expect(report1.ledger.find((r: { source: string }) => r.source === 'product').referenceId).toBe(references[0]);
    expect(report1.ledger.find((r: { source: string }) => r.source === 'detail').referenceId).toBe(ownReferences[d1][2]);
    expect(report1.ledger.find((r: { source: string }) => r.source === 'contact').referenceId).toBe(ownReferences[d1][4]);
    expect([...new Set(report1.usage.map((r: { organizationId: string }) => r.organizationId))].sort()).toEqual([d1, d2, a].sort());
    expect(JSON.stringify(report1)).not.toMatch(/私有|private@|customers|emails|upstream51|different51/);
    await expect(region).toContainText('一级直属企业51 · terminal · 停用');
    for (const order of orders.filter(o => o.seller === d1)) {
      await expect(region).toContainText(order.id); await expect(region).toContainText(`${order.cost}.0000`);
    }
    await expect(region).not.toContainText(orders[3].id); await expect(region).not.toContainText('旁支');
    expect(await (await read(`reports?organizationId=${sibling}`)).json()).toEqual(report1);
    const reconcileCsv = async (org: string) => {
      const downloadPromise = page.waitForEvent('download'); await region.getByRole('link', { name: '导出自有账务' }).click();
      const download = await downloadPromise; expect(download.suggestedFilename()).toBe('own-ledger.csv');
      const bytes = await readFile((await download.path())!); expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
      const csv = bytes.toString('utf8').replace(/^\uFEFF/, ''); expect(csv).toBe((await (await read('reports/own-ledger.csv')).text()).replace(/^\uFEFF/, ''));
      const actual = csv.trimEnd().split('\r\n').map(line => line.slice(1, -1).split('\",\"').map(v => v.replaceAll('\"\"', '\"')));
      const ownLedger = (await pool.query(`SELECT 'detail' AS source,query_id AS reference,event,amount,balance_after AS balance,frozen_after AS frozen,created_at FROM query_point_ledger WHERE organization_id=$1
        UNION ALL SELECT 'contact',query_id,event,amount,balance_after,frozen_after,created_at FROM company_contact_point_ledger WHERE organization_id=$1
        UNION ALL SELECT 'product',page_id,event,amount,balance_after,frozen_after,created_at FROM product_search_ledger WHERE organization_id=$1 ORDER BY created_at,source`, [org])).rows;
      const ownSales = (await pool.query('SELECT * FROM point_transfers WHERE seller_id=$1 ORDER BY created_at,order_id', [org])).rows;
      const expected = [['type', 'reference', 'event', 'amount', 'balance_or_cost', 'frozen_or_gross', 'created_at'],
        ...ownLedger.map(r => [r.source, r.reference, r.event, r.amount, r.balance, r.frozen, String(r.created_at)]),
        ...ownSales.map(r => ['sale', r.order_id, 'transferred', r.sales_amount, r.sales_cost, r.gross_profit, String(r.created_at)])];
      expect(actual).toEqual(expected); expect(csv).not.toMatch(/私有|private@|upstream51|different51/); return actual;
    };
    const csv1 = await reconcileCsv(d1);
    await page.screenshot({ path: resolve('.scratch/issue51/profit-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve('.scratch/issue51/profit-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload(); await expect(region).toContainText('自有交易毛利：11.0000');
    await page.getByRole('link', { name: '帮助中心', exact: true }).click(); await expect(region).toHaveCount(0);
    await page.goBack(); await expect(region).toContainText('自有交易毛利：11.0000');
    await page.goForward(); await expect(region).toHaveCount(0); await page.goBack(); await expect(region).toBeVisible();
    const beforeQuery = reads.length; await page.goto(`${origin}/distribution/profit?organizationId=${sibling}`); await expect(region).toContainText('自有交易毛利：11.0000');
    expect(reads.length).toBeGreaterThan(beforeQuery); expect(reads.every(r => r === 'GET ')).toBe(true);
    const sameComponentReads = reads.length;
    await page.getByRole('link', { name: '交易与利润', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/distribution/profit`);
    expect(reads.length).toBe(sameComponentReads);
    await page.getByRole('button', { name: `${actors[0].email} 的账号菜单`, exact: true }).click();
    await page.getByRole('menuitem', { name: '账号设置', exact: true }).click();
    await expect(region).toHaveCount(0);
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(region).toContainText('11.0000');
    expect(reads.length).toBe(sameComponentReads + 1);
    await pool.query('ALTER TABLE point_transfers RENAME TO issue51_unavailable_transfers');
    await region.getByRole('button', { name: '刷新报表' }).click(); await expect(region.getByRole('alert')).toBeVisible();
    await expect(region).not.toContainText('11.0000'); await expect(region.locator('tbody tr')).toHaveCount(0);
    await pool.query('ALTER TABLE issue51_unavailable_transfers RENAME TO point_transfers');
    await region.getByRole('button', { name: '刷新报表' }).click(); await expect(region).toContainText('11.0000');
    await pool.query('DELETE FROM internal_point_accounts WHERE organization_id=$1', [d1]);
    await region.getByRole('button', { name: '刷新报表' }).click(); await expect(region.locator('.report-card').first()).not.toContainText('100.0000');
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,100,2,3)', [d1]);
    // Hold an actual response over logout and second-level login.
    let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/reports', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); }, { times: 1 });
    await region.getByRole('button', { name: '刷新报表' }).click(); await expect(region.getByRole('status')).toContainText('正在读取报表');
    await logout(actors[0].email); await login(actors[1].email); release();
    await page.goto(`${origin}/distribution/profit`); await expect(region).toContainText('自有交易毛利：8.0000'); await expect(region).not.toContainText(orders[1].id);
    const report2 = await (await read()).json(); expect(report2.organizations.map((r: { id: string }) => r.id).sort()).toEqual([d2, a].sort());
    expect(report2.transactions.map((r: { id: string }) => r.id)).toEqual([orders[3].id]); expect(report2.ledger.find((r: { source: string }) => r.source === 'product').referenceId).toBe(references[1]);
    expect(await (await read(`reports?organizationId=${d1}`)).json()).toEqual(report2);
    const csv2 = await reconcileCsv(d2);
    const cookies = await page.context().cookies(); const csrf = cookies.find(c => c.name === 'identity_csrf')!.value;
    const post = (path: string, data: Record<string, unknown>) => page.request.post(`${origin}/api/${path}`, { data, headers: { Origin: origin, 'X-CSRF-Token': csrf } });
    expect((await post('point-orders/transfer', { requestId: randomUUID(), orderId: orders[1].id })).status()).toBe(403);
    expect((await post('point-orders/transfer', { requestId: randomUUID(), orderId: orders[4].id })).status()).toBe(403);
    await logout(actors[1].email);
    for (const [email, role, target] of [['super_admin', 'platform', '/platform/overview'], [actors[2].email, 'admin', '/terminal/search'], [actors[3].email, 'sales', '/terminal/search']]) {
      await login(email); await page.goto(`${origin}/distribution/profit`); await expect(page).toHaveURL(`${origin}${target}`); await expect(region).toHaveCount(0);
      expect((await read()).status()).toBe(200); expect((await read('reports/own-ledger.csv')).status()).toBe(role === 'platform' ? 200 : 403); await logout(email);
    }
    await login(actors[4].email); await page.goto(`${origin}/distribution/profit`); await expect(region).toContainText('自有交易毛利：13.0000'); await expect(region).not.toContainText(orders[1].id);
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [sibling]); expect((await read()).status()).toBe(401);
    await pool.query('UPDATE organizations SET active=true WHERE id=$1', [sibling]); await logout(actors[4].email);
    await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [actors[0].id]);
    await login(actors[0].email); await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible(); await expect(region).toHaveCount(0);
    expect((await read()).status()).toBe(403); expect((await read('reports/own-ledger.csv')).status()).toBe(403);
    const oldCookie = (await page.context().cookies()).find(c => c.name === 'identity_session')!.value;
    await page.getByLabel('当前密码', { exact: true }).fill(password); await page.getByLabel('新密码', { exact: true }).fill('Changed-Issue51-password!'); await page.getByLabel('确认新密码', { exact: true }).fill('Changed-Issue51-password!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click(); await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    expect((await fetch(`${origin}/api/reports`, { headers: { Cookie: `identity_session=${oldCookie}` } })).status).toBe(401);
    devApp = await createApplication(pool, 'http://127.0.0.1:5351', false, undefined, vendor, undefined, vendor, undefined, vendor,
      { buyerCountryFilterVerified: true, importerNames: unexpected }, undefined, undefined, resolve('.scratch/issue51/web'));
    await devApp.listen(4351, '127.0.0.1');
    vite = await createServer({ server: { host: '127.0.0.1', port: 5351, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4351' } } }); await vite.listen();
    await login(actors[1].email, 'http://127.0.0.1:5351'); await page.goto('http://127.0.0.1:5351/distribution/profit'); await expect(region).toContainText('8.0000'); await page.reload(); await expect(region).toContainText('8.0000');
    for (const root of [origin, 'http://127.0.0.1:5351']) {
      expect((await page.request.get(`${root}/distribution/profit`)).status()).toBe(200);
      expect((await page.request.get(`${root}/issue51-unknown`)).status()).toBe(404);
      expect((await page.request.get(`${root}/issue51-missing.js`)).status()).toBe(404);
      expect((await page.request.get(`${root}/api/issue51-unknown`)).status()).toBe(404);
    }
    expect(supplierCalls).toEqual([]); expect(await snapshot()).toEqual(before);
    // APIRequestContext's deliberate denial probes do not emit page request events.
    expect(writes).toEqual([]);
    Object.assign(evidence, { identifiers: { d1, d2, a, b, sibling, outside, orders, references, ownReferences, search, candidate, query, profile }, report1, report2, csv1, csv2,
      readRequests: reads, pageBusinessWrites: writes, deliberateDeniedTransfers: [orders[1].id, orders[4].id], supplierCalls, unchangedBusinessTables: businessTables,
      databaseFailureClearsData: true, missingAccountNotZero: true, lateResponseAcrossSession: true, nestAndViteHistory: true, forcedPasswordAndOldCookieInvalid: true });
    await writeFile(resolve('../docs/delivery/application/ISSUE-51-EVIDENCE.json'), JSON.stringify(evidence, null, 2));
  } finally {
    await vite?.close(); await devApp?.close(); await app?.close(); await pool.end();
    await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`); await admin.end();
  }
});
