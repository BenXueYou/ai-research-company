import { test, expect } from '@playwright/test';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { EmailSendService, type DeliveryEvidenceProvider, type DomesticSmtpSender, type SmtpMessage } from '../server/email/email-send.js';
import type { Identity } from '../server/identity/identity.js';

test('Issue56 independent email history preserves scope, evidence, retry, quota and lifecycle', async ({ page }) => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const url = new URL(base); url.pathname = '/postgres';
  const admin = database(url.toString());
  const name = `issue56_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`); url.pathname = `/${name}`;
  const pool = database(url.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const password = 'Issue56-fixture-password!';
  const org = randomUUID(); const outsider = randomUUID(); const distributor = randomUUID();
  const actor = randomUUID(); const sales = randomUUID(); const other = randomUUID(); const distActor = randomUUID();
  const profileId = randomUUID(); const templateId = randomUUID(); const draftId = randomUUID();
  const previewId = randomUUID(); const channelId = randomUUID(); const contacts = Array.from({ length: 4 }, () => randomUUID());
  const senderCalls: Array<SmtpMessage & { replyTo: string }> = [];
  const sender: DomesticSmtpSender = { async send(settings, message) {
    senderCalls.push({ ...message, replyTo: settings.replyTo });
    return { state: senderCalls.length === 1 ? 'accepted' : senderCalls.length === 2 ? 'not_submitted' : senderCalls.length === 3 ? 'uncertain' : 'accepted', detail: 'controlled-result' };
  } };
  let evidenceFails = false;
  let deliveredId = '';
  const evidenceCalls: string[] = [];
  const evidence: DeliveryEvidenceProvider = { async check(request) {
    evidenceCalls.push(request.recipientId);
    if (evidenceFails) throw new Error('controlled evidence unavailable');
    const finding = request.recipientId === deliveredId ? 'delivered' as const : 'unknown' as const;
    return { organizationId: request.organizationId, recipientId: request.recipientId, resourceId: request.resourceId,
      finding, evidenceId: finding === 'delivered' ? 'controlled-delivery-evidence' : null, detail: 'controlled evidence' };
  } };
  try {
    await migrate(pool); const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const root = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const platformId = root.id; const platformOrg = root.organization_id;
    for (const [id, kind] of [[org, 'terminal'], [outsider, 'terminal'], [distributor, 'distributor']]) await pool.query(
      `INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
       VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [id, `fixture-${id}`, kind, platformOrg, kind === 'distributor' ? 1 : 0, randomUUID()]);
    for (const [id, organization, role, email] of [[actor, org, 'admin', 'admin@issue56.test'], [sales, org, 'sales', 'sales@issue56.test'],
      [other, outsider, 'admin', 'other@issue56.test'], [distActor, distributor, 'distributor', 'dist@issue56.test']]) await pool.query(
      `INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,false)`, [id, organization, email, hash, role]);
    const identity: Identity = { id: actor, organization_id: org, role: 'admin', email: 'admin@issue56.test', username: null, csrf_hash: '', must_change: false };
    const searchId = randomUUID();
    const candidateId = randomUUID();
    const detailId = randomUUID();
    await pool.query("INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status) VALUES($1,$2,$3,'Source','TUR',1,20,1,'verified')",
      [searchId, org, actor]);
    await pool.query("INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status) VALUES($1,$2,$3,'list-111','Target','TUR','verified')",
      [candidateId, searchId, org]);
    await pool.query("INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Target','TUR',1,1,$5,'settled')",
      [detailId, org, actor, candidateId, randomUUID()]);
    await pool.query("INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id) VALUES($1,$2,'detail-222','Target','TUR','{}',$3)",
      [profileId, org, detailId]);
    const contactQueryId = randomUUID();
    await pool.query("INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Target','{}',1,20,1,1,$5,'settled')",
      [contactQueryId, org, actor, profileId, randomUUID()]);
    for (let i = 0; i < contacts.length; i++) {
      await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,
        returned_company_name,ownership_status,email,source_payload) VALUES($1,$2,$3,$4,$5,'Target','Target','matched',$6,$7)`,
      [contacts[i], org, profileId, contactQueryId, `mailsou-${i}`, i < 2 ? 'Dup@Example.com' : `unique-${i}@example.com`,
        JSON.stringify({ id: `source-id-${i}`, fileId: `file-id-${i}` })]);
    }
    await pool.query("INSERT INTO public_templates(id,name,current_version) VALUES($1,'Intro',1)", [templateId]);
    await pool.query("INSERT INTO public_template_versions(template_id,version,subject,content,attachment_ids,created_by) VALUES($1,1,'Subject','Body','{}',$2)",
      [templateId, platformId]);
    await pool.query(`INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,selections)
      VALUES($1,$2,$3,$4,$5,1,'Subject','Body','[]')`, [draftId, org, actor, profileId, templateId]);
    const recipients = [
      { email: 'dup@example.com', emailKey: 'dup@example.com', contactId: contacts[1], mailsouId: 'mailsou-1',
        subject: 'Chosen source', content: 'selected mailsou-1', sourceContactIds: [contacts[0], contacts[1]],
        unsubscribedContactIds: [] },
      ...[2, 3].map(i => ({ email: `unique-${i}@example.com`, emailKey: `unique-${i}@example.com`,
        contactId: contacts[i], mailsouId: `mailsou-${i}`, subject: `Subject ${i}`, content: `Body ${i}`,
        sourceContactIds: [contacts[i]], unsubscribedContactIds: [] }))
    ];
    await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,
      subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
      VALUES($1,$2,$3,$4,$5,$6,1,'Subject','Body','{}','[]',$7,clock_timestamp())`,
    [previewId, draftId, org, actor, profileId, templateId, JSON.stringify(recipients)]);
    const key = Buffer.from(process.env.SMTP_CREDENTIAL_KEY!, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${org}:SMTP`));
    const encrypted = Buffer.concat([cipher.update('credential'), cipher.final()]);
    const secret = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,
      credential_encrypted,reply_to,verification_state,verification_detail,verified_at,updated_by)
      VALUES($1,$2,'SMTP','smtp.example.com',465,'tls','smtp-user',$3,'reply@example.net','available','controlled',clock_timestamp(),$4)`,
    [channelId, org, secret, actor]);
    const service = new EmailSendService(pool, key, sender, undefined, evidence);
    const confirmed = await service.confirm(identity, { previewId, channelId, confirmUnsubscribeNotice: true, confirmQuota: true });
    await service.execute(identity, { batchId: confirmed.batchId });
    expect(senderCalls.length).toBe(3);
    const batchId = confirmed.batchId;
    const initial = await service.batch(identity, batchId);
    const accepted = initial.recipients.find(row => row.status === 'accepted')!;
    deliveredId = accepted.id;
    const failed = initial.recipients.find(row => row.status === 'not_submitted')!;
    const uncertain = initial.recipients.find(row => row.status === 'uncertain')!;
    const laterPreview = randomUUID();
    await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,
      subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
      SELECT $1,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,attachment_ids,
      recipient_snapshot,$2,clock_timestamp() FROM email_previews WHERE id=$3`, [laterPreview, JSON.stringify([recipients[0]]), previewId]);
    const later = await service.confirm(identity, { previewId: laterPreview, channelId, confirmUnsubscribeNotice: true, confirmQuota: true });
    const pausedId = (await service.batch(identity, later.batchId)).recipients[0].id;
    await pool.query("UPDATE email_batches SET usage_day=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE id=$1", [later.batchId]);
    await pool.query('UPDATE email_daily_usage SET reserved=reserved-1 WHERE organization_id=$1', [org]);
    await pool.query("INSERT INTO email_daily_usage(organization_id,usage_day,reserved) VALUES($1,(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1,1)", [org]);
    await pool.query("UPDATE email_usage_events SET usage_day=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE recipient_id=$1", [pausedId]);
    const distinct = [org, outsider, actor, profileId, batchId, later.batchId, accepted.id, failed.id, uncertain.id, pausedId, ...contacts];
    expect(new Set(distinct).size).toBe(distinct.length);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,100),($2,200)', [org, outsider]);
    const pointTables = ['internal_point_accounts', 'platform_inventory', 'query_point_ledger', 'company_contact_point_ledger', 'product_search_ledger'];
    const pointSnapshot = async () => {
      const state: Record<string, unknown> = {};
      for (const table of pointTables) state[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
      return JSON.stringify(state);
    };
    const beforePoints = await pointSnapshot();
    const freePort = () => new Promise<number>((resolve, reject) => {
      const server = createNetServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => {
        const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
    const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
    app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, sender, undefined, resolve('.scratch/issue56/web'), evidence);
    await app.listen(port, '127.0.0.1');
    const login = async (email: string, root = origin) => {
      await page.goto(`${root}/terminal/emails`);
      await page.getByLabel('登录账号', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${email} 的账号菜单`, exact: true })).toBeVisible();
    };
    const logout = async (email: string) => {
      await page.getByRole('button', { name: `${email} 的账号菜单`, exact: true }).click();
      await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    };
    const post = async (path: string, body: unknown) => {
      const csrf = (await page.context().cookies()).find(row => row.name === 'identity_csrf')?.value ?? '';
      return page.request.post(`${origin}/api/${path}`, { data: body, headers: { Origin: origin, 'X-CSRF-Token': csrf } });
    };
    const screen = page.getByRole('region', { name: '本企业邮件发送记录', exact: true });
    const detail = page.getByRole('region', { name: '发送批次详情', exact: true });
    const row = (email: string) => detail.locator('.email-recipient').filter({ hasText: email });
    const observed: { path: string; body: unknown }[] = [];
    page.on('request', req => { if (req.url().includes('/api/email-') && req.method() === 'POST') observed.push({ path: new URL(req.url()).pathname, body: req.postDataJSON() }); });
    expect((await page.request.get(`${origin}/api/email-batches`)).status()).toBe(401);
    await login('admin@issue56.test');
    await page.goto(`${origin}/terminal/emails?batchId=${batchId}`);
    await expect(detail).toContainText(batchId); await expect(detail.locator('.email-recipient')).toHaveCount(3);
    await expect(row(failed.email)).toContainText('发送失败'); await expect(row(failed.email).getByRole('button')).toHaveCount(0);
    expect(senderCalls.length).toBe(3);
    expect((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [pausedId])).rows[0].status).toBe('paused');
    expect((await pool.query("SELECT reserved FROM email_daily_usage WHERE organization_id=$1 AND usage_day=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1", [org])).rows[0].reserved).toBe(0);
    await expect(detail.getByRole('link', { name: '查看企业档案' })).toHaveAttribute('href', `/terminal/profiles?id=${profileId}`);
    await page.reload(); await expect(detail).toContainText(batchId);
    await expect(page.locator('.console-breadcrumb')).toContainText('邮件发送记录');
    await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '邮件发送记录', exact: true })).toHaveAttribute('aria-current', 'page');
    await detail.getByRole('link', { name: '返回发送记录' }).click(); await expect(detail).toHaveCount(0);
    await page.goBack(); await expect(detail).toContainText(batchId);
    await page.goForward(); await expect(detail).toHaveCount(0);
    await page.goBack(); await expect(detail).toContainText(batchId);
    expect(senderCalls.length).toBe(3);
    await pool.query('ALTER TABLE email_batches RENAME TO issue56_unavailable_batches');
    await screen.getByRole('button', { name: '刷新记录' }).click();
    await expect(screen.getByRole('alert')).toBeVisible(); await expect(detail).toHaveCount(0);
    await pool.query('ALTER TABLE issue56_unavailable_batches RENAME TO email_batches');
    await screen.getByRole('button', { name: '刷新记录' }).click(); await expect(detail).toContainText(batchId);
    evidenceFails = true;
    await row(uncertain.email).getByRole('button', { name: '核对渠道证据' }).click();
    await expect(screen).toContainText('请求结果尚未确认');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '点数用量', exact: true }).click(); await expect(detail).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/terminal/usage`);
    await page.goBack(); await expect(screen).toContainText('请求结果尚未确认');
    expect(evidenceCalls.length).toBe(1); expect(senderCalls.length).toBe(3);
    evidenceFails = false;
    await screen.getByRole('button', { name: '查看原批次核实结果' }).click();
    await expect(screen).not.toContainText('请求结果尚未确认');
    await row(uncertain.email).getByRole('button', { name: '核对渠道证据' }).click();
    await expect(row(uncertain.email).getByRole('button', { name: '决定重发' })).toBeVisible();
    await row(uncertain.email).getByRole('button', { name: '决定重发' }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('button', { name: '明确重发', exact: true })).toHaveCount(0);
    expect(senderCalls.length).toBe(3);
    await page.route('**/api/email-recipients/retry', async route => {
      try { await route.fetch(); } catch { throw new Error('Controlled retry response could not be fetched'); }
      await route.abort('failed');
    }, { times: 1 });
    await row(uncertain.email).getByRole('button', { name: '决定重发' }).click();
    await page.getByRole('button', { name: '明确重发', exact: true }).click();
    await expect.poll(() => senderCalls.length).toBe(4);
    await expect(screen.getByRole('button', { name: '查看原批次核实结果' })).toBeEnabled();
    await expect(screen).toContainText('请求结果尚未确认');
    const child = (await pool.query('SELECT * FROM email_recipients WHERE parent_recipient_id=$1', [uncertain.id])).rows[0];
    expect(child).toMatchObject({ organization_id: org, profile_id: profileId, email: uncertain.email, status: 'accepted' });
    const original = (await pool.query('SELECT * FROM email_recipients WHERE id=$1', [uncertain.id])).rows[0];
    for (const field of ['batch_id', 'organization_id', 'profile_id', 'contact_id', 'mailsou_id', 'email', 'email_key', 'subject', 'content']) expect(child[field]).toBe(original[field]);
    expect(senderCalls[3]).toMatchObject({ recipientId: child.id, to: original.email, subject: original.subject, content: original.content, replyTo: 'reply@example.net' });
    await screen.getByRole('button', { name: '查看原批次核实结果' }).click();
    await expect(detail.locator('.email-recipient')).toHaveCount(4);
    expect((await post('email-recipients/retry', { recipientId: uncertain.id, confirmPossibleDuplicate: true })).status()).toBe(200);
    expect(senderCalls.length).toBe(4);
    expect((await post('email-recipients/retry', { recipientId: failed.id, confirmPossibleDuplicate: true })).status()).toBe(409);
    expect((await post('email-recipients/retry', { recipientId: uncertain.id, confirmPossibleDuplicate: false })).status()).toBe(400);
    await row(accepted.email).getByRole('button', { name: '核对渠道证据' }).click();
    await expect(row(accepted.email)).toContainText('有证据送达');
    await post('email-recipients/reconcile', { recipientId: accepted.id });
    expect((await pool.query('SELECT count(*)::int n FROM email_evidence_checks WHERE recipient_id=$1', [accepted.id])).rows[0].n).toBe(1);
    await page.goto(`${origin}/terminal/emails?batchId=${later.batchId}`); await expect(detail).toContainText('跨日暂停');
    await row('dup@example.com').getByRole('button', { name: '重新确认今日额度' }).click();
    await page.getByRole('button', { name: '确认今日额度', exact: true }).click();
    await expect(row('dup@example.com').getByRole('button', { name: '执行已重确认收件人' })).toBeVisible(); expect(senderCalls.length).toBe(4);
    expect((await post('email-recipients/reconfirm', { recipientId: pausedId, confirmUnsubscribeNotice: true, confirmQuota: true })).status()).toBe(409);
    await page.reload(); await expect(row('dup@example.com').getByRole('button', { name: '执行已重确认收件人' })).toBeVisible(); expect(senderCalls.length).toBe(4);
    await row('dup@example.com').getByRole('button', { name: '执行已重确认收件人' }).click();
    await expect(row('dup@example.com')).toContainText('已提交发信服务'); expect(senderCalls.length).toBe(5);
    expect((await post('email-recipients/execute', { recipientId: pausedId })).status()).toBe(201); expect(senderCalls.length).toBe(5);
    const quota = await service.quota(identity); expect([quota.reserved, quota.used]).toEqual([1, 3]);
    expect((await pool.query('SELECT count(*)::int n FROM company_contact_point_ledger')).rows[0].n).toBe(0);
    await logout('admin@issue56.test'); await login('sales@issue56.test');
    await page.goto(`${origin}/terminal/emails?batchId=${batchId}`); await expect(detail.locator('.email-recipient')).toHaveCount(4);
    expect((await post('email-recipients/retry', { recipientId: uncertain.id, confirmPossibleDuplicate: true })).status()).toBe(403);
    expect((await post('email-recipients/reconfirm', { recipientId: pausedId, confirmUnsubscribeNotice: true, confirmQuota: true })).status()).toBe(403);
    expect((await post('email-recipients/execute', { recipientId: pausedId })).status()).toBe(404);
    expect((await post('email-recipients/reconcile', { recipientId: accepted.id })).status()).toBe(200);
    let release: () => void = () => {};
    let captured: () => void = () => {};
    let completed: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const arrived = new Promise<void>(resolve => { captured = resolve; });
    const delivered = new Promise<void>(resolve => { completed = resolve; });
    await page.route('**/api/email-batches/detail', async route => {
      try {
        const response = await route.fetch(); captured(); await gate;
        await route.fulfill({ response }).catch(() => {});
      } catch { captured(); } finally { completed(); }
    }, { times: 1 });
    await screen.getByRole('button', { name: '刷新记录' }).click(); await arrived;
    await logout('sales@issue56.test'); await login('other@issue56.test');
    release(); await delivered;
    await page.goto(`${origin}/terminal/emails`); await expect(screen).toBeVisible();
    await expect(screen).not.toContainText(batchId); await expect(screen).not.toContainText(uncertain.email);
    await page.goto(`${origin}/terminal/emails?batchId=${batchId}`); await expect(screen).toContainText('发送批次不存在'); await expect(detail).toHaveCount(0);
    expect((await post('email-batches/detail', { batchId })).status()).toBe(404);
    for (const [action, body] of [['reconcile', { recipientId: uncertain.id }], ['retry', { recipientId: uncertain.id, confirmPossibleDuplicate: true }],
      ['reconfirm', { recipientId: pausedId, confirmUnsubscribeNotice: true, confirmQuota: true }], ['execute', { recipientId: pausedId }]] as const) expect((await post(`email-recipients/${action}`, body)).status()).toBe(404);
    await logout('other@issue56.test');
    for (const [email, path] of [['super_admin', '/platform/overview'], ['dist@issue56.test', '/distribution/organizations']]) {
      await login(email); await page.goto(`${origin}/terminal/emails?batchId=${batchId}`); await expect(page).toHaveURL(`${origin}${path}`);
      expect((await page.request.get(`${origin}/api/email-batches`)).status()).toBe(403); await expect(screen).toHaveCount(0); await logout(email);
    }
    await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [sales]);
    await login('sales@issue56.test'); await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible(); await expect(screen).toHaveCount(0);
    expect((await page.request.get(`${origin}/api/email-batches`)).status()).toBe(403);
    await logout('sales@issue56.test');
    await pool.query('UPDATE accounts SET must_change=false WHERE id=$1', [sales]);
    const vitePort = await freePort(); const backendPort = await freePort(); const devOrigin = `http://127.0.0.1:${vitePort}`;
    devApp = await createApplication(pool, devOrigin, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sender, undefined, resolve('.scratch/issue56/web'), evidence);
    await devApp.listen(backendPort, '127.0.0.1');
    vite = await createServer({ server: { host: '127.0.0.1', port: vitePort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${backendPort}` } } }); await vite.listen();
    await login('admin@issue56.test', devOrigin); await page.goto(`${devOrigin}/terminal/emails?batchId=${batchId}`);
    await expect(detail).toContainText(batchId); await page.reload(); await expect(detail).toContainText(batchId);
    expect(senderCalls.length).toBe(5);
    expect(await pointSnapshot()).toBe(beforePoints);
    expect(senderCalls[4]).toMatchObject({ recipientId: pausedId, to: recipients[0].email, subject: recipients[0].subject, content: recipients[0].content, replyTo: 'reply@example.net' });
    expect(observed).toEqual(expect.arrayContaining([
      { path: '/api/email-batches/detail', body: { batchId } },
      { path: '/api/email-recipients/reconcile', body: { recipientId: uncertain.id } },
      { path: '/api/email-recipients/retry', body: { recipientId: uncertain.id, confirmPossibleDuplicate: true } },
      { path: '/api/email-recipients/reconfirm', body: { recipientId: pausedId, confirmUnsubscribeNotice: true, confirmQuota: true } },
      { path: '/api/email-recipients/execute', body: { recipientId: pausedId } }
    ]));
    for (const root of [origin, devOrigin]) {
      expect((await page.request.get(`${root}/api/issue56-unknown`)).headers()['content-type']).not.toContain('text/html');
      expect((await page.request.get(`${root}/issue56-missing.js`)).status()).toBe(404);
    }
    const state = (await pool.query('SELECT id,batch_id,organization_id,profile_id,contact_id,mailsou_id,status,parent_recipient_id FROM email_recipients ORDER BY id')).rows;
    await writeFile(resolve('../docs/delivery/application/ISSUE-56-EVIDENCE.json'), JSON.stringify({ database: name, batchId, crossDayBatch: later.batchId, profileId, organizationId: org,
      recipientIds: { accepted: accepted.id, failed: failed.id, uncertain: uncertain.id, paused: pausedId, retry: child.id }, observed,
      senderCalls: senderCalls.map(row => ({ recipientId: row.recipientId, to: row.to, subject: row.subject, replyTo: row.replyTo })), evidenceCalls,
      quota, state, unchangedPointTables: pointTables,
      browser: { history: true, nestAndVite: true, unknownResponse: true, fourRoles: true, forcedChange: true, crossTenantDenied: true, lateSessionResponse: true, readFailureClearsStaleDetail: true } }, null, 2));
  } finally {
    await vite?.close(); await devApp?.close(); await app?.close(); await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
});
