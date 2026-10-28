import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createApplication } from '../app.js';
import { migrate } from '../database.js';
import { digest } from '../identity/identity.js';
import { hashPassword } from '../identity/policy.js';

test('Issue39 authorized read-only business data through PostgreSQL, HTTP and Chromium', { timeout: 180000 }, async () => {
  const source = process.env.ISSUE39_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  assert.ok(source, 'A database connection is required; only a new random issue39 database is modified');
  const name = `issue39_${randomUUID().replaceAll('-', '')}_test`;
  const url = new URL(source);
  url.pathname = '/postgres';
  const admin = new pg.Pool({ connectionString: url.toString() });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const apiOrigin = 'http://127.0.0.1:3339';
  const origin = process.env.ISSUE39_DEV === '1' ? 'http://127.0.0.1:5339' : apiOrigin;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const evidence: Record<string, unknown> = { database: name, origin, cases: [] };
  try {
    await migrate(pool);
    const platform = (await pool.query("SELECT id FROM organizations WHERE kind='platform'")).rows[0].id as string;
    const platformActor = (await pool.query("SELECT id FROM accounts WHERE role='platform'")).rows[0].id as string;
    const d1 = randomUUID(); const d2 = randomUUID();
    const a = randomUUID(); const b = randomUUID(); const empty = randomUUID(); const outside = randomUUID();
    const otherRoot = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'隔离授权根39','platform')", [otherRoot]);
    for (const [id, label, kind, parent, level] of [
      [d1, '分销一级39', 'distributor', platform, 1],
      [d2, '分销二级39', 'distributor', d1, 2],
      [a, '企业甲39', 'terminal', d2, 0],
      [b, '企业乙39', 'terminal', platform, 0],
      [empty, '无数据企业39', 'terminal', platform, 0],
      [outside, '授权树外39', 'terminal', otherRoot, 0]
    ]) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [id, label, kind, parent, level, `phone-${id}`]);
    const password = 'Issue39FixturePwd!';
    const hash = await hashPassword(password);
    const actors = [
      { id: platformActor, org: platform, role: 'platform', email: 'super_admin', token: randomUUID() },
      { id: randomUUID(), org: d1, role: 'distributor', email: 'distributor39@test.invalid', token: randomUUID() },
      { id: randomUUID(), org: a, role: 'admin', email: 'admin39@test.invalid', token: randomUUID() },
      { id: randomUUID(), org: a, role: 'sales', email: 'sales39@test.invalid', token: randomUUID() },
      { id: randomUUID(), org: b, role: 'admin', email: 'other39@test.invalid', token: randomUUID() },
      { id: randomUUID(), org: a, role: 'sales', email: 'temporary39@test.invalid', token: randomUUID() },
      { id: randomUUID(), org: outside, role: 'admin', email: 'outside39@test.invalid', token: randomUUID() }
    ];
    for (const actor of actors) {
      if (actor.role === 'platform') await pool.query('UPDATE accounts SET password_hash=$1,must_change=false WHERE id=$2', [hash, actor.id]);
      else await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '72 hours')`,
      [actor.id, actor.org, actor.email, hash, actor.role, actor === actors[5]]);
      await pool.query('INSERT INTO sessions(token_hash,account_id,csrf_hash) VALUES($1,$2,$3)', [digest(actor.token), actor.id, digest('issue39-csrf')]);
    }
    const template = randomUUID();
    await pool.query("INSERT INTO public_templates(id,name,current_version) VALUES($1,'模板39',1)", [template]);
    await pool.query(`INSERT INTO public_template_versions(template_id,version,subject,content,created_by)
      VALUES($1,1,'模板主题','模板内容',$2)`, [template, platformActor]);
    const fixtures: Array<{ org: string; profile: string; batch: string; recipient: string; contact: string; detailId: string; subject: string }> = [];
    for (const [index, actor] of [actors[2], actors[4], actors[6]].entries()) {
      const search = randomUUID(); const candidate = randomUUID(); const query = randomUUID(); const profile = randomUUID();
      const contactQuery = randomUUID(); const contact = randomUUID(); const channel = randomUUID();
      const draft = randomUUID(); const preview = randomUUID(); const batch = randomUUID(); const recipient = randomUUID();
      const detailId = `upstream-detail-${index}-39`; const subject = `私有邮件主题${index}-39`;
      await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
        VALUES($1,$2,$3,$4,'TUR',1,20,1,'verified')`, [search, actor.org, actor.id, `私有关键词${index}-39`]);
      await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
        VALUES($1,$2,$3,$4,$5,'TUR','verified')`, [candidate, search, actor.org, `list-${index}-39`, `私有客户${index}-39`]);
      await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,$5,'TUR',1,1,$6,'settled')`, [query, actor.org, actor.id, candidate, `私有客户${index}-39`, randomUUID()]);
      await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id,main_products,purchasing_needs,cooperation_intent,deleted_at)
        VALUES($1,$2,$3,$4,'TUR',$5,$6,'泵','阀门','待沟通',$7)`,
      [profile, actor.org, detailId, `私有客户${index}-39`, JSON.stringify({ id: detailId, fileId: `different-file-${index}-39`, contact: `私有联系人${index}-39` }), query, index === 1 ? new Date() : null]);
      await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'Company',ARRAY['CEO'],1,20,1,1,$5,'settled')`, [contactQuery, actor.org, actor.id, profile, randomUUID()]);
      await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,returned_company_name,ownership_status,email,source_payload)
        VALUES($1,$2,$3,$4,$5,'Company','Company','matched',$6,'{}')`, [contact, actor.org, profile, contactQuery, `mailsou-${index}-39`, `recipient${index}@test.invalid`]);
      await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,credential_encrypted,reply_to,verification_state,verification_detail,verified_at,updated_by)
        VALUES($1,$2,'SMTP','smtp.test.invalid',465,'tls','fixture','fixture','reply@test.invalid','available','fixture',clock_timestamp(),$3)`, [channel, actor.org, actor.id]);
      await pool.query(`INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,selections)
        VALUES($1,$2,$3,$4,$5,1,$6,'私有邮件正文39','{}')`, [draft, actor.org, actor.id, profile, template, subject]);
      await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,1,$7,'私有邮件正文39','{}','[]','{}')`, [preview, draft, actor.org, actor.id, profile, template, subject]);
      await pool.query(`INSERT INTO email_batches(id,preview_id,organization_id,actor_id,profile_id,channel_id,channel_kind,reply_to,usage_day,attachment_ids)
        VALUES($1,$2,$3,$4,$5,$6,'SMTP','reply@test.invalid','2026-10-28','{}')`, [batch, preview, actor.org, actor.id, profile, channel]);
      for (const [rid, suffix] of [[recipient, 'one'], [randomUUID(), 'two']]) await pool.query(`INSERT INTO email_recipients(id,batch_id,organization_id,profile_id,email,email_key,contact_id,subject,content,status)
        VALUES($1,$2,$3,$4,$5,$5,$6,$7,'私有邮件正文39','accepted')`, [rid, batch, actor.org, profile, `${suffix}${index}@test.invalid`, contact, `${subject}-${suffix}`]);
      await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen) VALUES($1,10,2)', [actor.org]);
      fixtures.push({ org: actor.org, profile, batch, recipient, contact, detailId, subject });
    }
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [b]);
    const businessTables = ['company_searches', 'company_candidates', 'company_detail_queries', 'company_profiles', 'company_profile_events',
      'company_contact_queries', 'company_contacts', 'email_drafts', 'email_previews', 'email_batches', 'email_recipients',
      'email_daily_usage', 'email_usage_events', 'internal_point_accounts', 'query_point_ledger', 'company_contact_point_ledger',
      'product_search_ledger', 'point_orders', 'point_order_requests', 'point_transfers', 'procurement_ledger', 'platform_inventory', 'password_reset_requests'];
    const snapshot = async () => Object.fromEntries(await Promise.all(businessTables.map(async table =>
      [table, (await pool.query(`SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY row_to_json(t)::text),'[]') AS rows FROM ${table} t`)).rows[0].rows])));
    const before = await snapshot();
    let providerCalls = 0;
    const forbiddenProvider = new Proxy({}, { get: () => async () => { providerCalls++; throw new Error('No provider call is authorized'); } });
    app = await createApplication(pool, origin, false,
      forbiddenProvider as Parameters<typeof createApplication>[3], forbiddenProvider as Parameters<typeof createApplication>[4],
      forbiddenProvider as Parameters<typeof createApplication>[5], forbiddenProvider as Parameters<typeof createApplication>[6],
      forbiddenProvider as Parameters<typeof createApplication>[7], forbiddenProvider as Parameters<typeof createApplication>[8],
      forbiddenProvider as Parameters<typeof createApplication>[9], forbiddenProvider as Parameters<typeof createApplication>[10],
      forbiddenProvider as Parameters<typeof createApplication>[11], resolve('.scratch/issue39/web'));
    await app.listen(3339, '127.0.0.1');
    if (process.env.ISSUE39_DEV === '1') {
      vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 5339, strictPort: true, proxy: { '/api': apiOrigin } } });
      await vite.listen();
    }
    const get = (path: string, actor = actors[0]) => fetch(`${origin}/api/${path}`, { headers: { Cookie: `identity_session=${actor.token}` } });
    const post = (path: string, body: Record<string, unknown>, actor = actors[0]) => fetch(`${origin}/api/${path}`, {
      method: 'POST', headers: { Cookie: `identity_session=${actor.token}`, Origin: origin, 'X-CSRF-Token': 'issue39-csrf', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await fetch(`${origin}/api/reports`)).status, 401);
    const reportResponse = await get('reports');
    assert.equal(reportResponse.status, 200);
    assert.equal(reportResponse.headers.get('cache-control'), 'no-store');
    const report = await reportResponse.json();
    assert.equal(report.organizations.length, 6);
    assert.equal(report.customers.length, 2);
    assert.equal(report.emails.length, 4);
    assert.equal(report.organizations.some((row: { id: string }) => row.id === outside), false);
    assert.doesNotMatch(JSON.stringify(report), /私有客户2-39|私有邮件主题2-39|私有联系人2-39/);
    for (const fixture of fixtures.slice(0, 2)) {
      assert.equal(report.customers.find((row: { id: string }) => row.id === fixture.profile).detail.id, fixture.detailId);
      const email = report.emails.find((row: { recipientId: string }) => row.recipientId === fixture.recipient);
      assert.equal(email.id, fixture.batch); assert.equal(email.profileId, fixture.profile); assert.equal(email.organizationId, fixture.org);
      assert.equal(new Set([fixture.org, fixture.profile, fixture.batch, fixture.recipient, fixture.contact]).size, 5);
    }
    assert.doesNotMatch(await (await get('reports/own-ledger.csv')).text(), /私有客户|私有关键词|私有联系人|私有邮件/);
    for (const actor of [actors[1], actors[2], actors[3]]) {
      const body = await (await get(`reports?organizationId=${b}`, actor)).json();
      assert.equal(body.customers, undefined); assert.equal(body.emails, undefined);
      assert.doesNotMatch(JSON.stringify(body), /私有客户|私有关键词|私有联系人|私有邮件|recipient.*@test/);
      const csv = await get('reports/own-ledger.csv', actor);
      assert.equal(csv.status, actor.role === 'distributor' ? 200 : 403);
      assert.doesNotMatch(await csv.text(), /私有客户|私有关键词|私有联系人|私有邮件/);
    }
    assert.equal((await get('reports', actors[5])).status, 403);
    const denied: Array<[string, Record<string, unknown>, number]> = [
      ['company-profiles/update', { profileId: fixtures[0].profile, mainProducts: 'unauthorized change' }, 403],
      ['company-profiles/delete', { profileId: fixtures[0].profile }, 403],
      ['email-batches/execute', { batchId: fixtures[0].batch }, 403],
      ['point-orders', { requestId: randomUUID(), buyerId: a, quantity: '1', unitPrice: '1' }, 403],
      ['password-resets', { requestId: randomUUID(), accountId: actors[2].id }, 403]
    ];
    for (const [path, body, status] of denied) assert.equal((await post(path, body)).status, status, path);
    assert.equal((await post('company-profiles/update', { profileId: fixtures[1].profile, mainProducts: 'cross tenant' }, actors[2])).status, 404);
    assert.equal((await post('company-profiles/delete', { profileId: fixtures[1].profile }, actors[2])).status, 404);
    assert.equal((await post('email-batches/detail', { batchId: fixtures[1].batch }, actors[2])).status, 404);
    for (const [path, expected] of [['/platform/organizations/business-data', 200], ['/unknown39', 404], ['/assets/missing39.js', 404], ['/api/missing39', 404]] as const) {
      for (const method of ['GET', 'HEAD']) assert.equal((await fetch(`${origin}${path}`, { method })).status, expected, `${method} ${path}`);
    }
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const reportRequests: string[] = []; const pageWrites: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/reports') reportRequests.push(`${request.method()} ${new URL(request.url()).search}`);
      if (request.method() === 'POST' && !request.url().includes('/api/auth/')) pageWrites.push(new URL(request.url()).pathname);
    });
    const login = async (actor: typeof actors[number]) => {
      await page.getByLabel('登录账号', { exact: true }).fill(actor.email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      if (actor !== actors[5]) await expect(page.getByRole('button', { name: /的账号菜单/ })).toBeVisible();
    };
    const logout = async () => {
      await page.getByRole('button', { name: /的账号菜单/ }).click();
      await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    };
    const enter = async () => {
      await page.goto(`${origin}/platform/organizations/business-data`);
      await expect(page.getByLabel('查看组织')).toBeVisible();
    };
    await page.goto(`${origin}/platform/organizations/business-data`);
    await login(actors[0]);
    await enter();
    await expect(page.locator('.business-data article')).toHaveCount(6);
    await expect(page.locator('.business-data')).toHaveCount(1);
    await expect(page.locator('.business-data button')).toHaveCount(1);
    await expect(page.getByLabel('查看组织').locator('option')).toHaveCount(7);
    const reads = reportRequests.length;
    await page.getByLabel('查看组织').selectOption(a);
    await expect(page.locator('.business-data article')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: '私有客户0-39', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '私有客户1-39', exact: true })).toHaveCount(0);
    await page.getByText('档案详情', { exact: true }).click();
    await expect(page.locator('.business-data pre').first()).toContainText(fixtures[0].detailId);
    await page.getByLabel('查看组织').selectOption(b);
    await expect(page.locator('.business-data article')).toHaveCount(3);
    await expect(page.getByText(/已删除/)).toBeVisible();
    await expect(page.getByLabel('查看组织').locator(`option[value="${b}"]`)).toContainText('已停用');
    await page.getByLabel('查看组织').selectOption(empty);
    await expect(page.getByText('暂无客户档案', { exact: true })).toBeVisible();
    await expect(page.getByText('暂无邮件记录', { exact: true })).toBeVisible();
    assert.equal(reportRequests.length, reads, 'Organization filtering is local, without new requests');
    await page.getByLabel('查看组织').selectOption('');
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/reports'),
      page.getByRole('link', { name: '返回下级管理', exact: true }).click()
    ]);
    await expect(page).toHaveURL(`${origin}/platform/organizations`);
    const priorReturn = reportRequests.length;
    await page.goBack();
    await expect(page.getByLabel('查看组织')).toBeVisible();
    assert.equal(reportRequests.length, priorReturn + 1, 'Remount makes one read');
    await page.goForward();
    await expect(page).toHaveURL(`${origin}/platform/organizations`);
    await page.getByRole('link', { name: '业务数据查看', exact: true }).click();
    await expect(page.getByLabel('查看组织')).toBeVisible();
    await page.reload();
    await expect(page.locator('.business-data article')).toHaveCount(6);
    const priorQuery = reportRequests.length;
    // Navigate through the installed router without changing the report request contract.
    await page.evaluate(async () => {
      const app = document.querySelector('#app') as Element & { __vue_app__?: { config: { globalProperties: { $router: { push: (value: string) => Promise<unknown> } } } } };
      await app.__vue_app__!.config.globalProperties.$router.push('/platform/organizations/business-data?case=39');
    });
    await expect(page).toHaveURL(`${origin}/platform/organizations/business-data?case=39`);
    assert.equal(reportRequests.length, priorQuery, 'Query-only changes do not refetch');
    let release: (() => void) | undefined;
    const wait = new Promise<void>(done => { release = done; });
    await page.route('**/api/reports', async route => { await wait; await route.continue(); }, { times: 1 });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeDisabled();
    await expect(page.locator('.business-data [role="status"]')).toHaveText('业务数据加载中…');
    release!();
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
    await page.route('**/api/reports', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '专项读取失败39' }) }), { times: 1 });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.locator('.business-data [role="alert"]')).toContainText('专项读取失败39');
    await expect(page.locator('.business-data article')).toHaveCount(0);
    await expect(page.getByText('暂无客户档案', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.locator('.business-data article')).toHaveCount(6);
    await logout();
    for (const actor of [actors[1], actors[2], actors[3]]) {
      await login(actor);
      await expect(page.getByRole('button', { name: /的账号菜单/ })).toBeVisible();
      await page.goto(`${origin}/platform/organizations/business-data`);
      await expect(page).not.toHaveURL(/business-data/);
      await expect(page.locator('.business-data')).toHaveCount(0);
      const scoped = await (await page.request.get(`${origin}/api/reports`)).json();
      assert.equal(scoped.customers, undefined);
      assert.equal(scoped.emails, undefined);
      await expect(page.getByText('私有客户0-39', { exact: true })).toHaveCount(0);
      await logout();
    }
    await login(actors[5]);
    await expect(page.getByText('设置新密码', { exact: true })).toBeVisible();
    const temporaryReads = reportRequests.length;
    await page.goto(`${origin}/platform/organizations/business-data`);
    await expect(page.getByText('设置新密码', { exact: true })).toBeVisible();
    await expect(page.locator('.business-data')).toHaveCount(0);
    assert.equal(reportRequests.length, temporaryReads);
    await context.clearCookies();
    await page.reload();
    await login(actors[0]);
    await enter();
    await pool.query('DELETE FROM sessions WHERE account_id=$1', [platformActor]);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.locator('.business-data')).toHaveCount(0);
    assert.deepEqual(await snapshot(), before, 'Read navigation and rejected requests leave business rows and balances unchanged');
    assert.equal(providerCalls, 0);
    assert.ok(pageWrites.every(path => !/execute|update|delete|point-orders|password-resets|procurement/.test(path)), JSON.stringify(pageWrites));
    evidence.fixtures = fixtures;
    evidence.contract = {
      request: 'GET /api/reports',
      body: null,
      actorOrganizationId: platform,
      organizations: report.organizations,
      customers: report.customers,
      emails: report.emails,
      deniedWrites: denied.map(([path, body, status]) => ({ path, body, status }))
    };
    evidence.reportRequests = reportRequests;
    evidence.businessRowsUnchanged = businessTables;
    evidence.providerCalls = providerCalls;
    evidence.cases = ['platform full authorized tree', 'unrelated root excluded', 'two recipients per batch', 'organization filters', 'inactive/deleted retained', 'empty organization', 'GET/HEAD history', 'refresh/back/forward', 'query update', 'loading/failure/recovery', 'four roles login and logout', 'temporary password gate', '401 clears content', 'cross-tenant and cross-level writes rejected', 'distributor and terminal report/CSV isolation'];
    await mkdir(resolve('.scratch/issue39'), { recursive: true });
    await writeFile(resolve(`.scratch/issue39/evidence-${process.env.ISSUE39_DEV === '1' ? 'vite' : 'static'}.json`), JSON.stringify(evidence, null, 2));
    await context.close();
  } finally {
    await browser?.close();
    await vite?.close();
    await app?.close();
    await pool.end();
    assert.match(name, /^issue39_[a-f0-9]+_test$/);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
