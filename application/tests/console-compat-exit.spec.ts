import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as netServer } from 'node:net';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';

async function freePort() {
  const s = netServer();
  await new Promise<void>(done => s.listen(0, '127.0.0.1', done));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>(done => s.close(() => done()));
  return p;
}

test('final console compatibility exit: real four-role navigation and session boundaries', async ({ page }) => {
  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl || !/^\/compat_[a-f0-9]+_test$/.test(new URL(dbUrl).pathname)) throw new Error('Own random disposable database required');
  const pool = database(dbUrl);
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const root = process.env.COMPAT_ROOT!;
  const origin = `http://127.0.0.1:${await freePort()}`;
  const password = 'CompatExit-Original-Password!';
  const requests: Array<{ path: string; method: string }> = [];
  const failures: string[] = [];
  let externalCalls = 0;
  let releaseSmtp!: () => void;
  let smtpCalls = 0;
  const smtpPayloads: Array<Record<string, unknown>> = [];
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  page.on('pageerror', error => failures.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push({ path, method: request.method() });
  });
  try {
    await migrate(pool);
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const distributorOrg = randomUUID(), terminalOrg = randomUUID();
    for (const [id, kind, parent, level] of [[distributorOrg, 'distributor', platform.organization_id, 1], [terminalOrg, 'terminal', distributorOrg, 0]]) {
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [id, `兼容退出-${kind}`, kind, parent, level, randomUUID()]);
    }
    const actors = [
      { id: platform.id, org: platform.organization_id, login: 'super_admin', role: 'platform', home: '/platform/overview' },
      { id: randomUUID(), org: distributorOrg, login: 'distribution@compat.test', role: 'distributor', home: '/distribution/organizations' },
      { id: randomUUID(), org: terminalOrg, login: 'admin@compat.test', role: 'admin', home: '/terminal/search' },
      { id: randomUUID(), org: terminalOrg, login: 'sales@compat.test', role: 'sales', home: '/terminal/search' }
    ];
    for (const actor of actors.slice(1)) await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [actor.id, actor.org, actor.login, hash, actor.role]);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,123.4567,2.0001,3.0002)', [terminalOrg]);
    await pool.query(`INSERT INTO coefficient_changes(id,request_id,actor_id,previous_coefficient,proposed_coefficient,effective_at,notice)
      VALUES($1,$2,$3,1,1.2500,clock_timestamp()+interval '1 day','公共通知隔离证据')`, [randomUUID(), randomUUID(), platform.id]);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ['internal_point_accounts', 'platform_inventory', 'distributor_inventory', 'query_point_ledger', 'point_orders', 'email_daily_usage', 'email_batches', 'email_recipients', 'company_detail_queries', 'company_contact_queries', 'product_search_pages']) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
      return result;
    };
    const before = await snapshot();
    app = await createApplication(pool, origin, false, { verify: async () => {
      smtpCalls++;
      await new Promise<void>(done => { releaseSmtp = done; });
      return { state: 'available', detail: '受控验证' };
    } }, { listCompanies: async () => { externalCalls++; throw new Error('Unexpected supplier call'); } }, undefined, undefined, { account: async () => { externalCalls++; return { balance: '1000', expiresIn: '100', traceId: 'controlled' }; }, usage: async () => null, limits: () => ({ minute: 60, dataToday: 100, businessToday: 100 }) }, undefined, undefined, undefined, undefined, resolve(root, 'web'));
    await app.listen(Number(new URL(origin).port), '127.0.0.1');
    const notices = () => requests.filter(item => item.path === '/api/coefficient/notices').length;
    async function login(actor: typeof actors[number], pwd = password, base = origin) {
      if (!page.url().startsWith(base) || !await page.getByRole('button', { name: '登录', exact: true }).isVisible()) await page.goto(base + actor.home);
      await page.getByLabel('登录账号', { exact: true }).fill(actor.login);
      await page.getByLabel('密码', { exact: true }).fill(pwd);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${actor.login} 的账号菜单` })).toBeVisible();
    }
    async function menu(actor: typeof actors[number], name: string) {
      await page.getByRole('button', { name: `${actor.login} 的账号菜单` }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    }
    async function logout(actor: typeof actors[number]) {
      await menu(actor, '退出登录');
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
      await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(0);
    }
    const routes = {
      platform: ['/platform/overview', '/platform/organizations?view=accounts', '/platform/ledger', '/platform/ledger/procurement', '/platform/ledger/profit', '/platform/ledger/flows', '/platform/reconciliation', '/platform/reconciliation/upstream', '/platform/settings', '/platform/settings/umail', '/platform/settings/email-quota', '/platform/organizations/business-data'],
      distributor: ['/distribution/organizations?view=accounts', '/distribution/orders', '/distribution/profit'],
      admin: ['/terminal/search', '/terminal/profiles', '/terminal/emails', '/terminal/sending-settings', '/terminal/members', '/terminal/usage'],
      sales: ['/terminal/search', '/terminal/profiles', '/terminal/emails', '/terminal/sending-settings', '/terminal/members', '/terminal/usage']
    };
    const roleEvidence = [];
    for (const actor of actors) {
      await login(actor);
      await expect(page).toHaveURL(origin + actor.home);
      await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
      // Traverse each real menu in the same SPA session, then verify hard deep links.
      const count = notices();
      for (const button of await page.locator('.sidebar-parent').all()) if (await button.getAttribute('aria-expanded') === 'false') await button.click();
      const links = await page.locator('a.sidebar-link').evaluateAll(elements => elements.map(el => (el as HTMLAnchorElement).pathname));
      for (const path of links) {
        await page.locator(`.sidebar-link[href="${path}"]`).click();
        await expect(page).toHaveURL(origin + path);
        await expect(page.locator('.sidebar-link.active')).toHaveCount(1);
        await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
      }
      await page.getByRole('link', { name: '帮助中心', exact: true }).click();
      await expect(page).toHaveURL(origin + '/help');
      await page.goBack(); await page.goForward();
      await expect(page).toHaveURL(origin + '/help');
      await menu(actor, '账号设置');
      await page.getByRole('button', { name: '返回工作台', exact: true }).click();
      expect(notices()).toBe(count);
      for (const path of routes[actor.role as keyof typeof routes]) {
        await page.goto(origin + path);
        await expect(page).toHaveURL(origin + path);
        await expect(page.locator('#console-main h1, #console-main h2').first()).toBeVisible();
        await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
        const beforeReload = notices();
        await page.reload();
        await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
        expect(notices()).toBe(beforeReload + 1);
      }
      const forbidden = actor.role === 'platform' ? '/terminal/search' : '/platform/settings';
      await page.goto(origin + forbidden);
      await expect(page).toHaveURL(origin + actor.home);
      roleEvidence.push({ role: actor.role, routes: routes[actor.role as keyof typeof routes], sameSessionNoticeRequests: 1 });
      await logout(actor);
    }
    // Cached draft, account return with query/hash, cancel and discard, back/forward.
    const actor = actors[2];
    await login(actor);
    await page.goto(origin + '/terminal/search?tab=company#company');
    const input = page.locator('#company-name');
    await input.fill('独立草稿');
    page.once('dialog', d => d.dismiss());
    await menu(actor, '账号设置');
    await expect(input).toHaveValue('独立草稿');
    page.once('dialog', d => d.accept());
    await menu(actor, '账号设置');
    await expect(page).toHaveURL(origin + '/account/settings');
    await page.locator('#current-password').fill('Draft-Only');
    page.once('dialog', d => d.dismiss()); await page.goBack();
    await expect(page).toHaveURL(origin + '/account/settings');
    await expect(page.locator('#current-password')).toHaveValue('Draft-Only');
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page).toHaveURL(origin + '/terminal/search?tab=company#company');
    await expect(input).toHaveValue('');
    // Actual server 401 clears cache and notification; another account starts clean.
    await input.fill('401前草稿');
    await pool.query('DELETE FROM sessions WHERE account_id=$1', [actor.id]);
    page.once('dialog', d => d.accept());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(0);
    await login(actors[3]);
    await expect(input).toHaveValue('');
    await logout(actors[3]);
    // Delay a real notification response beyond logout and the next login.
    let releaseNotice!: () => void;
    let noticeFetched = false;
    let noticeDelivered = false;
    await page.route('**/api/coefficient/notices', async route => {
      if (noticeFetched) return route.continue();
      const response = await route.fetch();
      noticeFetched = true;
      await new Promise<void>(done => { releaseNotice = done; });
      await route.fulfill({ response });
      noticeDelivered = true;
    });
    await login(actors[3]);
    await expect.poll(() => noticeFetched).toBe(true);
    await logout(actors[3]);
    await login(actors[1]);
    await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
    releaseNotice();
    await expect.poll(() => noticeDelivered).toBe(true);
    await page.unroute('**/api/coefficient/notices');
    await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
    await logout(actors[1]);
    // One #57 composition boundary: real saved response lost across settings/help.
    await login(actor);
    await page.getByRole('link', { name: '团队发信设置', exact: true }).click();
    await page.locator('#smtp-host').fill('smtp.compat.test');
    await page.locator('#smtp-port').fill('587');
    await page.locator('#smtp-security').selectOption('starttls');
    await page.locator('#smtp-username').fill('distinct-authentication');
    await page.locator('#smtp-credential').fill('Controlled-Only-Credential');
    await page.locator('#smtp-reply-to').fill('distinct-reply@compat.test');
    let loseSmtpResponse = true;
    await page.route('**/api/sending-channels/smtp', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      smtpPayloads.push({ ...body, credential: '[REDACTED]' });
      const response = await route.fetch();
      if (loseSmtpResponse) { loseSmtpResponse = false; await route.abort(); }
      else await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '验证设置并保存', exact: true }).click();
    await expect.poll(() => smtpCalls).toBe(1);
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await expect(page).toHaveURL(origin + '/terminal/sending-settings');
    releaseSmtp();
    await expect(page.getByRole('button', { name: '使用原请求核实', exact: true })).toBeVisible();
    page.once('dialog', d => d.dismiss()); await menu(actor, '账号设置');
    await expect(page).toHaveURL(origin + '/terminal/sending-settings');
    page.once('dialog', d => d.accept()); await menu(actor, '账号设置');
    await expect(page).toHaveURL(origin + '/account/settings');
    await page.getByRole('link', { name: '帮助中心', exact: true }).click();
    await page.goBack();
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page.getByRole('button', { name: '使用原请求核实', exact: true })).toBeVisible();
    expect(smtpCalls).toBe(1);
    expect(smtpPayloads).toHaveLength(1);
    await page.getByRole('button', { name: '使用原请求核实', exact: true }).click();
    await expect(page.getByRole('button', { name: '使用原请求核实', exact: true })).toHaveCount(0);
    expect(smtpPayloads).toHaveLength(2);
    expect(smtpPayloads[1]).toEqual(smtpPayloads[0]);
    expect(smtpCalls).toBe(1);
    await page.unroute('**/api/sending-channels/smtp');
    await logout(actor);
    // Temporary credentials cannot mount pages/notices; actual password change clears session.
    await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [actor.id]);
    const noticeCount = notices();
    await login(actor);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect(notices()).toBe(noticeCount);
    expect((await page.request.get(origin + '/api/coefficient/notices')).status()).toBe(403);
    await page.goto(origin + '/terminal/profiles');
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect(notices()).toBe(noticeCount);
    await page.locator('#current-password').fill(password);
    await page.locator('#new-password').fill('CompatExit-Changed-Password!');
    await page.locator('#confirm-password').fill('CompatExit-Changed-Password!');
    await page.getByRole('button', { name: '确认修改并重新登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await login(actor, 'CompatExit-Changed-Password!');
    await expect(page.locator('.el-alert').filter({ hasText: '公共通知隔离证据' })).toHaveCount(1);
    await logout(actor);
    // Production and Vite history fallbacks reject unknown APIs/static assets.
    const devOrigin = `http://127.0.0.1:${await freePort()}`;
    const devBackend = `http://127.0.0.1:${await freePort()}`;
    devApp = await createApplication(pool, devOrigin, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, resolve(root, 'web'));
    await devApp.listen(Number(new URL(devBackend).port), '127.0.0.1');
    vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: Number(new URL(devOrigin).port), strictPort: true, proxy: { '/api': devBackend }, watch: { ignored: ['**/.scratch/**'] } } });
    await vite.listen();
    for (const base of [origin, devOrigin]) {
      for (const paths of Object.values(routes)) for (const path of paths) {
        const response = await page.request.get(base + path);
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('text/html');
      }
      expect((await page.request.get(base + '/api/compat-missing')).headers()['content-type']).not.toContain('text/html');
      expect((await page.request.get(base + '/assets/compat-missing.js')).status()).toBe(404);
    }
    await login(actors[3], password, devOrigin);
    await page.goto(devOrigin + '/terminal/usage'); await page.reload();
    await expect(page.getByRole('heading', { name: '账户余额与冻结', exact: true })).toBeVisible();
    await logout(actors[3]);
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(externalCalls).toBe(0);
    expect(requests.filter(r => r.method === 'POST' && !r.path.startsWith('/api/auth/') && !['/api/sending-channels/smtp', '/api/company-profiles/list'].includes(r.path))).toEqual([]);
    expect(failures).toEqual([]);
    await writeFile(resolve(root, 'evidence.json'), JSON.stringify({ roles: roleEvidence, identities: actors.map(({ id, org, login, role }) => ({ id, organizationId: org, login, role })), before, after, externalCalls, smtpCalls, smtpPayloads, requests, pageErrors: failures, assertions: ['all real role pages', 'single notification per session', 'no duplicate distribution notice', 'account return query/hash', 'dirty cancel/discard and history', '401 cache clear', 'account switch and delayed notice', 'forced password change', 'submitting blocked and unknown retained across settings/help', 'original SMTP idempotency and no navigation replay', 'Nest/Vite history'], database: new URL(dbUrl).pathname.slice(1) }, null, 2));
  } finally {
    await page.goto('about:blank').catch(() => {});
    if (vite) await vite.close();
    if (devApp) await devApp.close();
    if (app) await app.close();
    await pool.end();
  }
});


