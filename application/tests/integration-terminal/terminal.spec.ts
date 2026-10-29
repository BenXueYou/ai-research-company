import { selectCountry } from '../helpers/countrySelect.js';
import { test, expect } from '@playwright/test';
import { selectCountries } from '../helpers/countrySelect.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../../vite.config.js';
import { database, migrate } from '../../server/database.js';
import { createApplication } from '../../server/app.js';
import { hashPassword } from '../../server/identity/policy.js';
import { EmailPreviewService } from '../../server/email/email-preview.js';
import type { UMailMessage, DeliveryEvidenceRequest } from '../../server/email/email-send.js';
import type { ImporterNameInput } from '../../server/companies/product-search.js';

async function freePort() {
  const server = netServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

let duplicateHandoff: { linkCount: number; profileCount: number; queryState: string; queryId: string; profileId: string } | undefined;
test.describe.configure({ mode: 'serial' });

test('terminal cross-page acquisition, snapshot, settings, records, quota and session integration', async ({ page }) => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/^\/integration_terminal_[a-f0-9]+_test$/.test(new URL(url).pathname)) throw new Error('Random dedicated integration database required');
  const pool = database(url);
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const root = resolve('.scratch/integration-terminal');
  const origin = `http://127.0.0.1:${await freePort()}`;
  const password = 'Terminal-Integration-Fixture!';
  const listCalls: unknown[] = [], detailCalls: unknown[] = [], contactCalls: unknown[] = [];
  const sendCalls: Array<Omit<UMailMessage, 'attachments'>> = [];
  const channelCalls: unknown[] = [], evidenceCalls: DeliveryEvidenceRequest[] = [];
  const productCalls: ImporterNameInput[] = [];
  const importer = { buyerCountryFilterVerified: true as const, async importerNames(input: ImporterNameInput) {
    productCalls.push(input);
    return { content: [{ name: 'Terminal Buyer' }], page: input.pageNo, size: input.pageSize, total: 1, actualUpstreamPoints: '0.4321' };
  } };
  const requests: Array<{ path: string; body: unknown }> = [], errors: string[] = [];
  let contactTimeout = false;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: typeof app;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const list = { async listCompanies(input: { name: string; countryCodes: string; pageNo: number; pageSize: number }) {
    listCalls.push(input);
    return { content: [{ id: 'list-terminal-111', name: 'Terminal Buyer', country: 'TUR' }], page: input.pageNo, size: input.pageSize, total: 1 };
  } };
  const detail = { async detail(input: { name: string; countryCode3: string }) {
    detailCalls.push(input);
    return { data: { id: 'detail-data-222', countryCode3: 'TUR' }, actualUpstreamPoints: '0.3000' };
  } };
  const contacts = { async contacts(input: { companyName: string; positionTags: string[]; pageNo: number; pageSize: number }) {
    contactCalls.push(input);
    if (contactTimeout) throw new Error('Controlled integration contact timeout');
    return { data: { list: ['uncertain', 'accepted', 'failed'].map((state, index) => ({
      id: `contact-source-${index}`, fileId: `contact-file-${index}`, mailsouId: `mailsou-terminal-${index}`,
      companyName: 'Terminal Buyer', email: `${state}@terminal.test`, personalEmail: `personal-${state}@terminal.test`, positionTag: 'TECHNOLGY'
    })), pageNo: input.pageNo, pageSize: input.pageSize, total: 3 }, actualUpstreamPoints: '0.2500' };
  } };
  const umail = {
    async inspectResource(input: { organizationId: string; resourceId: string }) {
      return { ...input, resourceStatus: 'available' as const, detail: 'controlled integration resource', checkedAt: new Date() };
    },
    async inspectChannel(input: { organizationId: string; resourceId: string; domain: string; senderAddress: string }) {
      channelCalls.push(input);
      return { ...input, domainStatus: 'verified' as const, accountStatus: 'available' as const, dnsRecords: [], detail: 'controlled integration domain', checkedAt: new Date() };
    }
  };
  const sender = { async send(message: UMailMessage) {
    const { attachments: _attachments, ...safe } = message; sendCalls.push(safe);
    const state = sendCalls.length > 3 ? 'accepted' as const : message.to.startsWith('uncertain') ? 'uncertain' as const : message.to.startsWith('failed') ? 'not_submitted' as const : 'accepted' as const;
    return { state, detail: 'controlled integration result', organizationId: message.organizationId, resourceId: message.resourceId, recipientId: message.recipientId };
  } };
  const evidence = { async check(input: DeliveryEvidenceRequest) {
    evidenceCalls.push(input);
    return { ...input, finding: 'delivered' as const, evidenceId: `controlled-${input.recipientId}`, detail: 'controlled delivery evidence' };
  } };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() === 'POST' && !request.url().includes('/auth/')) {
      const body = request.postDataJSON();
      requests.push({ path: new URL(request.url()).pathname, body: body && typeof body === 'object' && 'credential' in body ? { ...body, credential: '[REDACTED]' } : body });
    }
  });
  const result: Record<string, unknown> = { database: new URL(url).pathname.slice(1), origin, mode: 'real Chromium/Nest/PostgreSQL; controlled vendors only' };
  try {
    await migrate(pool);
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const org = randomUUID(), foreignOrg = randomUUID();
    for (const id of [org, foreignOrg]) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'Integration terminal','terminal',$2,0,'fixture',$3,'***')`, [id, platform.organization_id, randomUUID()]);
    const accounts: Record<string, { id: string; email: string }> = {};
    for (const [label, role, organization] of [['admin', 'admin', org], ['sales', 'sales', org], ['foreign', 'admin', foreignOrg], ['temporary', 'sales', org]]) {
      accounts[label] = { id: randomUUID(), email: `${label}@integration-terminal.test` };
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '72 hours')`, [accounts[label].id, organization, accounts[label].email, hash, role, label === 'temporary']);
    }
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,20),($2,90)', [org, foreignOrg]);
    await pool.query('UPDATE platform_pricing SET coefficient=1');
    for (const [path, price] of [['/v2/company', 0.5], ['/v2/contact', 0.25], ['/v2/trade/importers-name', 0.5]]) await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES($1,$2,2,'controlled integration','controlled_test',$3,$4)`, [path, price, randomUUID(), platform.id]);
    await pool.query(`INSERT INTO umail_resources(organization_id,external_resource_id,resource_status,verification_detail,checked_at,configured_by)
      VALUES($1,'integration-resource-333','available','controlled',clock_timestamp(),$2)`, [org, platform.id]);
    const template = await new EmailPreviewService(pool).provision({ id: platform.id, organization_id: platform.organization_id,
      role: 'platform', email: null, username: 'super_admin', must_change: false, csrf_hash: '' },
    { name: 'Integration template', subject: 'Hello {{contactName}}', content: '{{companyName}}: {{contactName}}', attachments: [] }, async () => true);
    app = await createApplication(pool, origin, false, undefined, list, umail, detail, undefined, contacts, undefined, undefined, sender, resolve(root, 'web'), evidence);
    await app.listen(Number(new URL(origin).port), '127.0.0.1');
    async function login(label: string, base = origin) {
      await page.goto(`${base}/terminal/search`);
      await page.getByLabel('登录账号', { exact: true }).fill(accounts[label].email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      if (label === 'temporary') await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
      else await expect(page.getByRole('button', { name: `${accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
    }
    async function logout(label: string) {
      await page.getByRole('button', { name: `${accounts[label].email} 的账号菜单`, exact: true }).click();
      await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    }
    async function api(path: string, body?: Record<string, unknown>) {
      const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')?.value ?? '';
      const response = await page.request.fetch(`${origin}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'X-CSRF-Token': csrf }, data: body });
      return { status: response.status(), body: await response.json() };
    }
    const ledger = async () => (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [org])).rows[0];
    const usage = async () => (await pool.query("SELECT usage_day::text,reserved,used FROM email_daily_usage WHERE organization_id=$1 ORDER BY usage_day", [org])).rows;
    const pointSnapshot = async () => {
      const snapshot: Record<string, unknown> = {};
      for (const table of ['internal_point_accounts', 'platform_inventory', 'query_point_ledger', 'company_contact_point_ledger', 'product_search_ledger']) snapshot[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
      return JSON.stringify(snapshot);
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login('admin');
    const blockedProduct = await api('product-searches/quote', { productDesc: 'ceramic pump', buyerCountryCode3: 'TUR', startDate: '2026-01-01', endDate: '2026-06-30', pageNo: 1, pageSize: 20 });
    expect(blockedProduct.status).toBe(409);
    expect(blockedProduct.body.message).toContain('映射尚未核实');
    expect(await ledger()).toEqual({ balance: '20.0000', query_frozen: '0.0000' });
    result.countryMappingBlock = blockedProduct;
    await test.step('empty cached profiles to verified search and exact internal profile link', async () => {
      await page.getByRole('link', { name: '企业档案库', exact: true }).click();
      await expect(page.getByText('当前筛选下没有档案')).toBeVisible();
      await page.getByRole('link', { name: '找企业', exact: true }).click();
      const search = page.locator('.company-search');
      await page.locator('select[aria-label="搜索方式"]:visible').selectOption('company');
      await search.getByLabel('公司名称', { exact: true }).fill('Terminal');
      await selectCountries(page, search, 'TUR');
      await search.getByRole('button', { name: '免费查询', exact: true }).click();
      await search.getByRole('button', { name: '确认是该企业' }).click();
      await search.getByRole('button', { name: '查看详情报价' }).click();
      expect(detailCalls).toHaveLength(0);
      await search.getByRole('button', { name: '确认费用并查询详情' }).click();
      await expect(search.getByText('详情已入档，实际扣点 0.3000')).toBeVisible();
      await search.getByRole('link', { name: '打开已建档企业' }).click();
    });
    const saved = (await pool.query('SELECT * FROM company_profiles WHERE organization_id=$1', [org])).rows[0];
    const candidate = (await pool.query('SELECT * FROM company_candidates WHERE id=(SELECT candidate_id FROM company_detail_queries WHERE id=$1)', [saved.query_id])).rows[0];
    expect(new Set([org, accounts.admin.id, candidate.id, candidate.source_id, saved.id, saved.detail_id, saved.query_id]).size).toBe(7);
    expect(candidate.source_id).toBe('list-terminal-111'); expect(saved.detail_id).toBe('detail-data-222');
    await expect(page).toHaveURL(`${origin}/terminal/profiles?id=${saved.id}`);
    const profile = page.locator('.profile-detail:visible'), panel = profile.locator('.contact-panel'), composer = profile.locator('.email-composer');
    await expect(profile.getByRole('heading', { name: 'Terminal Buyer · TUR' })).toBeVisible();
    await panel.getByRole('button', { name: '查看第 1 页报价' }).click();
    await panel.getByRole('button', { name: '确认费用并查询本页' }).click();
    await expect(composer.getByText('来源 mailsou-terminal-0', { exact: true })).toBeVisible();
    const contactRows = (await pool.query('SELECT id,mailsou_id,source_payload FROM company_contacts WHERE profile_id=$1 ORDER BY mailsou_id', [saved.id])).rows;
    for (const [index, contact] of contactRows.entries()) {
      expect(contact.source_payload).toMatchObject({ id: `contact-source-${index}`, fileId: `contact-file-${index}`, mailsouId: `mailsou-terminal-${index}` });
      expect(new Set([contact.id, saved.id, contact.mailsou_id, contact.source_payload.id, contact.source_payload.fileId]).size).toBe(5);
    }
    expect(await ledger()).toEqual({ balance: '19.4500', query_frozen: '0.0000' });
    await test.step('configure channel then return to original profile without new lookup', async () => {
      await page.getByRole('link', { name: '团队发信设置', exact: true }).click();
      await page.locator('#umail-domain').fill('mail.integration-terminal.test');
      await page.locator('#umail-sender-address').fill('sender@mail.integration-terminal.test');
      await page.locator('#umail-reply-address').fill('reply@integration-terminal.test');
      await page.locator('.umail-form').getByRole('button', { name: '核验域名渠道并保存' }).click();
      await expect(page.getByTestId('umail-reply-address')).toHaveText('reply@integration-terminal.test');
      await page.goBack(); await expect(page).toHaveURL(`${origin}/terminal/profiles?id=${saved.id}`);
      expect([listCalls.length, detailCalls.length, contactCalls.length, sendCalls.length, channelCalls.length]).toEqual([1, 1, 1, 0, 1]);
    });
    await composer.locator('.el-form-item').filter({ hasText: '公共模板' }).locator('.el-select').click();
    await page.getByRole('option', { name: 'Integration template · v1' }).click();
    for (let i = 0; i < 3; i++) await composer.locator('.email-contact').filter({ hasText: `来源 mailsou-terminal-${i}` }).getByPlaceholder('本次联系人称呼（模板变量 contactName）').fill(`Buyer ${i}`);
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.getByRole('heading', { name: '本次预览 · 3 个去重邮箱' })).toBeVisible();
    await composer.getByRole('button', { name: '确认本次内容与收件人（不发送）' }).click();
    await expect(composer.getByRole('button', { name: '本次快照已确认' })).toBeVisible();
    expect(sendCalls).toHaveLength(0);
    const preview = (await pool.query('SELECT * FROM email_previews WHERE confirmed_at IS NOT NULL')).rows[0];
    await composer.locator('.email-send-confirmation .el-select').click();
    await page.getByRole('option', { name: 'U-Mail 域名 · reply@integration-terminal.test' }).click();
    await composer.getByText('已核对本批退订提示', { exact: true }).click();
    await composer.getByText('确认使用本企业今日额度', { exact: true }).click();
    await composer.getByRole('button', { name: '确认并执行本次单轮发送' }).click();
    await expect.poll(() => sendCalls.length).toBe(3);
    await expect(profile).toContainText('请求结果尚未确认');
    const batch = (await pool.query('SELECT * FROM email_batches WHERE organization_id=$1', [org])).rows[0];
    const recipients = (await pool.query('SELECT * FROM email_recipients WHERE batch_id=$1 ORDER BY email', [batch.id])).rows;
    expect(recipients.map(row => row.status)).toEqual(['accepted', 'not_submitted', 'uncertain']);
    for (const row of recipients) {
      const snap = preview.preview_snapshot.find((item: { email: string }) => item.email === row.email);
      expect(row).toMatchObject({ profile_id: saved.id, organization_id: org, contact_id: snap.contactId, mailsou_id: snap.mailsouId, subject: snap.subject, content: snap.content });
      expect(row.id).not.toBe(row.contact_id);
      expect(sendCalls.find(call => call.recipientId === row.id)).toMatchObject({ to: row.email, subject: snap.subject, content: snap.content, relpy_to: 'reply@integration-terminal.test' });
    }
    expect(await usage()).toMatchObject([{ reserved: 1, used: 1 }]);
    const beforeMailPoints = await pointSnapshot();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '邮件发送记录', exact: true }).click();
    await page.getByRole('link', { name: '查看逐收件人结果' }).click();
    const record = page.getByRole('region', { name: '发送批次详情', exact: true });
    await expect(record).toContainText(batch.id);
    await expect(record.getByRole('link', { name: '查看企业档案' })).toHaveAttribute('href', `/terminal/profiles?id=${saved.id}`);
    await page.reload(); await expect(record).toContainText(batch.id);
    await api('email-batches/execute', { batchId: batch.id }); expect(sendCalls).toHaveLength(3);
    await test.step('old-day uncertain and unexecuted batch share navigation but settle separate days', async () => {
      const nextPreview = randomUUID();
      await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
        SELECT $1,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,attachment_ids,recipient_snapshot,$2,clock_timestamp() FROM email_previews WHERE id=$3`, [nextPreview, JSON.stringify([preview.preview_snapshot[0]]), preview.id]);
      const confirmed = await api('email-batches/confirm', { previewId: nextPreview, channelId: batch.channel_id, confirmUnsubscribeNotice: true, confirmQuota: true });
      expect(confirmed.status).toBe(201);
      const laterId = confirmed.body.batchId;
      const queued = (await pool.query('SELECT * FROM email_recipients WHERE batch_id=$1', [laterId])).rows[0];
      await pool.query("UPDATE email_batches SET usage_day=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE organization_id=$1", [org]);
      await pool.query("UPDATE email_daily_usage SET usage_day=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE organization_id=$1", [org]);
      await pool.query("UPDATE email_usage_events SET usage_day=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE recipient_id IN (SELECT id FROM email_recipients WHERE organization_id=$1)", [org]);
      await page.getByRole('link', { name: '点数用量', exact: true }).click();
      await expect(page.getByRole('region', { name: '本企业点数用量', exact: true })).toContainText('19.4500');
      await page.getByRole('link', { name: '邮件发送记录', exact: true }).click();
      await page.getByRole('button', { name: '刷新记录', exact: true }).click();
      expect((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [queued.id])).rows[0].status).toBe('paused');
      expect((await usage())[0]).toMatchObject({ reserved: 1, used: 1 });
      await page.goto(`${origin}/terminal/emails?batchId=${laterId}`);
      await record.getByRole('button', { name: '重新确认今日额度' }).click();
      await page.getByRole('button', { name: '确认今日额度', exact: true }).click();
      await expect(record.getByRole('button', { name: '执行已重确认收件人' })).toBeVisible();
      expect(sendCalls).toHaveLength(3);
      await page.reload(); expect(sendCalls).toHaveLength(3);
      await record.getByRole('button', { name: '执行已重确认收件人' }).click();
      await expect.poll(() => sendCalls.length).toBe(4);
      await api('email-recipients/execute', { recipientId: queued.id }); expect(sendCalls).toHaveLength(4);
      await page.goto(`${origin}/terminal/emails?batchId=${batch.id}`);
      const uncertain = recipients.find(row => row.status === 'uncertain');
      await record.locator('.email-recipient').filter({ hasText: uncertain.email }).getByRole('button', { name: '核对渠道证据' }).click();
      await expect(record.locator('.email-recipient').filter({ hasText: uncertain.email })).toContainText('有证据送达');
      expect(evidenceCalls).toHaveLength(1); expect(sendCalls).toHaveLength(4);
      expect(await usage()).toMatchObject([{ reserved: 0, used: 2 }, { reserved: 0, used: 1 }]);
      result.crossDay = { queuedRecipientId: queued.id, laterBatchId: laterId, originalUncertainId: uncertain.id, usage: await usage() };
    });
    expect(await pointSnapshot()).toBe(beforeMailPoints);
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    const report = page.getByRole('region', { name: '本企业点数用量', exact: true });
    await expect(report).toContainText(saved.query_id);
    const contactQuery = (await pool.query('SELECT id FROM company_contact_queries WHERE profile_id=$1', [saved.id])).rows[0].id;
    await expect(report).toContainText(contactQuery);
    await page.getByRole('button', { name: `${accounts.admin.email} 的账号菜单` }).click();
    await page.getByRole('menuitem', { name: '账号设置' }).click();
    await expect(page).toHaveURL(/account\/settings/);
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(report).toContainText(saved.query_id);
    expect(await pointSnapshot()).toBe(beforeMailPoints);
    await page.getByRole('link', { name: '成员管理', exact: true }).click();
    await expect(page.locator('.member-form')).toBeVisible();
    await page.getByLabel('成员姓名', { exact: true }).fill('Integration colleague');
    await page.getByLabel('成员登录邮箱', { exact: true }).fill('created@integration-terminal.test');
    await page.getByRole('button', { name: '确认创建成员', exact: true }).click();
    await expect(page.getByTestId('member-password')).toBeVisible();
    await page.getByRole('button', { name: '已保存，关闭凭据', exact: true }).click();
    await expect(page.getByTestId('member-password')).toHaveCount(0);
    await logout('admin'); await login('sales');
    await test.step('sales reads shared snapshot, cannot maintain or execute another sender, foreign tenant denied', async () => {
      await page.getByRole('link', { name: '团队发信设置', exact: true }).click();
      await expect(page.getByTestId('umail-reply-address')).toHaveText('reply@integration-terminal.test');
      await expect(page.locator('.sending-settings form')).toHaveCount(0);
      const deniedSettings = await api('sending-channels/umail', { domain: 'mail.integration-terminal.test', senderAddress: 'sender@mail.integration-terminal.test', replyAddress: 'other@terminal.test', defaultChannel: false, requestId: randomUUID() });
      expect(deniedSettings.status).toBe(403);
      await page.getByRole('link', { name: '成员管理', exact: true }).click();
      await expect(page.locator('.member-form')).toHaveCount(0);
      expect((await api('members')).status).toBe(403);
      await page.goto(`${origin}/terminal/emails?batchId=${batch.id}`);
      await expect(record).toContainText(batch.id);
      expect((await api('email-batches/execute', { batchId: batch.id })).status).toBe(404);
      await record.getByRole('link', { name: '查看企业档案' }).click();
      await expect(profile.getByRole('heading', { name: 'Terminal Buyer · TUR' })).toBeVisible();
      await expect(composer.getByRole('heading', { name: /本次预览/ })).toHaveCount(0);
      await logout('sales'); await login('foreign');
      expect((await api('company-contacts/profile', { profileId: saved.id })).status).toBe(404);
      expect((await api('email-batches/detail', { batchId: batch.id })).status).toBe(404);
      await page.goto(`${origin}/terminal/profiles?id=${saved.id}`);
      await expect(profile).toHaveCount(0);
      await page.getByRole('link', { name: '点数用量', exact: true }).click();
      await expect(report).toContainText('90.0000'); await expect(report).not.toContainText(saved.query_id);
      await logout('foreign'); await login('sales');
    });
    await test.step('unknown contact update survives navigation without replay and frozen points reach usage', async () => {
      await page.goto(`${origin}/terminal/profiles?id=${saved.id}`);
      contactTimeout = true;
      await panel.getByRole('button', { name: '主动更新当前职位第 1 页' }).click();
      await panel.getByRole('button', { name: '再次确认费用并更新本页', exact: true }).click();
      await expect(profile).toContainText('结果确认中');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('link', { name: '点数用量', exact: true }).click();
      await expect(report).toContainText('0.5000');
      await page.goBack(); await expect(profile).toContainText('结果确认中');
      expect([listCalls.length, detailCalls.length, contactCalls.length, sendCalls.length]).toEqual([1, 1, 2, 4]);
      expect(await ledger()).toEqual({ balance: '19.4500', query_frozen: '0.5000' });
    });
    // Development history is checked with a separate same-origin backend; vendors remain controlled.
    const devOrigin = `http://127.0.0.1:${await freePort()}`;
    devApp = await createApplication(pool, devOrigin, false, undefined, list, umail, detail, undefined, contacts, importer, undefined, sender, resolve(root, 'web'), evidence);
    const backendPort = await freePort(); await devApp.listen(backendPort, '127.0.0.1');
    vite = await createServer(mergeConfig(viteConfig, { configFile: false, server: { host: '127.0.0.1', port: Number(new URL(devOrigin).port), strictPort: true, watch: { ignored: ['**/.scratch/**'] }, proxy: { '/api': `http://127.0.0.1:${backendPort}` } } }));
    await vite.listen();
    page.once('dialog', dialog => dialog.accept());
    await page.goto(devOrigin); await page.context().clearCookies(); await login('sales', devOrigin);
    for (const path of [`/terminal/profiles?id=${saved.id}`, `/terminal/emails?batchId=${batch.id}`, '/terminal/sending-settings', '/terminal/members', '/terminal/usage']) {
      await page.goto(`${devOrigin}${path}`); await page.reload(); await expect(page).toHaveURL(`${devOrigin}${path}`);
      await expect(page.locator('.console-breadcrumb')).toBeVisible();
    }
    await test.step('controlled product list reaches independently confirmed detail, duplicate upstream identity is observed', async () => {
      await page.getByRole('link', { name: '找企业', exact: true }).click();
      const product = page.locator('.product-search');
      await page.locator('select[aria-label="搜索方式"]:visible').selectOption('product');
      await product.getByLabel('产品词', { exact: true }).fill('ceramic pump');
      await selectCountry(page, product, 'TUR');
      await product.getByLabel('贸易开始日期').fill('2026-01-01');
      await product.getByLabel('贸易结束日期').fill('2026-06-30');
      await product.getByRole('button', { name: '查看第 1 页报价' }).click();
      expect(productCalls).toHaveLength(0);
      await product.getByRole('button', { name: '确认本页费用并查询' }).click();
      await expect(product.getByText('Terminal Buyer', { exact: true })).toBeVisible();
      await product.getByRole('button', { name: '免费核实企业身份' }).click();
      await product.getByRole('button', { name: '确认是该企业' }).click();
      await product.getByRole('button', { name: '查看详情报价' }).click();
      // A new candidate is a separate authorization under the existing service contract.
      await expect(product.getByRole('button', { name: '另行确认详情费用并建档' })).toBeVisible();
      await product.getByRole('button', { name: '另行确认详情费用并建档' }).click();
      await expect(product.getByText('企业已建档，详情扣点 0.3000；名单费独立结算')).toBeVisible();
      await expect(product.getByLabel('产品词', { exact: true })).toBeEnabled();
      const duplicateQuery = (await pool.query("SELECT id,state FROM company_detail_queries WHERE organization_id=$1 AND id<>$2 AND state='settled' ORDER BY created_at DESC LIMIT 1", [org, saved.query_id])).rows[0];
      const profileCount = (await pool.query('SELECT count(*)::int n FROM company_profiles WHERE organization_id=$1', [org])).rows[0].n;
      duplicateHandoff = { linkCount: await product.getByRole('link', { name: '进入企业档案 · Terminal Buyer' }).count(), profileCount, queryState: duplicateQuery.state, queryId: duplicateQuery.id, profileId: saved.id };
      result.duplicateHandoff = duplicateHandoff;
      expect(detailCalls).toHaveLength(2);
      expect(productCalls).toEqual([{ catalog: 'imports', productDesc: 'ceramic pump', buyerCountryCode3: 'TUR', startDate: '2026-01-01', endDate: '2026-06-30', pageNo: 1, pageSize: 20 }]);
      await page.getByRole('link', { name: '点数用量', exact: true }).click();
      await expect(report).toContainText('18.7179');
      const productPage = (await pool.query('SELECT id FROM product_search_pages WHERE organization_id=$1', [org])).rows[0].id;
      await expect(report).toContainText(productPage);
      result.productPageId = productPage;
    });
    expect([listCalls.length, detailCalls.length, contactCalls.length, sendCalls.length, channelCalls.length]).toEqual([2, 2, 2, 4, 1]);
    expect(await ledger()).toEqual({ balance: '18.7179', query_frozen: '0.5000' });
    result.pointSnapshot = JSON.parse(await pointSnapshot());
    expect(errors).toEqual([]);
    Object.assign(result, { saved: { profileId: saved.id, detailId: saved.detail_id, queryId: saved.query_id, candidateId: candidate.id, listSourceId: candidate.source_id }, contacts: contactRows,
      templateId: template.templateId, batchId: batch.id, recipients: recipients.map(({ id, contact_id, mailsou_id, email, subject, content, status }) => ({ id, contact_id, mailsou_id, email, subject, content, initialStatus: status })),
      ledger: await ledger(), listCalls, detailCalls, contactCalls, productCalls, sendCalls, channelCalls, evidenceCalls, requests, errors, devOrigin,
      executionCompleted: true, acceptance: duplicateHandoff?.linkCount === 1 ? 'passed' : 'blocked: settled duplicate product detail has no profile link' });
    await writeFile(resolve('..', 'docs/delivery/application/TERMINAL-INTEGRATION-EVIDENCE.json'), JSON.stringify(result, null, 2));
  } finally {
    await vite?.close(); await devApp?.close(); await app?.close(); await pool.end();
  }
});

test('settled product detail with an existing upstream identity exposes its internal profile link', async () => {
  expect(duplicateHandoff, 'The preceding real-browser scenario must finish').toBeDefined();
  expect(duplicateHandoff!.queryState).toBe('settled');
  expect(duplicateHandoff!.profileCount).toBe(1);
  expect(duplicateHandoff!.linkCount, 'Settled detail data.id matches the existing profile, but the product page has no internal profile link').toBe(1);
});
