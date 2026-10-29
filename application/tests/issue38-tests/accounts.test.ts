import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { createApplication } from '../../server/app.js';
import { migrate } from '../../server/database.js';
import { digest } from '../../server/identity/identity.js';

test('issue38 real accounts: association, hierarchy, missing/error, read-only and permissions', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL required as connection source only');
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const databaseName = `issue38_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + databaseName;
  const pool = new pg.Pool({ connectionString: url.toString() });
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const port = Number(process.env.ISSUE38_PORT ?? 3398);
  const origin = `http://127.0.0.1:${port}`;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await migrate(pool);
    const root = (await pool.query("SELECT id,organization_id FROM accounts WHERE role='platform'")).rows[0];
    await pool.query('UPDATE accounts SET must_change=false WHERE id=$1', [root.id]);
    const actors = [{ id: root.id, org: root.organization_id, token: 'issue38-platform', role: 'platform' }];
    const rows: { id: string; accountId: string; parent: string; name: string }[] = [];
    for (const [name, kind, parent, level, active, balance, frozen, reserved] of [
      ['Direct distribution', 'distributor', root.organization_id, 1, true, '111.1234', '11.0001', '3.0002'],
      ['Direct terminal missing', 'terminal', root.organization_id, 0, true, null, null, null],
      ['Second distribution', 'distributor', 'previous', 2, true, '222.2345', '22.0002', '4.0003'],
      ['Disabled deep terminal', 'terminal', 'previous', 0, false, '333.3456', '33.0003', '5.0004']
    ] as const) {
      const id = randomUUID();
      const accountId = randomUUID();
      const parentId = parent === 'previous' ? rows[name === 'Second distribution' ? 0 : 2].id : parent;
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,active,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,$3,$4,$5,$6,'encrypted',$7,'masked')`, [id, name, kind, parentId, level, active, id]);
      const role = kind === 'distributor' ? 'distributor' : 'admin';
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,'hash',$4,false)`, [accountId, id, `${accountId}@test.invalid`, role]);
      await pool.query('INSERT INTO organization_openings(actor_id,request_id,organization_id,account_id) VALUES($1,$2,$3,$4)',
        [root.id, randomUUID(), id, accountId]);
      if (balance !== null) await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,$2,$3,$4)', [id,balance,frozen,reserved]);
      rows.push({ id, accountId, parent: parentId, name });
      actors.push({ id: accountId, org: id, token: `issue38-${rows.length}`, role });
    }
    for (const actor of actors) await pool.query('INSERT INTO sessions(token_hash,account_id,csrf_hash) VALUES($1,$2,$3)', [digest(actor.token),actor.id,digest('csrf')]);
    const salesId = randomUUID();
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,'sales38@test.invalid','hash','sales',false)`, [salesId,rows[1].id]);
    await pool.query('INSERT INTO sessions(token_hash,account_id,csrf_hash) VALUES($1,$2,$3)', [digest('issue38-sales'),salesId,digest('csrf')]);
    app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, resolve(process.env.ISSUE38_WEB_DIR ?? '.scratch/issue38-web'));
    await app.listen(port, '127.0.0.1');
    const get = (path: string, token = actors[0].token) => fetch(`${origin}/api/${path}`, { headers: { Cookie: `identity_session=${token}` } });
    const post = (path: string, data: object, token = actors[0].token) => fetch(`${origin}/api/${path}`, {
      method: 'POST', headers: { Cookie: `identity_session=${token}`, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }, body: JSON.stringify(data)
    });
    const report = await (await get('reports')).json();
    assert.equal(report.accounts.find((a: any) => a.organizationId === rows[0].id).available, '97.1231');
    assert.equal(report.accounts.find((a: any) => a.organizationId === rows[3].id).available, '295.3449');
    assert.equal(report.accounts.some((a: any) => a.organizationId === rows[1].id), false);
    const scoped = await (await get('reports',actors[1].token)).json();
    assert.equal(scoped.organizations.some((o: any) => o.id === rows[1].id), false);
    assert.equal(scoped.organizations.some((o: any) => o.id === rows[3].id), true);
    assert.equal((await get('reports','invalid')).status,401);
    for (const token of [actors[2].token,'issue38-sales']) {
      const terminalReport = await (await get('reports',token)).json();
      assert.equal(terminalReport.organizations,undefined);
      assert.equal((await get('organizations',token)).status,403);
    }
    assert.equal((await post('organizations/state',{organizationId: rows[3].id, active:true})).status,403);
    assert.equal((await post('point-orders',{buyerId:rows[2].id,quantity:'1',unitPrice:'999',requestId:randomUUID()})).status,403);
    const deepOrderId = randomUUID();
    await pool.query(`INSERT INTO point_orders(id,seller_id,buyer_id,quantity,unit_price,amount,status,created_by)
      VALUES($1,$2,$3,1,9,9,'unpaid',$4)`,[deepOrderId,rows[2].id,rows[3].id,rows[2].accountId]);
    for (const [path, payload] of [
      ['point-orders/reprice',{orderId:deepOrderId,quantity:'1',unitPrice:'888',requestId:randomUUID()}],
      ['point-orders/confirm',{orderId:deepOrderId,receiptReference:'denied-cross-level',requestId:randomUUID()}],
      ['point-orders/transfer',{orderId:deepOrderId,requestId:randomUUID()}]
    ] as const) assert.equal((await post(path,payload)).status,403);
    assert.equal((await get('point-orders',actors[2].token)).status,403);
    assert.equal((await post('password-resets',{accountId:rows[3].accountId,requestId:randomUUID()})).status,403);
    assert.equal((await post('organizations/state',{organizationId:rows[1].id,active:false},actors[1].token)).status,403);
    assert.equal((await post('organizations',{name:'denied',kind:'distributor',countryCode:'+86',phone:'13938001234',email:'denied38@test.invalid',requestId:randomUUID()},actors[3].token)).status,403);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies([{name:'identity_session',value:actors[0].token,url:origin}]);
    const page = await context.newPage();
    const writes: string[] = [];
    const reads: string[] = [];
    page.on('request', request => { if(request.method() === 'POST') writes.push(request.url()); });
    page.on('request', request => {
      if (request.method() === 'GET' && /\/api\/(reports|organizations)$/.test(request.url())) reads.push(new URL(request.url()).pathname);
    });
    await page.goto(origin+'/platform/organizations');
    const direct = page.locator('.child-row').filter({hasText:'Direct distribution'});
    await expect(direct.getByText('111.1234',{exact:true})).toBeVisible();
    await expect(direct.getByText('97.1231',{exact:true})).toBeVisible();
    await expect(direct.getByText('11.0001',{exact:true})).toBeVisible();
    await expect(direct.getByText('3.0002',{exact:true})).toBeVisible();
    await expect(page.locator('.child-row').filter({hasText:'Direct terminal missing'}).getByText('暂无点数账户数据')).toBeVisible();
    await expect(page.locator('.child-row')).toHaveCount(2);
    await page.getByRole('link',{name:'下级账户',exact:true}).click();
    const breadcrumb = page.getByLabel('面包屑', { exact: true });
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('下级账户');
    await expect(breadcrumb.getByRole('link', { name: '直属下级', exact: true })).toHaveAttribute('href', '/platform/organizations');
    await expect(page.locator('.child-row')).toHaveCount(4);
    const deep = page.locator('.child-row').filter({hasText:'Disabled deep terminal'});
    await expect(deep.getByText('295.3449',{exact:true})).toBeVisible();
    await expect(deep.getByText('33.0003',{exact:true})).toBeVisible();
    await expect(deep.getByText('5.0004',{exact:true})).toBeVisible();
    await expect(deep).toContainText('停用');
    await expect(deep).toContainText('第3层下级');
    await expect(deep).toContainText('Second distribution');
    await expect(page.getByRole('button',{name:/重置|停用组织|恢复组织/})).toHaveCount(0);
    assert.deepEqual(reads.sort(), ['/api/organizations', '/api/reports']);
    await breadcrumb.getByRole('link', { name: '直属下级', exact: true }).click();
    await expect(page.locator('.child-row')).toHaveCount(2);
    await page.getByRole('link', { name: '下级账户', exact: true }).click();
    await page.getByRole('button', { name: '平台设置', exact: false }).click();
    await page.getByRole('link', { name: '计价配置', exact: true }).click();
    await expect(page).toHaveURL(origin + '/platform/settings');
    await expect(page.getByRole('button', { name: '刷新计价设置', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '刷新系数', exact: false })).toBeEnabled();
    await page.getByRole('navigation', { name: '主菜单', exact: true }).getByRole('link', { name: '下级管理', exact: true }).click();
    await expect(page.locator('.child-row')).toHaveCount(2);
    await page.getByRole('link', { name: '下级账户', exact: true }).click();
    await expect(deep.getByText('295.3449', { exact: true })).toBeVisible();
    assert.equal(reads.filter(path => path === '/api/reports').length, 1, 'returning to cached accounts must not refetch');
    await page.reload();
    await expect(deep.getByText('333.3456',{exact:true})).toBeVisible();
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('下级账户');
    await page.goBack();
    await expect(page.locator('.child-row')).toHaveCount(2);
    await page.goForward();
    await expect(page.locator('.child-row')).toHaveCount(4);
    // Delay a real response to observe loading and prevent duplicate refreshes.
    let releaseReport!: () => void;
    const reportGate = new Promise<void>(resolveGate => { releaseReport = resolveGate; });
    await page.route('**/api/reports', async route => {
      await reportGate;
      await route.continue();
    });
    await page.getByRole('button', { name: '刷新账户', exact: true }).click();
    await expect(page.getByText('账户读取中…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新账户', exact: true })).toBeDisabled();
    await expect(page.locator('.child-row')).toHaveCount(0);
    releaseReport();
    await expect(deep.getByText('295.3449', { exact: true })).toBeVisible();
    await page.unroute('**/api/reports');
    // Controlled contract anomaly: absent individual fields must not become zero.
    await page.route('**/api/reports', async route => {
      const response = await route.fetch();
      const snapshot = await response.json();
      const account = snapshot.accounts.find((item: any) => item.organizationId === rows[0].id);
      account.balance = null;
      delete account.available;
      await route.fulfill({ response, json: snapshot });
    });
    await page.getByRole('button', { name: '刷新账户', exact: true }).click();
    await expect(direct.getByText('数据缺失', { exact: true })).toHaveCount(2);
    await expect(direct.getByText('11.0001', { exact: true })).toBeVisible();
    await expect(direct.getByText('3.0002', { exact: true })).toBeVisible();
    await page.unroute('**/api/reports');
    // Failure injection only: success paths above use real HTTP/database.
    await page.route('**/api/reports',route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'controlled failure'})}));
    await page.getByRole('button',{name:'刷新账户',exact:true}).click();
    await expect(page.getByText('下级账户读取失败，请刷新重试。')).toBeVisible();
    await expect(page.locator('.child-row')).toHaveCount(0);
    await page.getByRole('navigation', { name: '下级管理页面', exact: true }).getByRole('link', { name: '直属下级', exact: true }).click();
    await expect(page.getByText('点数读取失败，请刷新重试。')).toHaveCount(2);
    await page.unroute('**/api/reports');
    await page.getByRole('button',{name:'刷新列表',exact:true}).click();
    await expect(direct.getByText('97.1231',{exact:true})).toBeVisible();
    await page.getByRole('link', { name: '下级账户', exact: true }).click();
    await expect(deep.getByText('295.3449', { exact: true })).toBeVisible();
    if (process.env.ISSUE38_SCREENSHOT) await page.screenshot({ path: process.env.ISSUE38_SCREENSHOT, fullPage: true });
    assert.deepEqual(writes,[]);
    for (const actor of [actors[1],actors[2],{token:'issue38-sales',role:'sales'}]) {
      const denied = await browser.newContext();
      await denied.addCookies([{name:'identity_session',value:actor.token,url:origin}]);
      const deniedPage = await denied.newPage();
      await deniedPage.goto(origin+'/platform/organizations?view=accounts');
      await expect(deniedPage).toHaveURL(origin+(actor.role === 'distributor'?'/distribution/organizations':'/terminal/search'));
      await expect(deniedPage.getByRole('heading',{name:'下级账户',exact:true})).toHaveCount(0);
      await denied.close();
    }
    await pool.query('UPDATE accounts SET must_change=true WHERE id=$1',[root.id]);
    assert.equal((await get('reports')).status,403);
    await page.reload();
    await expect(page.getByRole('heading',{name:'设置新密码',exact:true})).toBeVisible();
    assert.equal((await pool.query('SELECT balance,query_frozen,sales_reserved FROM internal_point_accounts WHERE organization_id=$1',[rows[3].id])).rows[0].balance,'333.3456');
    assert.equal((await pool.query('SELECT count(*) FROM organization_state_events')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT count(*) FROM password_reset_requests')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT unit_price,status FROM point_orders WHERE id=$1',[deepOrderId])).rows[0].unit_price,'9.0000');
    assert.equal((await pool.query('SELECT count(*) FROM point_transfers')).rows[0].count,'0');
    for (const table of ['query_point_ledger','company_contact_point_ledger','product_search_ledger'])
      assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
    console.log('Association UUIDs: '+JSON.stringify(rows));
    console.log('Evidence: distinct organization/account UUIDs; direct 111.1234/11.0001/3.0002/97.1231; deep disabled 333.3456/33.0003/5.0004/295.3449; no browser POST; no state/reset writes. Database '+databaseName);
    if (process.env.ISSUE38_EVIDENCE) writeFileSync(process.env.ISSUE38_EVIDENCE, JSON.stringify({
      date: '2026-10-28', databaseName, port, rows, browserWrites: writes,
      direct: { balance: '111.1234', queryFrozen: '11.0001', salesReserved: '3.0002', available: '97.1231' },
      deepDisabled: { balance: '333.3456', queryFrozen: '33.0003', salesReserved: '5.0004', available: '295.3449' },
      checked: ['breadcrumbs parent return', 'deep link reload', 'history back forward', 'cached page return without reports refetch', 'loading real response', 'null and absent field anomaly', '503 failure and manual recovery', 'role gates', 'must change gate', 'cross level write denial', 'no browser POST or point ledger writes'],
      simulated: ['null and absent report fields', '503 report failure'], databaseCleanup: 'finally drops only the created database'
    }, null, 2) + '\n');
  } finally {
    await browser?.close();
    await app?.close();
    await pool.end();
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});

