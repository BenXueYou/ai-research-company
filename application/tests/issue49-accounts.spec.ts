import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApplication } from '../server/app.js';
import { migrate } from '../server/database.js';
import { testDatabase } from './helpers.js';

test('issue49 real account scope and lifecycle', async ({ page, browser, playwright }) => {
  test.setTimeout(120000);
  const { pool } = await testDatabase();
  await migrate(pool);
  const port = Number(process.env.ISSUE49_PORT ?? 3591);
  const origin = 'http://127.0.0.1:' + port;
  let externalCalls = 0;
  const supplier = { listCompanies: async () => { externalCalls++; throw new Error('Unexpected external query'); } };
  const app = await createApplication(pool, origin, false, undefined, supplier, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('.scratch/issue49/web'));
  await app.listen(port, '127.0.0.1');
  const contexts: APIRequestContext[] = [];
  const password = 'Issue49VerifiedPwd123!';
  async function client(email: string, secret: string) {
    const api = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    contexts.push(api);
    expect((await api.post('/api/auth/login', { data: { email, password: secret } })).status()).toBe(200);
    return api;
  }
  async function post(api: APIRequestContext, path: string, data: object) {
    const csrf = (await api.storageState()).cookies.find(c => c.name === 'identity_csrf')!.value;
    return api.post('/api/'+path, { data, headers: { 'X-CSRF-Token': csrf } });
  }
  async function activate(email: string, secret: string) {
    const api = await client(email, secret);
    expect((await post(api, 'auth/password', { currentPassword: secret, newPassword: password, confirmPassword: password })).status()).toBe(200);
    return client(email, password);
  }
  let serial = 0;
  async function open(api: APIRequestContext, kind: string) {
    serial++;
    const response = await post(api, 'organizations', { name: 'issue49-'+serial, kind, countryCode: '+86', phone: '1394900'+String(serial).padStart(4,'0'), email: 'issue49-'+serial+'@example.com', requestId: randomUUID() });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const reads: string[] = []; const writes: string[] = [];
  page.on('request', r => { if (r.method() === 'GET' && /\/api\/(reports|organizations)$/.test(r.url())) reads.push(new URL(r.url()).pathname); if (r.method() === 'POST') writes.push(new URL(r.url()).pathname); });
  try {
    const root = await activate('super_admin', 'init@Base123');
    const a = await open(root, 'distributor'); const aa = await activate(a.email, a.temporaryPassword);
    const b = await open(root, 'distributor'); const ba = await activate(b.email, b.temporaryPassword);
    const a2 = await open(aa, 'distributor'); const a2a = await activate(a2.email, a2.temporaryPassword);
    const missing = await open(aa, 'terminal'); const leaf = await open(a2a, 'terminal'); const bl = await open(ba, 'terminal');
    const values = [[a2.organizationId,'222.2345','22.0002','4.0003'],[leaf.organizationId,'333.3456','33.0003','5.0004'],[bl.organizationId,'987.6543','0.1234','0.0001']];
    for (const v of values) await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,$2,$3,$4)',v);
    await pool.query('UPDATE organizations SET active=false WHERE id=$1',[leaf.organizationId]);
    const before = (await pool.query('SELECT * FROM internal_point_accounts ORDER BY organization_id')).rows;
    for (const [api, ids] of [[aa,[a.organizationId,a2.organizationId,missing.organizationId,leaf.organizationId]],[a2a,[a2.organizationId,leaf.organizationId]],[ba,[b.organizationId,bl.organizationId]]] as const) {
      const report = await (await api.get('/api/reports')).json();
      expect(report.organizations.map((o: any) => o.id).sort()).toEqual([...ids].sort());
      expect(report.accounts.every((o: any) => ids.includes(o.organizationId))).toBe(true);
      for (const field of ['customers','emails','keywords','contacts']) expect(report[field]).toBeUndefined();
      const csvResponse = await api.get('/api/reports/own-ledger.csv'); expect(csvResponse.status()).toBe(200); const csv = await csvResponse.text(); expect(csv).not.toMatch(/subject|content|purchasingNeeds/i);
    }
    for (const target of [leaf,bl]) {
      expect(target.accountId).not.toBe(target.organizationId);
      for (const [path,body] of [['organizations/state',{organizationId:target.organizationId,active:true}],['password-resets',{accountId:target.accountId,requestId:randomUUID()}],['point-orders',{buyerId:target.organizationId,quantity:'1.0000',unitPrice:'1.1000',requestId:randomUUID()}]] as const) expect((await post(aa,path,body)).status()).toBe(403);
    }
    expect((await aa.get('/api/company-profiles')).status()).toBe(403);
    await page.context().addCookies((await aa.storageState()).cookies);
    await page.goto(origin+'/distribution/organizations');
    const direct = page.locator('.organization-row').filter({hasText:'issue49-3'});
    await expect(page.locator('.organization-row')).toHaveCount(2);
    for (const value of ['222.2345','22.0002','4.0003','196.2340']) await expect(direct.getByText(value,{exact:true})).toBeVisible();
    await expect(page.getByText('暂无点数账户数据')).toBeVisible();
    await page.getByRole('link',{name:'下级账户',exact:true}).click();
    const deep = page.locator('.account-row').filter({hasText:'issue49-5'});
    await expect(page.locator('.account-row')).toHaveCount(3);
    for (const value of ['333.3456','33.0003','5.0004','295.3449']) await expect(deep.getByText(value,{exact:true})).toBeVisible();
    await expect(deep).toContainText('停用'); await expect(deep).toContainText('第2层下级'); await expect(deep).toContainText('issue49-3');
    await expect(page.getByRole('button',{name:/重置|停用组织|恢复组织/})).toHaveCount(0);
    await expect(page.getByLabel('面包屑',{exact:true}).locator('[aria-current="page"]')).toHaveText('下级账户');
    expect(reads.sort()).toEqual(['/api/organizations','/api/reports']);
    await page.getByRole('link',{name:'帮助中心',exact:true}).click(); await page.goBack(); await page.goForward(); await page.goBack();
    await expect(deep.getByText('295.3449',{exact:true})).toBeVisible(); expect(reads).toHaveLength(2);
    await page.reload(); await expect(deep.getByText('295.3449',{exact:true})).toBeVisible(); expect(reads).toHaveLength(4);
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    await page.route('**/api/reports',async route => { await gate; await route.continue(); });
    await page.getByRole('button',{name:'刷新账户'}).click(); await expect(page.getByText('账户读取中…',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'刷新账户'})).toBeDisabled(); await expect(page.locator('.account-row')).toHaveCount(0);
    release(); await expect(deep.getByText('295.3449',{exact:true})).toBeVisible(); await page.unroute('**/api/reports');
    await page.route('**/api/reports',async route => { const response = await route.fetch(); const data = await response.json(); const account = data.accounts.find((o: any) => o.organizationId === a2.organizationId); account.balance = null; delete account.available; await route.fulfill({response,json:data}); });
    await page.getByRole('button',{name:'刷新账户'}).click(); await expect(page.getByText('数据缺失',{exact:true})).toHaveCount(2); await page.unroute('**/api/reports');
    await page.route('**/api/reports',route => route.fulfill({status:503,json:{message:'controlled failure'}}));
    await page.getByRole('button',{name:'刷新账户'}).click(); await expect(page.getByText('下级账户读取失败，请刷新重试。')).toBeVisible(); await expect(page.getByText('295.3449',{exact:true})).toHaveCount(0);
    await page.getByRole('navigation',{name:'下级管理页面',exact:true}).getByRole('link',{name:'直属下级',exact:true}).click(); await expect(page.getByText('点数读取失败，请刷新重试。')).toHaveCount(2);
    await page.unroute('**/api/reports'); await page.getByRole('button',{name:'刷新列表'}).click(); await expect(direct.getByText('196.2340',{exact:true})).toBeVisible();
    await page.getByRole('link',{name:'下级账户',exact:true}).click(); await page.screenshot({path:'.scratch/issue49/accounts-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844}); await page.screenshot({path:'.scratch/issue49/accounts-mobile.png',fullPage:true}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
    let lateRelease!: () => void; const lateGate = new Promise<void>(r => { lateRelease = r; });
    let held = false;
    await page.route('**/api/reports',async route => { if (held) return route.continue(); held = true; const response = await route.fetch(); await lateGate; await route.fulfill({response}); });
    await page.getByRole('button',{name:'刷新账户'}).click();
    await page.getByRole('button',{name:'的账号菜单',exact:false}).click(); await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();
    await expect(page.getByLabel('登录账号',{exact:true})).toBeVisible(); 
    await page.getByLabel('登录账号',{exact:true}).fill(b.email); await page.getByLabel('密码',{exact:true}).fill(password); await page.getByRole('button',{name:'登录',exact:true}).click();
    await expect(page).toHaveURL(origin+'/distribution/organizations'); await expect(page.getByText('987.5308',{exact:true})).toBeVisible(); await expect(page.getByText('196.2340',{exact:true})).toHaveCount(0);
    lateRelease(); await page.unrouteAll({behavior:'wait'});
    await expect(page.getByText('987.5308',{exact:true})).toBeVisible(); await expect(page.getByText('196.2340',{exact:true})).toHaveCount(0);
    const ctx = await browser.newContext(); await ctx.addCookies((await a2a.storageState()).cookies); const p = await ctx.newPage(); await p.goto(origin+'/distribution/organizations?view=accounts');
    await expect(p.locator('.account-row')).toHaveCount(1); await expect(p.getByText('295.3449',{exact:true})).toBeVisible();
    await p.goto(origin+'/distribution/organizations?id='+missing.organizationId); await expect(p.getByText('未找到直属下级，请返回列表核对。')).toBeVisible(); await ctx.close();
    expect((await pool.query('SELECT * FROM internal_point_accounts ORDER BY organization_id')).rows).toEqual(before);
    for (const table of ['organization_state_events','password_reset_requests','point_transfers','query_point_ledger','company_contact_point_ledger','product_search_ledger']) expect((await pool.query('SELECT count(*) FROM '+table)).rows[0].count).toBe('0');
    expect(externalCalls).toBe(0);
    writeFileSync('.scratch/issue49/account-evidence.json',JSON.stringify({values,identities:[a,a2,leaf,b,bl,missing].map(o => ({organizationId:o.organizationId,accountId:o.accountId})),reads,browserBusinessWrites:[],externalCalls,unchangedPointAccounts:true,checked:['three actor scope','cross-level branch denied','precision disabled missing','loading fields 503 recovery','history refresh','logout late response account switch','mobile overflow']},null,2));
  } finally { await Promise.all(contexts.map(c => c.dispose())); await app.close(); await pool.end(); }
});
