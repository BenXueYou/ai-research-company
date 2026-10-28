import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { testDatabase } from './helpers.js';
import { ProcurementService } from '../server/commerce/procurement.js';
import { digest } from '../server/identity/identity.js';
import type { UpstreamAccountClient } from '../server/upstream/upstream-monitor.js';

test('平台计价系数：真实落库、覆盖、参数、权限和导航生命周期', async ({ page }) => {
  const { pool } = await testDatabase();
  const platform = randomUUID();
  const distributor = randomUUID();
  const terminal = randomUUID();
  const actor = randomUUID();
  const terminalActor = randomUUID();
  const password = 'Issue42FixturePwd!';
  const hash = await hashPassword(password);
  await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'平台42','platform')", [platform]);
  await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
    VALUES($1,'分销42','distributor',$3,1,'fixture',$4,'***'),($2,'企业42','terminal',$1,0,'fixture',$5,'***')`,
    [distributor, terminal, platform, `phone-${distributor}`, `phone-${terminal}`]);
  for (const [id, role, org] of [[actor, 'platform', platform], [randomUUID(), 'distributor', distributor], [terminalActor, 'admin', terminal], [randomUUID(), 'sales', terminal]]) {
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [id, org, `${role}42@example.com`, hash, role]);
  }
  await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
    VALUES($1,$2,'temporary42@example.com',$3,'sales',true,clock_timestamp()+interval '72 hours')`, [randomUUID(), terminal, hash]);
  await pool.query('UPDATE platform_pricing SET coefficient=1,minimum_markup=0.01');
  await pool.query('DELETE FROM interface_prices');
  await pool.query('UPDATE platform_inventory SET balance=4,reserved=1,frozen=0');
  await pool.query('INSERT INTO distributor_inventory(organization_id,balance,reserved) VALUES($1,3,1)', [distributor]);
  await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen) VALUES($1,3,3)', [terminal]);
  const unpricedCandidate = randomUUID();
  const search = randomUUID(); const candidate = randomUUID(); const quotedCandidate = randomUUID(); const query = randomUUID(); const oldQuote = randomUUID();
  await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
    VALUES($1,$2,$3,'Search','TUR',1,20,1,'verified')`, [search,terminal,terminalActor]);
  for (const [id, source] of [[candidate,'list-id-A42'],[quotedCandidate,'list-id-B42'],[unpricedCandidate,'list-unpriced42']]) {
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,$4,'Selected Company','TUR','verified')`, [id,search,terminal,source]);
  }
  await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state,actual_upstream_points)
    VALUES($1,$2,$3,$4,'Selected Company','TUR',1,2,$5,'pending',0.5)`, [query,terminal,terminalActor,candidate,randomUUID()]);
  const settledQuery = randomUUID(); const profile = randomUUID();
  await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state,charged_points)
    VALUES($1,$2,$3,$4,'Selected Company','TUR',1,1,$5,'settled',1)`, [settledQuery,terminal,terminalActor,candidate,randomUUID()]);
  await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
    VALUES($1,$2,'detail-id-A42','Selected Company','TUR','{}',$3)`, [profile,terminal,settledQuery]);
  await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
    VALUES($1,$2,$3,$4,'Selected Company',ARRAY['CEO'],1,20,1,0.5,$5,'pending')`, [randomUUID(),terminal,terminalActor,profile,randomUUID()]);
  await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
    VALUES($1,$2,$3,'ceramic pump','TUR','2026-01-01','2026-06-30',1,20,1,0.5,$4,'pending')`, [randomUUID(),terminal,terminalActor,randomUUID()]);
  await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
    VALUES($1,$2,$3,$4,'Quoted Company','TUR',1,1,$5,'quoted')`, [oldQuote,terminal,terminalActor,quotedCandidate,randomUUID()]);
  let upstreamBalance = '8.0000';
  let upstreamCalls = 0;
  const upstream: UpstreamAccountClient = {
    account: async () => { upstreamCalls++; return { balance: upstreamBalance, expiresIn: '2027-12-31', traceId: 'account-42' }; },
    usage: async () => null,
    limits: () => ({ minute: 100, dataToday: 100, businessToday: 100 })
  };
  const origin = process.env.ISSUE42_DEV === '1' ? 'http://127.0.0.1:5342' : 'http://127.0.0.1:3342';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, upstream,
    undefined, undefined, undefined, undefined, resolve('.scratch/issue42-real-web'));
  await app.listen(3342, '127.0.0.1');
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let coefficientReads = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/api\/(procurement\/pricing|coefficient\/)/.test(path)) posts.push({ path, body: request.postDataJSON() });
    if (request.method() === 'GET' && path === '/api/coefficient') coefficientReads++;
  });
  const api = (path: string, body?: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
    const csrf = document.cookie.split('; ').find(item => item.startsWith('identity_csrf='))?.slice(14) ?? '';
    const response = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) } : undefined);
    return { status: response.status, data: await response.json() };
  }, { path, body });
  const login = async (role: string) => {
    await page.getByLabel('登录账号', { exact: true }).fill(`${role}42@example.com`);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: /的账号菜单/ })).toBeVisible();
  };
  const accountAction = async (name: string) => {
    await page.getByRole('button', { name: /的账号菜单/ }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  const settings = async () => {
    const link = page.getByRole('link', { name: '计价配置', exact: true });
    if (!await link.isVisible()) await page.getByRole('button', { name: '平台设置', exact: true }).click();
    await link.click();
  };
  try {
    const head = await page.request.head(`${origin}/platform/settings`);
    expect(head.status()).toBe(200);
    const unknownApi = await page.request.get(`${origin}/api/issue42-missing`);
    expect(unknownApi.status()).toBe(404);
    expect(unknownApi.headers()['content-type']).toContain('application/json');
    const missingAsset = await page.request.get(`${origin}/assets/issue42-missing.js`);
    expect(missingAsset.status()).toBe(404);
    expect(await missingAsset.text()).not.toContain('<div id="app">');
    await page.goto(`${origin}/platform/settings`);
    await login('admin');
    const unpriced = await api('company-details/quote', { candidateId: unpricedCandidate });
    expect(unpriced.status).toBe(409);
    expect(unpriced.data.message).toContain('单价');
    expect(upstreamCalls).toBe(0);
    await accountAction('退出登录');
    await login('platform');
    await settings();
    await page.reload();
    await expect(page.locator('#coefficient-value')).toHaveCount(1);
    await expect(page.getByText('接口单价未配置，付费查询不可执行。')).toBeVisible();
    const reads = coefficientReads;
    await page.getByLabel('最低加价率', { exact: true }).fill('0.0200');
    await page.getByLabel('计价核实依据').fill('合同42');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/platform/settings`);
    expect(posts).toHaveLength(0);
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    page.once('dialog', dialog => dialog.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/settings`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await settings();
    await expect(page.locator('#settings-minimum-markup')).toHaveValue('');
    expect(coefficientReads).toBe(reads);
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/overview`);
    await page.goForward();
    await expect(page).toHaveURL(`${origin}/platform/settings`);
    expect(coefficientReads).toBe(reads);
    await page.getByLabel('最低加价率', { exact: true }).fill('0.0200');
    await page.getByLabel('计价核实依据').fill('合同42');
    let release!: () => void;
    let committed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const written = new Promise<void>(resolve => { committed = resolve; });
    await page.route('**/api/procurement/pricing', async route => { const response = await route.fetch(); committed(); await gate; await route.fulfill({ response }); });
    await page.getByRole('button', { name: '保存计价设置' }).click();
    await written;
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/platform/settings`);
    await expect(page.locator('#settings-minimum-markup')).toBeDisabled();
    release();
    await expect(page.getByText('计价设置已保存')).toBeVisible();
    await page.unroute('**/api/procurement/pricing');
    expect(posts[0].body).toEqual({ minimumMarkup: '0.0200', evidence: '合同42', requestId: expect.any(String) });
    const fillPrice = async () => {
      await page.getByLabel('接口路径', { exact: true }).fill('/v2/company');
      await page.getByLabel('上游接口单价（上游点数/计费单位）').fill('2.1234');
      await page.getByLabel('已核实本页最大计费量').fill('9');
    };
    await fillPrice();
    await page.route('**/api/procurement/pricing', async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '保存计价设置' }).click();
    await expect(page.getByText('计价保存结果尚未确认。', { exact: false })).toBeVisible();
    const lostPrice = posts.at(-1)!;
    const pricingAudit = async () => (await pool.query("SELECT count(*)::int AS n FROM procurement_ledger WHERE event='pricing'")).rows[0].n;
    const auditBeforeRetry = await pricingAudit();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await settings();
    await expect(page.locator('#settings-price-path')).toHaveValue('/v2/company');
    await expect(page.locator('#settings-price-path')).toBeDisabled();
    expect(posts.at(-1)).toEqual(lostPrice);
    await page.unroute('**/api/procurement/pricing');
    await page.getByRole('button', { name: '重试原计价请求' }).click();
    await expect(page.getByText('计价设置已保存')).toBeVisible();
    expect(posts.at(-1)).toEqual(lostPrice);
    expect(await pricingAudit()).toBe(auditBeforeRetry);
    const price = (await pool.query("SELECT * FROM interface_prices WHERE interface_path='/v2/company'")).rows[0];
    expect(price.upstream_unit_price).toBe('2.1234');
    expect(price.maximum_billable_units).toBe(9);
    expect(price.evidence).toBe('合同42');
    expect(price.evidence_type).toBe('supplier_verified');
    await expect(page.getByText(`依据 合同42；版本 ${price.version}`, { exact: false })).toBeVisible();
    const token = (await page.context().cookies()).find(item => item.name === 'identity_session')?.value;
    expect(token).toBeTruthy();
    const cookieToken = token!;
    const session = (await pool.query('SELECT account_id FROM sessions WHERE token_hash=$1', [digest(cookieToken)])).rows[0];
    expect(session.account_id).toBe(actor);
    await expect(new ProcurementService(pool, true).mutate({
      id: actor,
      email: 'platform42@example.com',
      username: null,
      organization_id: platform,
      role: 'platform',
      must_change: false,
      csrf_hash: ''
    }, cookieToken, 'pricing', {
      requestId: randomUUID(), interfacePath: '/controlled', upstreamUnitPrice: '1', maximumBillableUnits: '1', evidence: 'fixture', evidenceType: 'controlled_test'
    })).rejects.toThrow(/生产计价/);
    await page.locator('#coefficient-value').fill('0.5000');
    const effectiveAt = new Date(Date.now() + 2500);
    const localTime = new Date(effectiveAt.getTime() - effectiveAt.getTimezoneOffset() * 60000).toISOString().slice(0,19);
    await page.locator('#coefficient-time').fill(localTime);
    await page.locator('#coefficient-notice').fill('全链通知42');
    await page.route('**/api/coefficient/announcements', async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '发布通知', exact: true }).click();
    await expect(page.getByText('系数操作结果尚未确认。', { exact: false })).toBeVisible();
    const lostAnnouncement = posts.at(-1)!;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await settings();
    expect(posts.at(-1)).toEqual(lostAnnouncement);
    await page.unroute('**/api/coefficient/announcements');
    await page.getByRole('button', { name: '重试原系数请求' }).click();
    await expect(page.getByText('已发布系数调整通知', { exact: true })).toBeVisible();
    expect(posts.at(-1)).toEqual(lostAnnouncement);
    const change = (await pool.query('SELECT * FROM coefficient_changes')).rows[0];
    expect(change.request_id).toBe(lostAnnouncement.body.requestId);
    expect(change.id).not.toBe(change.request_id);
    expect(lostAnnouncement.body).toEqual({ requestId: expect.any(String), coefficient: '0.5000', effectiveAt: new Date(localTime).toISOString(), notice: '全链通知42' });
    expect((await pool.query('SELECT count(*)::int AS n FROM coefficient_changes')).rows[0].n).toBe(1);
    await expect(page.getByRole('button', { name: '核验覆盖并生效' })).toBeEnabled();
    await page.getByRole('button', { name: '核验覆盖并生效' }).click();
    await expect(page.getByText(/全链额度覆盖不足/)).toBeVisible();
    expect(upstreamCalls).toBe(1);
    expect((await pool.query('SELECT coefficient FROM platform_pricing')).rows[0].coefficient).toBe('1.0000');
    upstreamBalance = '18.0000';
    await page.route('**/api/coefficient/activate', async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '核验覆盖并生效' }).click();
    await expect(page.getByText('系数操作结果尚未确认。', { exact: false })).toBeVisible();
    const lostActivate = posts.at(-1)!;
    expect(lostActivate.body).toEqual({ id: change.id });
    expect(upstreamCalls).toBe(2);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await settings();
    expect(posts.at(-1)).toEqual(lostActivate);
    expect(upstreamCalls).toBe(2);
    await page.unroute('**/api/coefficient/activate');
    await page.getByRole('button', { name: '重试原系数请求' }).click();
    await expect(page.getByText('系数已生效，覆盖核验已留存')).toBeVisible();
    expect(upstreamCalls).toBe(2);
    const activated = (await pool.query('SELECT * FROM coefficient_changes')).rows[0];
    expect(activated.coverage.requiredUpstreamPoints).toBe('16.5000');
    expect(activated.coverage.lockedInternalPoints).toBe('3.0000');
    expect(activated.coverage.pendingCount).toBe(3);
    expect(activated.coverage.inTransitChargedUpstreamPoints).toBe('0.5000');
    expect(activated.coverage.platformHeldIncluded).toBe('1.0000');
    expect(activated.coverage.distributorHeldIncluded).toBe('1.0000');
    expect(activated.coverage.terminalHeldIncluded).toBe('3.0000');
    expect((await pool.query('SELECT balance FROM platform_inventory')).rows[0].balance).toBe('4.0000');
    expect((await pool.query('SELECT balance FROM internal_point_accounts')).rows[0].balance).toBe('3.0000');
    expect((await pool.query('SELECT coefficient FROM company_detail_queries WHERE id=$1',[query])).rows[0].coefficient).toBe('1.0000');
    expect((await pool.query('SELECT state FROM company_detail_queries WHERE id=$1',[oldQuote])).rows[0].state).toBe('expired');
    const beforeReturn = posts.length;
    await accountAction('账号设置');
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page).toHaveURL(`${origin}/platform/settings`);
    expect(posts).toHaveLength(beforeReturn);
    await accountAction('退出登录');
    for (const role of ['distributor','admin','sales']) {
      await login(role);
      await page.goto(`${origin}/platform/settings`);
      await expect(page).not.toHaveURL(`${origin}/platform/settings`);
      expect((await api('coefficient/notices')).data).toEqual([expect.objectContaining({ notice: '全链通知42', proposedCoefficient: '0.5000' })]);
      expect((await api('coefficient')).status).toBe(403);
      expect((await api('procurement/pricing', { requestId: randomUUID(), minimumMarkup: '0.05', evidence: 'forbidden' })).status).toBe(403);
      expect((await api('coefficient/announcements', { requestId: randomUUID(), coefficient: '0.4', effectiveAt: new Date(Date.now()+60000).toISOString(), notice: 'forbidden' })).status).toBe(403);
      expect((await api('coefficient/activate', { id: change.id })).status).toBe(403);
      await accountAction('退出登录');
    }
    await login('temporary');
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect((await api('coefficient')).status).toBe(403);
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill('Issue42ChangedPwd!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue42ChangedPwd!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await login('platform');
    await settings();
    await expect(page.locator('#coefficient-value')).toHaveValue('');
    await expect(page.getByText('当前 X=0.5000。', { exact: false })).toBeVisible();
    await expect(page.getByText('当前最低加价率 0.0200。', { exact: false })).toBeVisible();
    writeFileSync('.scratch/issue42-evidence.json', JSON.stringify({ database: new URL(process.env.TEST_DATABASE_URL!).pathname, ids: { platform, distributor, terminal, actor, terminalActor, candidate, profile, query, oldQuote, change: change.id, announcementRequest: change.request_id }, posts, coefficientReads, upstreamCalls, price, coverage: activated.coverage, auditCount: await pricingAudit() }, null, 2));
  } finally { await app.close(); await pool.end(); }
});
