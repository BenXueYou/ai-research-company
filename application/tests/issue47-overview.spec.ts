import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { createServer } from 'vite';

test('Issue47 overview reads real snapshots, pending work and navigates without mutations', async ({ page }) => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const source = new URL(base);
  source.pathname = '/postgres';
  const admin = database(source.toString());
  const name = `issue47_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  source.pathname = `/${name}`;
  const pool = database(source.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:3247';
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const calls: string[] = [];
  const vendor = {
    listCompanies: async () => { calls.push('search'); throw new Error('Unexpected search'); },
    detail: async () => { calls.push('detail'); throw new Error('Unexpected detail'); },
    contacts: async () => { calls.push('contacts'); throw new Error('Unexpected contacts'); }
  };
  const upstream = {
    account: async () => { calls.push('account'); throw new Error('Unexpected account'); },
    usage: async () => ({ minute: 7, dataToday: 11, businessToday: 2 }),
    limits: () => ({ minute: 180, dataToday: 20000, businessToday: 40 })
  };
  try {
    await migrate(pool);
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const password = 'Issue47-test-password!';
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const distributor = randomUUID(); const terminal = randomUUID();
    for (const [id, kind] of [[distributor, 'distributor'], [terminal, 'terminal']]) {
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,$2,$3,$4,'fixture',$5,'***')`, [id, kind, platform.organization_id, kind === 'distributor' ? 1 : 0, randomUUID()]);
    }
    const accounts = [];
    for (const role of ['distributor', 'admin', 'sales']) {
      const account = { id: randomUUID(), role, email: `${role}@issue47.test`, organizationId: role === 'distributor' ? distributor : terminal };
      accounts.push(account);
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,$4,$5,false)`, [account.id, account.organizationId, account.email, hash, role]);
    }
    expect(new Set([platform.id, platform.organization_id, distributor, terminal, ...accounts.map(x => x.id)]).size).toBe(7);
    const tenantAccount = accounts[1].id;
    const searchId = randomUUID(); const candidate = randomUUID(); const profile = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'fixture','USA',1,20,1,'verified')`, [searchId, terminal, tenantAccount]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country)
      VALUES($1,$2,$3,'distinct-source','fixture','USA')`, [candidate, searchId, terminal]);
    const profileQuery = randomUUID();
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'profile fixture','USA',2,5,$5,'settled')`, [profileQuery, terminal, tenantAccount, candidate, randomUUID()]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'distinct-detail','fixture','USA','{}',$3)`, [profile, terminal, profileQuery]);
    for (const state of ['pending', 'settled', 'zero', 'failed', 'quoted']) {
      const suffix = state === 'pending' ? '' : state;
      const stateCandidate = randomUUID();
      await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country)
        VALUES($1,$2,$3,$4,'fixture','USA')`, [stateCandidate, searchId, terminal, `source-${state}`]);
      await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'fixture','USA',2,5,$5,$6)`, [randomUUID(), terminal, tenantAccount, stateCandidate, randomUUID(), state]);
      await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'fixture',ARRAY[$5],1,20,2,5,$6,$7)`, [randomUUID(), terminal, tenantAccount, profile, `tag${suffix}`, randomUUID(), state]);
      await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'USA','2026-01-01','2026-02-01',1,20,2,5,$5,$6)`, [randomUUID(), terminal, tenantAccount, `product${suffix}`, randomUUID(), state]);
    }
    await pool.query('UPDATE platform_inventory SET balance=1234.5,frozen=12,reserved=30,average_cost=2');
    for (const state of ['unpaid', 'reserved', 'transferred', 'refunded']) {
      await pool.query(`INSERT INTO point_orders(id,seller_id,buyer_id,quantity,unit_price,amount,status,created_by,receipt_reference,confirmed_by,confirmed_at)
        VALUES($1,$2,$3,10,3,30,$4,$5,$6,$7,$8)`, [randomUUID(), platform.organization_id, distributor, state, platform.id,
        state === 'unpaid' ? null : `receipt-${state}`, state === 'unpaid' ? null : platform.id, state === 'unpaid' ? null : new Date()]);
    }
    const open = async (accountClient: typeof upstream | undefined = upstream) => {
      app = await createApplication(pool, origin, false, undefined, vendor, undefined, vendor, accountClient, vendor,
        { buyerCountryFilterVerified: true, importerNames: async () => { calls.push('products'); throw new Error('Unexpected products'); } }, undefined, undefined, resolve('.scratch/issue47/web'));
      await app.listen(3247, '127.0.0.1');
    };
    const login = async (email = 'super_admin') => {
      await page.goto(origin);
      await page.getByLabel('登录账号', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${email} 的账号菜单`, exact: true })).toBeVisible();
    };
    const overview = page.getByRole('region', { name: '平台运营概览', exact: true });
    await open();
    expect((await page.request.get('/api/point-orders')).status()).toBe(401);
    await login();
    await expect(page).toHaveURL(`${origin}/platform/overview`);
    await expect(overview.getByText('库存余额：1234.5000 内部点')).toBeVisible();
    await expect(overview.getByText('尚无上游账户快照。')).toBeVisible();
    for (const label of ['企业详情', '联系人', '产品名单']) await expect(overview.getByText(`${label}待核对：1 次`)).toBeVisible();
    await expect(overview.getByText('已收款并预留：1 笔')).toBeVisible();
    await expect(overview.getByText('待收款：1 笔')).toBeVisible();
    const post = async (path: string, body: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('identity_csrf='))!.split('=')[1];
      const response = await fetch(`/api/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    }, { path, body });
    const created = await post('point-orders', { requestId: randomUUID(), buyerId: distributor, quantity: '2000', unitPrice: '3' });
    expect(created.status).toBe(201);
    const confirmation = { requestId: randomUUID(), orderId: created.body.orderId, receiptReference: 'issue47-shortage-receipt' };
    const confirmed = await post('point-orders/confirm', confirmation);
    expect(confirmed.status).toBe(201); expect(confirmed.body.status).toBe('awaiting_stock');
    expect((await post('point-orders/confirm', confirmation)).body).toEqual(confirmed.body);
    expect((await pool.query('SELECT shortage_receipt,status FROM point_orders WHERE id=$1', [created.body.orderId])).rows[0])
      .toEqual({ shortage_receipt: true, status: 'awaiting_stock' });
    await pool.query(`INSERT INTO upstream_account_snapshot(singleton,balance,expires_in,fetched_at)
      VALUES(true,'87.25','2027-01-31','2026-10-01T00:00:00Z')`);
    const tables = ['platform_inventory', 'distributor_inventory', 'internal_point_accounts', 'point_purchases', 'platform_expenses',
      'point_orders', 'point_order_requests', 'point_order_ledger', 'point_transfers', 'point_order_refunds',
      'query_point_ledger', 'company_contact_point_ledger', 'product_search_ledger', 'upstream_account_snapshot', 'upstream_monitor_events'];
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of tables) result[table] = (await pool.query(`SELECT * FROM ${table}`)).rows;
      return JSON.stringify(result);
    };
    const before = await snapshot();
    const writes: string[] = []; const reads: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/')) return;
      if (request.method() !== 'GET') writes.push(path);
      else reads.push(path);
    });
    await page.reload();
    await expect(overview.getByText('已收款待补库存：1 笔')).toBeVisible();
    await expect(page.locator('.console-breadcrumb')).toContainText('运营概览');
    await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '运营概览', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(overview.getByText('上游剩余点数：87.25 上游点')).toBeVisible();
    await expect(overview.getByText('上游有效期：2027-01-31')).toBeVisible();
    await expect(overview.getByText('快照获取时间：2026-10-01T00:00:00.000Z')).toBeVisible();
    const links = [
      ['直属开户', '/platform/organizations?view=new', '组织名称', '下级管理'],
      ['点数订单', '/platform/ledger', '直属点数订单', '点数订单'],
      ['平台采购', '/platform/ledger/procurement', '采购入账', '采购与费用'],
      ['异常对账', '/platform/reconciliation', '查询结果人工核对', '查询异常核对']
    ];
    for (const [label, path, content, active] of links) {
      await overview.getByRole('navigation', { name: '概览快捷入口' }).getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(`${origin}${path}`);
      await expect(page.getByText(content, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: active, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.console-breadcrumb')).toContainText(active === '下级管理' ? '开户' : active);
      await page.goBack(); await expect(overview).toBeVisible();
      await page.goForward(); await expect(page).toHaveURL(`${origin}${path}`);
      await page.goBack(); await expect(overview).toBeVisible();
    }
    await overview.getByRole('link', { name: '查看上游账号监控' }).click();
    await expect(page).toHaveURL(/\/platform\/reconciliation\/upstream$/);
    await page.goBack();
    await expect(overview).toBeVisible();
    await overview.getByRole('button', { name: '刷新概览' }).click();
    await expect(overview.getByText('上游剩余点数：87.25 上游点')).toBeVisible();
    expect(writes).toEqual([]); expect(calls).toEqual([]); expect(await snapshot()).toBe(before);
    let releaseRead: () => void = () => {};
    const delayedRead = new Promise<void>(resolve => { releaseRead = resolve; });
    await page.route('**/api/upstream-monitor', async route => {
      await delayedRead; await route.continue();
    });
    await page.reload();
    await expect(overview.getByText('正在读取快照…')).toBeVisible();
    await expect(overview.getByText('库存余额：1234.5000 内部点')).toBeVisible();
    releaseRead();
    await expect(overview.getByText('上游剩余点数：87.25 上游点')).toBeVisible();
    await page.unroute('**/api/upstream-monitor');
    await page.route('**/api/company-contacts/reconciliations', route => route.fulfill({ status: 503, json: { message: '受控读取失败' } }));
    await page.reload();
    await expect(overview.getByRole('alert')).toContainText('联系人读取失败');
    await expect(overview.getByText('联系人待核对：0 次')).toHaveCount(0);
    await expect(overview.getByText('企业详情待核对：1 次')).toBeVisible();
    const failedReads = reads.filter(x => x === '/api/company-contacts/reconciliations').length;
    await page.waitForTimeout(500);
    expect(reads.filter(x => x === '/api/company-contacts/reconciliations')).toHaveLength(failedReads);
    await page.unroute('**/api/company-contacts/reconciliations');
    await page.route('**/api/point-orders', route => route.fulfill({ status: 503, json: { message: '库存源失败' } }));
    await page.reload();
    await expect(overview.getByText('库存读取失败：库存源失败')).toBeVisible();
    await expect(overview.getByText('订单待办读取失败：库存源失败')).toBeVisible();
    await page.unroute('**/api/point-orders');
    await page.route('**/api/upstream-monitor', route => route.fulfill({ status: 503, json: { message: '快照源失败' } }));
    await page.reload(); await expect(overview.getByText('上游快照读取失败：快照源失败')).toBeVisible();
    await page.unroute('**/api/upstream-monitor');
    await page.route('**/api/point-orders', async route => {
      const response = await route.fetch(); const body = await response.json(); delete body.inventory;
      await route.fulfill({ response, json: body });
    });
    await page.reload(); await expect(overview.getByText('暂无平台库存数据。')).toBeVisible();
    await page.unroute('**/api/point-orders');
    await app!.close(); app = undefined;
    app = await createApplication(pool, origin, false, undefined, vendor, undefined, vendor, undefined, vendor,
      undefined, undefined, undefined, resolve('.scratch/issue47/web'));
    await app.listen(3247, '127.0.0.1');
    await page.reload(); await expect(overview.getByText('尚未配置腾道账号。')).toBeVisible();
    await expect(overview.getByText('上游剩余点数：87.25 上游点')).toBeVisible();
    await pool.query('DELETE FROM upstream_account_snapshot');
    await page.reload(); await expect(overview.getByText('尚无上游账户快照。')).toBeVisible();
    const endpoints = ['/api/upstream-monitor', '/api/company-details/reconciliations', '/api/company-contacts/reconciliations', '/api/product-searches/reconciliations'];
    const logout = async () => {
      await page.getByRole('button', { name: '的账号菜单' }).click();
      await page.getByRole('menuitem', { name: '退出登录' }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    };
    for (const account of accounts) {
      await logout();
      await login(account.email);
      await expect(page).toHaveURL(account.role === 'distributor' ? /\/distribution\/organizations$/ : /\/terminal\/search$/);
      await page.goto(`${origin}/platform/overview`);
      await expect(page).toHaveURL(account.role === 'distributor' ? /\/distribution\/organizations$/ : /\/terminal\/search$/);
      await expect(overview).toHaveCount(0);
      for (const endpoint of endpoints) expect((await page.request.get(endpoint)).status()).toBe(403);
      if (account.role !== 'distributor') expect((await page.request.get('/api/point-orders')).status()).toBe(403);
      await logout();
      await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '72 hours' WHERE id=$1", [account.id]);
      await login(account.email);
      await page.goto(`${origin}/platform/overview`);
      await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
      for (const endpoint of [...endpoints, '/api/point-orders']) expect((await page.request.get(endpoint)).status()).toBe(403);
      await pool.query('UPDATE accounts SET must_change=false WHERE id=$1', [account.id]);
    }
    await logout();
    await pool.query('UPDATE accounts SET must_change=true WHERE id=$1', [platform.id]);
    await login();
    await page.goto(`${origin}/platform/overview`);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect((await page.request.get('/api/point-orders')).status()).toBe(403);
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill('Issue47-changed-password!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue47-changed-password!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    expect((await page.request.get('/api/point-orders')).status()).toBe(401);
    devApp = await createApplication(pool, 'http://127.0.0.1:3248', false, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, resolve('.scratch/issue47/web'));
    await devApp.listen(3249, '127.0.0.1');
    vite = await createServer({ server: { host: '127.0.0.1', port: 3248, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3249' } } });
    await vite.listen();
    await page.goto('http://127.0.0.1:3248/platform/overview');
    await page.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await page.getByLabel('密码', { exact: true }).fill('Issue47-changed-password!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(overview).toBeVisible(); await page.reload(); await expect(overview).toBeVisible();
    for (const url of [origin, 'http://127.0.0.1:3248']) {
      expect((await page.request.get(`${url}/api/unknown`)).headers()['content-type']).not.toContain('text/html');
      expect((await page.request.get(`${url}/missing-issue47.js`)).status()).toBe(404);
    }
    expect(calls).toEqual([]);
    await writeFile(resolve('../docs/delivery/application/ISSUE-47-EVIDENCE.json'), JSON.stringify({
      database: name, environment: 'isolated PostgreSQL / Nest / Chromium / Vite',
      snapshots: { inventory: '1234.5000 internal', upstream: '87.25 upstream', fetchedAt: '2026-10-01T00:00:00.000Z' },
      pendingQueries: { details: 1, contacts: 1, products: 1 }, navigationBusinessWrites: 0, supplierCalls: calls.length,
      unchangedBusinessTables: tables, roles: ['platform', ...accounts.map(x => x.role)],
      missingAndFailureStates: true, nestAndViteHistory: true, forcedPasswordChange: true,
      orderFinalStatusAcceptance: { awaiting_stock: 1, reserved: 1, unpaid: 1, transferredExcluded: true, refundedExcluded: true,
        source: 'real create/confirm with insufficient inventory; same request replay returns same result' }
    }, null, 2));
  } finally {
    await vite?.close(); await devApp?.close(); await app?.close(); await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
});
