import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as netServer } from 'node:net';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import type { DomesticSmtpSettings } from '../server/email/smtp-channel.js';

async function freePort() {
  const server = netServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

test('Issue57 real settings contracts, protected navigation and tenant/session lifecycle', async ({ page }) => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated disposable database required');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = database(adminUrl.toString());
  const databaseName = `issue57_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  adminUrl.pathname = `/${databaseName}`;
  const pool = database(adminUrl.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = `http://127.0.0.1:${await freePort()}`;
  const smtpCalls: DomesticSmtpSettings[] = [];
  const umailCalls: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  let releaseSmtp: (() => void) | undefined;
  let waitSmtp = false;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: typeof app;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const password = 'Issue57-Fixture-Password!';
  const evidence: Record<string, unknown> = { origin, database: databaseName, issue: 57 };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().includes('/api/sending-channels/')) return;
    const body = request.postDataJSON() as Record<string, unknown> | null;
    requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: body ? { ...body, ...('credential' in body ? { credential: '[REDACTED]' } : {}) } : undefined });
  });
  const smtpAdapter = {
    async verify(input: DomesticSmtpSettings) {
      smtpCalls.push(input);
      if (waitSmtp) await new Promise<void>(done => { releaseSmtp = done; });
      return { state: 'available' as const, detail: '受控 SMTP 验证' };
    }
  };
  const umailAdapter = {
    async inspectResource(input: { organizationId: string; resourceId: string }) {
      return { ...input, resourceStatus: 'available' as const, detail: '受控资源验证', checkedAt: new Date() };
    },
    async inspectChannel(input: { organizationId: string; resourceId: string; domain: string; senderAddress: string }) {
      umailCalls.push(input);
      return { ...input, domainStatus: 'verified' as const, accountStatus: 'available' as const, detail: '受控域名验证',
        dnsRecords: [{ type: 'TXT', name: input.domain, value: 'issue57-controlled-dns' }], checkedAt: new Date() };
    }
  };
  try {
    await migrate(pool);
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const distributor = randomUUID(), a = randomUUID(), b = randomUUID();
    for (const [id, kind, parent, level] of [[distributor, 'distributor', platform.organization_id, 1], [a, 'terminal', distributor, 0], [b, 'terminal', platform.organization_id, 0]]) {
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [id, `组织57-${kind}`, kind, parent, level, randomUUID()]);
    }
    const actors = [
      { id: randomUUID(), org: a, email: 'admin-a@issue57.test', role: 'admin' },
      { id: randomUUID(), org: a, email: 'sales-a@issue57.test', role: 'sales' },
      { id: randomUUID(), org: b, email: 'admin-b@issue57.test', role: 'admin' },
      { id: randomUUID(), org: distributor, email: 'distributor@issue57.test', role: 'distributor' }
    ];
    for (const actor of actors) await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [actor.id, actor.org, actor.email, hash, actor.role]);
    await pool.query(`INSERT INTO umail_resources(organization_id,external_resource_id,resource_status,verification_detail,checked_at,configured_by)
      VALUES($1,'external-resource-57-A','available','受控隔离资源',clock_timestamp(),$2)`, [a, platform.id]);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen,sales_reserved) VALUES($1,157,2,3)', [a]);
    await pool.query("INSERT INTO email_daily_usage(organization_id,usage_day,reserved,used) VALUES($1,'2026-10-28',2,7)", [a]);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ['internal_point_accounts', 'query_point_ledger', 'email_daily_usage', 'email_batches', 'email_recipients']) {
        result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
      }
      return JSON.stringify(result);
    };
    const before = await snapshot();
    app = await createApplication(pool, origin, false, smtpAdapter, undefined, umailAdapter, undefined, undefined, undefined, undefined, undefined, undefined, resolve('.scratch/issue57/web'));
    await app.listen(Number(new URL(origin).port), '127.0.0.1');
    async function login(email: string, root = origin) {
      if (!page.url().startsWith(root) || !await page.getByRole('button', { name: '登录', exact: true }).isVisible()) await page.goto(root);
      await page.getByLabel('登录账号', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${email} 的账号菜单` })).toBeVisible();
      if (!await page.getByRole('heading', { name: '先保护好您的账号' }).isVisible()) {
        const home = email === 'super_admin' ? '/platform/overview' : email === actors[3].email ? '/distribution/organizations' : '/terminal/search';
        await expect(page).toHaveURL(`${root}${home}`);
      }
    }
    async function logout(email: string) {
      await page.getByRole('button', { name: `${email} 的账号菜单` }).click();
      await page.getByRole('menuitem', { name: '退出登录' }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    }
    async function settings() { await page.getByRole('link', { name: '团队发信设置', exact: true }).click(); await expect(page.locator('#smtp-host')).toBeVisible(); }
    async function fillSmtp(host = 'smtp.issue57.test') {
      await page.locator('#smtp-host').fill(host);
      await page.locator('#smtp-port').fill('587');
      await page.locator('#smtp-security').selectOption('starttls');
      await page.locator('#smtp-username').fill('authentication-57');
      await page.locator('#smtp-credential').fill('Issue57-Controlled-Credential');
      await page.locator('#smtp-reply-to').fill('smtp-reply@issue57.test');
      await page.locator('.smtp-form input[type=checkbox]').check();
    }
    async function api(path: string, body?: Record<string, unknown>) {
      const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')?.value ?? '';
      return page.request.fetch(`${origin}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'X-CSRF-Token': csrf }, data: body });
    }
    await login(actors[0].email);
    await settings();
    expect(requests.filter(item => item.method === 'GET')).toHaveLength(2);
    await fillSmtp();
    const help = page.getByRole('link', { name: '帮助中心', exact: true });
    page.once('dialog', dialog => dialog.dismiss());
    await help.click(); await expect(page).toHaveURL(`${origin}/terminal/sending-settings`);
    await expect(page.locator('#smtp-username')).toHaveValue('authentication-57');
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
    let reloadPrompt = false;
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); reloadPrompt = true; });
    await page.reload({ timeout: 3000 }).catch(() => undefined);
    expect(reloadPrompt).toBe(true);
    await expect(page.locator('#smtp-username')).toHaveValue('authentication-57');
    let closePrompt = false;
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); closePrompt = true; });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => closePrompt).toBe(true);
    await expect(page.locator('#smtp-username')).toHaveValue('authentication-57');
    page.once('dialog', dialog => dialog.accept()); await help.click();
    await page.goBack(); await expect(page.locator('#smtp-host')).toHaveValue('');
    await page.goForward(); await expect(page).toHaveURL(`${origin}/help`); await page.goBack();
    await fillSmtp();
    // Browser back cancellation must restore both URL and edit state.
    page.once('dialog', dialog => dialog.dismiss()); await page.evaluate(() => history.back());
    await expect(page).toHaveURL(`${origin}/terminal/sending-settings`); await expect(page.locator('#smtp-host')).toHaveValue('smtp.issue57.test');
    waitSmtp = true;
    await page.getByRole('button', { name: '验证设置并保存', exact: true }).click();
    await expect.poll(() => smtpCalls.length).toBe(1);
    await help.click(); await expect(page).toHaveURL(`${origin}/terminal/sending-settings`);
    await expect(page.locator('#smtp-host')).toBeDisabled();
    releaseSmtp!(); waitSmtp = false;
    await expect(page.locator('#smtp-credential')).toHaveValue('');
    expect(smtpCalls[0]).toEqual({ host: 'smtp.issue57.test', port: 587, security: 'starttls', username: 'authentication-57', credential: 'Issue57-Controlled-Credential', replyTo: 'smtp-reply@issue57.test' });
    const smtpStored = (await pool.query("SELECT * FROM team_sending_channels WHERE organization_id=$1 AND kind='SMTP'", [a])).rows[0];
    expect(smtpStored.organization_id).toBe(a); expect(smtpStored.updated_by).toBe(actors[0].id);
    expect(smtpStored.credential_encrypted).not.toContain('Issue57-Controlled-Credential');
    await page.locator('#umail-domain').fill('mail.issue57.test');
    await page.locator('#umail-sender-address').fill('sender@mail.issue57.test');
    await page.locator('#umail-reply-address').fill('umail-replies@issue57.test');
    await page.locator('.umail-form input[type=checkbox]').check();
    await page.getByRole('button', { name: '核验域名渠道并保存', exact: true }).click();
    await expect(page.getByLabel('DNS 记录')).toContainText('issue57-controlled-dns');
    expect(umailCalls).toEqual([{ organizationId: a, resourceId: 'external-resource-57-A', domain: 'mail.issue57.test', senderAddress: 'sender@mail.issue57.test' }]);
    expect((await pool.query('SELECT kind,default_flag FROM team_sending_channels WHERE organization_id=$1 ORDER BY kind', [a])).rows).toEqual([{ kind: 'SMTP', default_flag: false }, { kind: 'UMAIL', default_flag: true }]);
    // Drop only the real HTTP response after the server commits. No backend API is mocked.
    for (const kind of ['smtp', 'umail']) {
      const selector = kind === 'smtp' ? '#smtp-host' : '#umail-reply-address';
      await page.locator(selector).fill(kind === 'smtp' ? 'unknown.smtp.issue57.test' : 'unknown-reply@issue57.test');
      if (kind === 'smtp') await page.locator('#smtp-credential').fill('Issue57-Controlled-Credential');
      const pattern = `**/api/sending-channels/${kind}`;
      await page.route(pattern, async route => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        const result = await route.fetch(); expect(result.status()).toBe(201); await route.abort('failed');
      });
      const originalCount = kind === 'smtp' ? smtpCalls.length : umailCalls.length;
      await page.getByRole('button', { name: kind === 'smtp' ? '验证设置并保存' : '核验域名渠道并保存', exact: true }).click();
      await expect(page.getByRole('button', { name: '使用原请求核实', exact: true })).toBeVisible();
      const last = requests.filter(item => item.method === 'POST').at(-1)!;
      page.once('dialog', dialog => dialog.dismiss()); await help.click();
      await expect(page).toHaveURL(`${origin}/terminal/sending-settings`);
      page.once('dialog', dialog => dialog.accept()); await help.click();
      await page.goBack(); await expect(page.locator(selector)).toBeDisabled();
      expect(requests.filter(item => item.method === 'POST').at(-1)).toEqual(last);
      expect(kind === 'smtp' ? smtpCalls.length : umailCalls.length).toBe(originalCount + 1);
      await page.unroute(pattern);
      await page.getByRole('button', { name: '使用原请求核实', exact: true }).click();
      await expect(page.getByRole('button', { name: '使用原请求核实', exact: true })).toHaveCount(0);
      expect(requests.filter(item => item.method === 'POST').at(-1)).toEqual(last);
      expect(kind === 'smtp' ? smtpCalls.length : umailCalls.length).toBe(originalCount + 1);
    }
    const validSmtp = { host: 'smtp.issue57.test', port: '587', security: 'starttls', username: 'authentication-57', credential: 'fixture', replyTo: 'smtp-reply@issue57.test', defaultChannel: false, requestId: randomUUID() };
    const validUMail = { domain: 'mail.issue57.test', senderAddress: 'sender@mail.issue57.test', replyAddress: 'umail-replies@issue57.test', defaultChannel: false, requestId: randomUUID() };
    expect((await api('sending-channels/smtp', { ...validSmtp, organizationId: b })).status()).toBe(400);
    expect((await api('sending-channels/umail', { ...validUMail, resourceId: 'external-resource-B' })).status()).toBe(400);
    expect((await api('sending-channels/umail', { ...validUMail, senderAddress: 'wrong@other.test' })).status()).toBe(400);
    await page.reload(); await expect(page.locator('#smtp-host')).toHaveValue('unknown.smtp.issue57.test');
    await expect(page.locator('#smtp-credential')).toHaveValue('');
    await logout(actors[0].email);
    await login(actors[1].email); await page.goto(`${origin}/terminal/sending-settings`);
    await expect(page.getByTestId('smtp-reply-to')).toHaveText('smtp-reply@issue57.test');
    await expect(page.locator('form')).toHaveCount(0);
    for (const [path, body] of [['smtp', validSmtp], ['umail', validUMail]] as const) expect((await api(`sending-channels/${path}`, body)).status()).toBe(403);
    await logout(actors[1].email);
    await login(actors[2].email); await settings();
    await expect(page.locator('#smtp-host')).toHaveValue('');
    await expect(page.getByText('平台尚未为本企业配置 U-Mail 隔离资源。')).toBeVisible();
    expect((await api('sending-channels/umail', validUMail)).status()).toBe(409);
    await logout(actors[2].email);
    for (const email of [actors[3].email, 'super_admin']) {
      await login(email); await page.goto(`${origin}/terminal/sending-settings`);
      await expect(page).not.toHaveURL(`${origin}/terminal/sending-settings`);
      for (const [path, body] of [['smtp', validSmtp], ['umail', validUMail]] as const) {
        expect((await api(`sending-channels/${path}`)).status()).toBe(403);
        expect((await api(`sending-channels/${path}`, body)).status()).toBe(403);
      }
      await logout(email);
    }
    await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [actors[2].id]);
    await login(actors[2].email); await page.goto(`${origin}/terminal/sending-settings`);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    await expect(page.locator('.sending-settings')).toHaveCount(0);
    expect((await api('sending-channels/smtp')).status()).toBe(403);
    await logout(actors[2].email);
    // A real old GET is delayed across logout/login; it must never populate the new tenant.
    let releaseRead: (() => void) | undefined;
    let readFetched = false;
    let readDelivered = false;
    await page.route('**/api/sending-channels/smtp', async route => {
      const response = await route.fetch(); readFetched = true;
      await new Promise<void>(done => { releaseRead = done; });
      await route.fulfill({ response });
      readDelivered = true;
    });
    await login(actors[0].email);
    await settings(); await expect.poll(() => readFetched).toBe(true);
    await logout(actors[0].email);
    await pool.query('UPDATE accounts SET must_change=false WHERE id=$1', [actors[2].id]);
    await login(actors[2].email); releaseRead!();
    await expect.poll(() => readDelivered).toBe(true);
    await page.unroute('**/api/sending-channels/smtp');
    await settings(); await expect(page.locator('#smtp-host')).toHaveValue('');
    await logout(actors[2].email);
    const devOrigin = `http://127.0.0.1:${await freePort()}`;
    const backendPort = await freePort();
    devApp = await createApplication(pool, devOrigin, false, smtpAdapter, undefined, umailAdapter);
    await devApp.listen(backendPort, '127.0.0.1');
    vite = await createServer({ server: { host: '127.0.0.1', port: Number(new URL(devOrigin).port), strictPort: true, proxy: { '/api': `http://127.0.0.1:${backendPort}` } } });
    await vite.listen();
    await login(actors[0].email, devOrigin); await page.goto(`${devOrigin}/terminal/sending-settings`);
    await expect(page.getByTestId('smtp-reply-to')).toBeVisible(); await page.reload(); await expect(page.getByTestId('smtp-reply-to')).toBeVisible();
    for (const root of [origin, devOrigin]) {
      expect((await page.request.get(`${root}/terminal/sending-settings`)).status()).toBe(200);
      expect((await page.request.get(`${root}/issue57-missing.js`)).status()).toBe(404);
      expect((await page.request.get(`${root}/api/issue57-missing`)).status()).toBe(404);
    }
    expect(await snapshot()).toBe(before);
    expect(smtpCalls).toHaveLength(2); expect(umailCalls).toHaveLength(2); expect(errors).toEqual([]);
    Object.assign(evidence, {
      actors, identifiers: { platformAccount: platform.id, platformOrganization: platform.organization_id, distributor, a, b, smtpChannel: smtpStored.id, umailResource: 'external-resource-57-A' },
      requests, smtpAdapter: smtpCalls.map(({ credential: _credential, ...input }) => ({ ...input, credential: '[REDACTED]' })), umailAdapter: umailCalls,
      calls: { smtpVerify: smtpCalls.length, umailInspect: umailCalls.length, actualDelivery: 0 },
      dirtyCancelAndDiscard: true, backForward: true, submittingBlocked: true, beforeUnloadProtected: true, nativeReloadAndCloseCancelled: true,
      unknownBothChannelsOriginalPayloadAndId: true, noAutomaticRetryOnReturn: true, credentialsCleared: true,
      fourRolePermissionAndForcedChange: true, tenantIsolation: true, lateResponseAcrossLogout: true,
      nestViteDirectAndReload: true, accountingAndQuotaUnchanged: true, browserErrors: errors
    });
    await writeFile(resolve('../docs/delivery/application/ISSUE-57-EVIDENCE.json'), JSON.stringify(evidence, null, 2));
  } finally {
    releaseSmtp?.(); await vite?.close(); await devApp?.close(); await app?.close(); await pool.end();
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); await admin.end();
  }
});
