import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApplication } from '../server/app.js';
import { migrate } from '../server/database.js';
import { testDatabase } from './helpers.js';

test('issue37 real backend: opening, handoff, permissions, state, lost responses', async ({ page, browser, playwright }) => {
  test.setTimeout(120000);
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3397';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('.scratch/issue37-real-web'));
  await app.listen(3397, '127.0.0.1');
  const contexts: APIRequestContext[] = [];
  const password = 'Issue37VerifiedPwd123!';
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
    const response = await post(api, 'organizations', { name: 'issue37-'+serial, kind, countryCode: '+86', phone: '1393700'+String(serial).padStart(4,'0'), email: 'issue37-'+serial+'@example.com', requestId: randomUUID() });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const writes: { path: string; body: any }[] = [];
  page.on('request', req => { if (req.method() === 'POST' && /\/api\/(organizations|password-resets)/.test(req.url())) writes.push({ path: new URL(req.url()).pathname, body: req.postDataJSON() }); });
  try {
    const anonymous = await playwright.request.newContext({ baseURL: origin }); contexts.push(anonymous);
    expect((await anonymous.get('/api/organizations')).status()).toBe(401);
    const initial = await client('super_admin', 'init@Base123');
    expect((await initial.get('/api/organizations')).status()).toBe(403);
    const platform = await activate('super_admin', 'init@Base123');
    const dist = await open(platform, 'distributor');
    const distApi = await activate(dist.email, dist.temporaryPassword);
    const grandchild = await open(distApi, 'terminal');
    const dist2 = await open(distApi, 'distributor');
    const dist2Api = await activate(dist2.email, dist2.temporaryPassword);
    expect((await dist2Api.get('/api/organizations')).ok()).toBe(true);
    expect((await (await dist2Api.get('/api/organizations')).json()).allowedKinds).toEqual(['terminal']);
    expect((await post(dist2Api,'organizations',{ name:'third',kind:'distributor',countryCode:'+86',phone:'13937999999',email:'third37@example.com',requestId:randomUUID() })).status()).toBe(403);
    for (const api of [platform, distApi]) {
      const target = api === platform ? grandchild : dist;
      expect((await post(api,'password-resets',{accountId:target.accountId,requestId:randomUUID()})).status()).toBe(403);
      expect((await post(api,'organizations/state',{organizationId:target.organizationId,active:false})).status()).toBe(403);
    }
    await page.context().addCookies((await platform.storageState()).cookies);
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.goto(origin+'/platform/organizations');
    await page.getByRole('link',{name:'开户',exact:true}).click();
    await expect(page.getByLabel('组织类型')).toHaveValue('terminal');
    await expect(page.getByLabel('国家区号')).toHaveValue('+86');
    await page.getByLabel('组织名称').fill('Issue37 Browser Terminal');
    page.once('dialog',d=>d.dismiss());
    await page.getByRole('link',{name:'直属下级',exact:true}).click();
    await expect(page.getByLabel('组织名称')).toHaveValue('Issue37 Browser Terminal');
    page.once('dialog',d=>d.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(origin+'/platform/organizations?view=new');
    await expect(page.getByLabel('组织名称')).toHaveValue('Issue37 Browser Terminal');
    await page.getByLabel('电话号码').fill('139 37001234');
    await page.getByLabel('管理员邮箱（登录账号）').fill('browser37@example.com');
    await page.getByRole('button',{name:'确认开户'}).click();
    await expect(page.getByText('组织名称、电话号码必填，电话号码不能包含空格')).toBeVisible();
    await page.getByLabel('电话号码').fill('13937001234');
    const openingResponse = page.waitForResponse(r=>r.url().endsWith('/api/organizations')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认开户'}).click();
    const opened=await (await openingResponse).json();
    await expect(page.getByRole('heading',{name:'开户成功',exact:true})).toBeVisible();
    expect(opened.temporaryPassword).toHaveLength(24);
    expect(new Date(opened.expiresAt).getTime()-Date.now()).toBeGreaterThan(71*3600000);
    expect(new Date(opened.expiresAt).getTime()-Date.now()).toBeLessThanOrEqual(72*3600000);
    await page.getByRole('button',{name:'一键复制账号信息'}).click();
    expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n') === '登录邮箱：'+opened.email+'\n临时密码：'+opened.temporaryPassword).toBe(true);
    const selected=(await pool.query('SELECT o.id,o.parent_id,a.id AS account_id,a.email FROM organizations o JOIN accounts a ON a.organization_id=o.id WHERE o.id=$1',[opened.organizationId])).rows[0];
    expect(new Set([selected.id,selected.parent_id,selected.account_id,selected.email]).size).toBe(4);
    const childApi=await activate(opened.email,opened.temporaryPassword);
    const memberResponse=await post(childApi,'members',{name:'Issue37 Sales',email:'sales37@example.com',role:'sales',requestId:randomUUID()});
    expect(memberResponse.status()).toBe(201);
    const sales=await memberResponse.json();
    await activate(sales.email,sales.temporaryPassword);
    expect((await childApi.get('/api/organizations')).status()).toBe(403);
    expect((await post(childApi,'password-resets',{accountId:dist.accountId,requestId:randomUUID()})).status()).toBe(403);
    await page.getByRole('button',{name:'已保存，关闭凭据'}).click();
    await expect(page.getByTestId('handoff-password')).toHaveCount(0);
    await page.locator('.child-row').filter({hasText:'Issue37 Browser Terminal'}).getByRole('link',{name:'下级详情'}).click();
    await page.reload();
    await expect(page.getByRole('button',{name:'停用组织'})).toBeVisible();
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,7)',[opened.organizationId]);
    await page.getByRole('button',{name:'停用组织'}).click();
    await expect(page.getByRole('button',{name:'恢复组织'})).toBeVisible();
    expect(writes.find(x=>x.path==='/api/organizations/state')!.body).toEqual({organizationId:opened.organizationId,active:false});
    expect((await childApi.get('/api/auth/session')).status()).toBe(401);
    expect((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1',[opened.organizationId])).rows[0].balance).toBe('7.0000');
    await page.getByRole('button',{name:'恢复组织'}).click();
    await expect(page.getByRole('button',{name:'停用组织'})).toBeVisible();
    const beforeReset=await client(opened.email,password);
    await page.getByRole('button',{name:'重置管理员密码'}).click();
    await expect(page.getByRole('heading',{name:'管理员密码重置成功'})).toBeVisible();
    expect(writes.find(x=>x.path==='/api/password-resets')!.body.accountId).toBe(selected.account_id);
    expect((await beforeReset.get('/api/auth/session')).status()).toBe(401);
    await page.getByRole('button',{name:'已保存，关闭凭据'}).click();
    await page.reload();
    await expect(page.getByTestId('handoff-password')).toHaveCount(0);
    const duplicate=await post(platform,'organizations',{name:'duplicate',kind:'terminal',countryCode:'+86',phone:'13937001234',email:'duplicate37@example.com',requestId:randomUUID()});
    expect(duplicate.status()).toBe(409);
    expect((await post(platform,'organizations',{name:'duplicate email',kind:'terminal',countryCode:'+86',phone:'13937009991',email:opened.email,requestId:randomUUID()})).status()).toBe(409);
    // Forward the real request and drop only the committed response.
    let lostResetPassword='';
    await page.route('**/api/password-resets',async route=>{
      const response=await route.fetch();expect(response.status()).toBe(201);
      lostResetPassword=(await response.json()).temporaryPassword;await route.abort();
    });
    await page.getByRole('button',{name:'重置管理员密码'}).click();
    await expect(page.getByText('管理员密码重置结果尚未确认。请核实账号状态；返回本页不会再次重置。')).toBeVisible();
    await expect(page.getByRole('button',{name:'重置管理员密码'})).toBeDisabled();
    const countReset=(await pool.query('SELECT count(*) FROM password_reset_requests WHERE target_account_id=$1',[selected.account_id])).rows[0].count;
    page.once('dialog',d=>d.accept());
    await page.getByRole('link',{name:'帮助中心',exact:true}).click();
    await expect(page).toHaveURL(origin+'/help');
    await page.getByRole('link',{name:'下级管理',exact:true}).click();
    page.once('dialog',d=>d.accept());
    await page.locator('.child-row').filter({hasText:'Issue37 Browser Terminal'}).getByRole('link',{name:'下级详情'}).click();
    await expect(page.getByRole('button',{name:'重置管理员密码'})).toBeDisabled();
    expect((await pool.query('SELECT count(*) FROM password_reset_requests WHERE target_account_id=$1',[selected.account_id])).rows[0].count).toBe(countReset);
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'已核实，需要重新补发凭据'}).click();
    await page.unroute('**/api/password-resets');
    await page.getByRole('link',{name:'开户',exact:true}).click();
    await page.getByLabel('组织名称').fill('Issue37 Lost Response');
    await page.getByLabel('电话号码').fill('13937005678');
    await page.getByLabel('管理员邮箱（登录账号）').fill('lost37@example.com');
    await page.route('**/api/organizations',async route=>{
      if(route.request().method()!=='POST') return route.continue();
      expect((await route.fetch()).status()).toBe(201);await route.abort();
    });
    await page.getByRole('button',{name:'确认开户'}).click();
    await expect(page.getByText('开户结果尚未确认。请刷新直属列表核实；重试将沿用本次请求标识，不会自动重新开户。')).toBeVisible();
    const lostBody=writes.filter(x=>x.path==='/api/organizations').at(-1)!.body;
    page.once('dialog',d=>d.accept());
    await page.getByRole('link',{name:'直属下级',exact:true}).click();
    await page.getByRole('button',{name:'刷新列表'}).click();
    await expect(page.locator('.child-row').filter({hasText:'Issue37 Lost Response'})).toHaveCount(1);
    page.once('dialog',d=>d.accept());
    await page.getByRole('link',{name:'开户',exact:true}).click();
    await expect(page.getByLabel('组织名称')).toHaveValue('Issue37 Lost Response');
    await page.unroute('**/api/organizations');
    const retry=page.waitForResponse(r=>r.url().endsWith('/api/organizations')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认开户'}).click();
    expect((await retry).status()).toBe(409);
    expect(writes.filter(x=>x.path==='/api/organizations').at(-1)!.body).toEqual(lostBody);
    expect((await pool.query("SELECT count(*) FROM accounts WHERE email='lost37@example.com'")).rows[0].count).toBe('1');
    expect((await pool.query("SELECT count(*) FROM organizations WHERE name='Issue37 Lost Response'")).rows[0].count).toBe('1');
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'已核实开户结果，结束本次开户'}).click();
    await expect(page).toHaveURL(origin+'/platform/organizations');
    await page.getByRole('link',{name:'开户',exact:true}).click();
    await expect(page.getByLabel('组织名称')).toHaveValue('');
    // Other roles cannot mount the platform detail or call its writes.
    const roleContext=await browser.newContext();
    await roleContext.addCookies((await distApi.storageState()).cookies);
    const rolePage=await roleContext.newPage();
    await rolePage.goto(origin+'/platform/organizations?id='+opened.organizationId);
    await expect(rolePage).toHaveURL(origin+'/distribution/organizations');
    await roleContext.close();
    writeFileSync('.scratch/issue37-evidence.json', JSON.stringify({selected,requests:writes,resetRecords:countReset,openingRows:1,openingRetryStatus:409},null,2));
    for (const role of [
      {email:dist.email,password,expected:'/distribution/organizations'},
      {email:opened.email,password:lostResetPassword,expected:'/terminal/search',force:true},
      {email:sales.email,password,expected:'/terminal/search'},
      {email:'super_admin',password,expected:'/platform/overview'}
    ]) {
      await page.getByRole('button',{name:'退出登录',exact:true}).click();
      await page.getByLabel('登录账号',{exact:true}).fill(role.email);
      await page.getByLabel('密码',{exact:true}).fill(role.password);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      if(role.force) {
        await expect(page.getByRole('heading',{name:'先保护好您的账号'})).toBeVisible();
        await page.getByLabel('当前密码',{exact:true}).fill(role.password);
        await page.getByLabel('新密码',{exact:true}).fill(password);
        await page.getByLabel('确认新密码',{exact:true}).fill(password);
        await page.getByRole('button',{name:'确认修改并重新登录'}).click();
        await page.getByLabel('登录账号',{exact:true}).fill(role.email);
        await page.getByLabel('密码',{exact:true}).fill(password);
        await page.getByRole('button',{name:'登录',exact:true}).click();
      }
      await expect(page.getByLabel('登录账号',{exact:true})).toHaveCount(0);
      await expect(page).toHaveURL(origin+role.expected);
      if(role.email!=='super_admin') {
        await page.goto(origin+'/platform/organizations?id='+opened.organizationId);
        await expect(page.getByLabel('登录账号',{exact:true})).toHaveCount(0);
      await expect(page).toHaveURL(origin+role.expected);
      }
    }
  } finally {
    await Promise.all(contexts.map(c=>c.dispose()));
    await app.close();await pool.end();
  }
});
