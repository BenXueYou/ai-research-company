import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { EmailPreviewService } from '../server/email/email-preview.js';
import type { CompanyContactClient } from '../server/companies/company-contacts.js';
import type { UMailMessage } from '../server/email/email-send.js';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../vite.config.js';

test('Issue55 contacts, snapshots, permission and unknown send lifecycle', async ({ page, browser }) => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const pool = database(url);
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const root = resolve('.scratch/issue55');
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'scanner.mjs'), 'process.exit(0);');
  process.env.COMPANY_ATTACHMENT_STORAGE_DIR = resolve(root, 'private');
  process.env.COMPANY_ATTACHMENT_SCANNER = process.execPath;
  process.env.COMPANY_ATTACHMENT_SCANNER_ARGS = JSON.stringify([resolve(root, 'scanner.mjs')]);
  const origin = 'http://127.0.0.1:3255';
  const password = 'Issue55-test-password!';
  const vendorCalls: Parameters<CompanyContactClient['contacts']>[0][] = [];
  const sendCalls: Array<Omit<UMailMessage, 'attachments'> & { attachmentNames: string[] }> = [];
  let vendorPending = false;
  let omitSecondContact = false;
  const vendor: CompanyContactClient = { contacts: async input => {
    vendorCalls.push(input);
    if (vendorPending) throw new Error('Controlled contact timeout');
    return { data: { list: [
      { mailsouId: 'mailsou-55-a', id: 'source-id-a', fileId: 'source-file-a', companyName: 'Other Returned Company', email: 'Dup@issue55.test', personalEmail: 'personal@issue55.test', positionTag: 'TECHNOLGY' },
      { mailsouId: 'mailsou-55-b', id: 'source-id-b', fileId: 'source-file-b', companyName: 'Chosen Company', email: 'dup@issue55.test', personalEmail: 'second@issue55.test', positionTag: 'TECHNOLGY' }
    ].filter(item => !omitSecondContact || item.mailsouId !== 'mailsou-55-b'), pageNo: input.pageNo, pageSize: input.pageSize, total: 40 }, actualUpstreamPoints: '0.2500' };
  } };
  await migrate(pool);
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, undefined, vendor,
    undefined, undefined, { async send(message) {
      const { attachments, ...safe } = message;
      sendCalls.push({ ...safe, attachmentNames: attachments.map(item => item.fileName) });
      return { state: 'uncertain', detail: 'controlled timeout', organizationId: message.organizationId,
        resourceId: message.resourceId, recipientId: message.recipientId };
    } }, resolve(root, 'web'));
  const requests: Array<{ path: string; body: unknown }> = [];
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() === 'POST' && !request.url().includes('/auth/'))
      requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  try {
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const orgA = randomUUID(); const orgB = randomUUID(); const distributorOrg = randomUUID();
    for (const org of [orgA, orgB, distributorOrg]) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [org, org === orgA ? 'A' : 'B', org === distributorOrg ? 'distributor' : 'terminal', platform.organization_id, org === distributorOrg ? 1 : 0, randomUUID()]);
    const accounts: Record<string, { id: string; email: string; org: string }> = {};
    for (const [label, role, org] of [['admin', 'admin', orgA], ['sales', 'sales', orgA], ['foreign', 'admin', orgB], ['distributor', 'distributor', distributorOrg], ['temporary', 'sales', orgA]]) {
      const account = { id: randomUUID(), email: `${label}@issue55.test`, org };
      accounts[label] = account;
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '72 hours')`, [account.id, org, account.email, hash, role, label === 'temporary']);
    }
    const profile = async (org: string, actor: string, name: string) => {
      const search = randomUUID(); const candidate = randomUUID(); const query = randomUUID(); const id = randomUUID();
      await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
        VALUES($1,$2,$3,$4,'TUR',1,20,1,'verified')`, [search, org, actor, name]);
      await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
        VALUES($1,$2,$3,$4,$5,'TUR','verified')`, [candidate, search, org, `list-source-${candidate}`, name]);
      await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,$5,'TUR',1,1,$6,'settled')`, [query, org, actor, candidate, name, randomUUID()]);
      await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
        VALUES($1,$2,$3,$4,'TUR',$5,$6)`, [id, org, `upstream-detail-${id}`, name, JSON.stringify({ id: `upstream-detail-${id}` }), query]);
      return { id, query, candidate, org, actor, detailId: `upstream-detail-${id}` };
    };
    const saved = await profile(orgA, accounts.admin.id, 'Chosen Company');
    const second = await profile(orgA, accounts.admin.id, 'Second Company');
    const foreign = await profile(orgB, accounts.foreign.id, 'Foreign Company');
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,10),($2,10)', [orgA, orgB]);
    await pool.query('UPDATE platform_pricing SET coefficient=1');
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/contact',0.25,2,'issue55 fixture','controlled_test',$1,$2)`, [randomUUID(), platform.id]);
    const channelId = randomUUID();
    await pool.query(`INSERT INTO umail_resources(organization_id,external_resource_id,resource_status,verification_detail,checked_at,configured_by)
      VALUES($1,'issue55-resource','available','controlled',clock_timestamp(),$2)`, [orgA, platform.id]);
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,reply_to,verification_state,verification_detail,
      verified_at,updated_by,umail_domain,umail_sender_address,umail_domain_status,umail_account_status,umail_dns_records)
      VALUES($1,$2,'UMAIL','reply@issue55.test','available','controlled',clock_timestamp(),$3,'send.issue55.test',
      'sender@send.issue55.test','verified','available','[]')`, [channelId, orgA, accounts.admin.id]);
    const template = await new EmailPreviewService(pool).provision({ id: platform.id, organization_id: platform.organization_id,
      role: 'platform', email: null, username: 'super_admin', must_change: false, csrf_hash: '' },
    { name: 'Issue55 template', subject: 'Hello {{contactName}}', content: '{{companyName}}: {{contactName}}',
      attachments: [{ fileName: 'preset.txt', mimeType: 'text/plain', bytes: Buffer.from('preset-only') }] }, async () => true);
    const login = async (label: string) => {
      await page.context().clearCookies();
      await page.goto(origin);
      await page.getByLabel('登录账号', { exact: true }).fill(label === 'platform' ? 'super_admin' : accounts[label].email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      if (label === 'temporary') await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
      else await expect(page.getByRole('button', { name: `${label === 'platform' ? 'super_admin' : accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
    };
    const post = async (path: string, body: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('identity_csrf='))?.slice(14) ?? '';
      const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body });
    const ledger = async () => (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    await app.listen(3255, '127.0.0.1');
    await login('admin');
    console.info('Issue55: authenticated, checking quoted contact page');
    await page.goto(`${origin}/terminal/profiles?id=${saved.id}`);
    const detail = page.locator('.profile-detail:visible');
    const panel = detail.locator('.contact-panel');
    const composer = detail.locator('.email-composer');
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    await expect(page.locator('.company-search')).toHaveCount(0);
    expect(vendorCalls).toHaveLength(0);
    await panel.getByRole('button', { name: '查看第 1 页报价' }).click();
    await expect(panel.getByText('确认本页查询费用', { exact: true })).toBeVisible();
    expect(vendorCalls).toHaveLength(0);
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    expect(await ledger()).toEqual({ balance: '10.0000', query_frozen: '0.0000' });
    await panel.getByRole('button', { name: '查看第 1 页报价' }).click();
    await panel.getByRole('button', { name: '确认费用并查询本页' }).click();
    await expect(composer.getByText('来源 mailsou-55-a', { exact: true })).toBeVisible();
    expect(vendorCalls).toEqual([{ companyName: 'Chosen Company', positionTags: [], pageNo: 1, pageSize: 20 }]);
    expect(await ledger()).toEqual({ balance: '9.7500', query_frozen: '0.0000' });
    const firstQuery = (await pool.query("SELECT id FROM company_contact_queries WHERE profile_id=$1 AND state='settled'", [saved.id])).rows[0].id;
    await post('company-contacts/execute', { queryId: firstQuery });
    expect(vendorCalls).toHaveLength(1);
    await panel.getByRole('button', { name: '下一页报价' }).click();
    await expect(panel.getByText('确认本页查询费用', { exact: true })).toBeVisible();
    expect(vendorCalls).toHaveLength(1);
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    const contactRows = (await pool.query('SELECT id,mailsou_id,source_payload FROM company_contacts WHERE profile_id=$1 ORDER BY mailsou_id', [saved.id])).rows;
    console.info('Issue55: query charged once, checking ownership and dedup');
    const [a] = contactRows;
    expect(a.id).not.toBe(saved.id); expect(a.id).not.toBe(a.mailsou_id);
    expect(a.source_payload).toMatchObject({ id: 'source-id-a', fileId: 'source-file-a', mailsouId: 'mailsou-55-a' });
    const rowA = composer.locator('.email-contact').filter({ hasText: '来源 mailsou-55-a' });
    const rowB = composer.locator('.email-contact').filter({ hasText: '来源 mailsou-55-b' });
    await expect(rowA.getByPlaceholder('本次联系人称呼（模板变量 contactName）')).toHaveCount(0);
    await composer.locator('.el-form-item').filter({ hasText: '公共模板' }).locator('.el-select').click();
    await page.getByRole('option', { name: 'Issue55 template · v1' }).click();
    // Direct API cannot bypass pending ownership.
    const draftBody = { profileId: saved.id, templateId: template.templateId, templateVersion: 1,
      subject: 'Hello {{contactName}}', content: '{{companyName}}: {{contactName}}',
      selections: [{ contactId: a.id, emailKind: 'company', variables: { contactName: 'Ava' }, confirmUnsubscribed: false }] };
    const blockedDraft = await post('email-drafts', draftBody);
    expect(blockedDraft.status).toBe(200);
    expect((await post('email-drafts/preview', { draftId: blockedDraft.body.draftId })).status).toBe(409);
    await rowA.getByPlaceholder('逐条填写归属确认说明').fill('已逐条核实该联系人归属');
    await rowA.getByRole('button', { name: '确认该联系人归属' }).click();
    await expect(rowA.getByText('归属已说明：已逐条核实该联系人归属')).toBeVisible();
    await rowA.locator('.el-select').click();
    await page.getByRole('option', { name: '企业邮箱 Dup@issue55.test', exact: true }).click();
    await rowA.getByPlaceholder('本次联系人称呼（模板变量 contactName）').fill('Ava');
    await rowB.getByPlaceholder('本次联系人称呼（模板变量 contactName）').fill('Bea');
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.locator('.el-alert')).toBeVisible();
    await expect(composer.getByRole('heading', { name: /本次预览/ })).toHaveCount(0);
    const group = composer.locator('.search-summary').filter({ hasText: '同邮箱' });
    await group.locator('.el-select').click();
    await page.getByRole('option', { name: 'mailsou-55-b · Bea' }).click();
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.getByRole('heading', { name: '本次预览 · 1 个去重邮箱' })).toBeVisible();
    await expect(composer.getByText('主题：Hello Bea')).toBeVisible();
    const invalidBody = { ...draftBody, subject: '{{invalidVariable}}', selections: [draftBody.selections[0]] };
    const invalid = await post('email-drafts', invalidBody);
    expect(invalid.status).toBe(200);
    expect((await post('email-drafts/preview', { draftId: invalid.body.draftId })).status).toBe(409);
    await rowA.locator('.el-select').click();
    await page.getByRole('option', { name: '个人邮箱 personal@issue55.test', exact: true }).click();
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.getByRole('heading', { name: '本次预览 · 2 个去重邮箱' })).toBeVisible();
    await rowA.getByRole('button', { name: '标记本条联系人退订', exact: true }).click();
    await expect(rowA.getByPlaceholder('本次联系人称呼（模板变量 contactName）')).toHaveCount(0);
    await rowA.locator('.el-select').click();
    await page.getByRole('option', { name: '个人邮箱 personal@issue55.test', exact: true }).click();
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.locator('.el-alert')).toContainText('退订联系人须再次确认提示');
    await rowA.getByText('我已看到此条退订记录，仍选择该联系人').click();
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.getByRole('heading', { name: '本次预览 · 2 个去重邮箱' })).toBeVisible();
    expect(sendCalls).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM email_batches')).rows[0].n).toBe(0);
    await composer.getByRole('button', { name: '确认本次内容与收件人（不发送）' }).click();
    await expect(composer.getByRole('button', { name: '本次快照已确认' })).toBeVisible();
    const preview = (await pool.query('SELECT * FROM email_previews WHERE confirmed_at IS NOT NULL')).rows[0];
    console.info('Issue55: preview confirmed, checking quota and sending');
    expect((await post('email-batches/confirm', { previewId: preview.id, channelId, confirmUnsubscribeNotice: false, confirmQuota: true })).status).toBe(400);
    await pool.query('INSERT INTO organization_email_limits(organization_id,daily_limit,updated_by) VALUES($1,1,$2)', [orgA, platform.id]);
    expect((await post('email-batches/confirm', { previewId: preview.id, channelId, confirmUnsubscribeNotice: true, confirmQuota: true })).status).toBe(409);
    expect(sendCalls).toHaveLength(0);
    await pool.query('UPDATE organization_email_limits SET daily_limit=2000 WHERE organization_id=$1', [orgA]);
    await composer.locator('.email-send-confirmation .el-select').click();
    await page.getByRole('option', { name: 'U-Mail 域名 · reply@issue55.test' }).click();
    await composer.getByText('已核对本批退订提示', { exact: true }).click();
    await composer.getByText('确认使用本企业今日额度', { exact: true }).click();
    await composer.getByRole('button', { name: '确认并执行本次单轮发送' }).click();
    await expect(composer.getByText('本次已执行，2 个收件人结果待确认，预占保留；请在邮件发送记录核实，请勿重复发送')).toBeVisible();
    await expect(detail.getByText('请求结果尚未确认，已保留原请求，请勿重复提交。返回本档案核实结果。')).toBeVisible();
    expect(sendCalls).toHaveLength(2);
    const batch = (await pool.query('SELECT * FROM email_batches WHERE organization_id=$1', [orgA])).rows[0];
    const recipients = (await pool.query('SELECT id,email,contact_id,mailsou_id,subject,content,status FROM email_recipients WHERE batch_id=$1 ORDER BY email', [batch.id])).rows;
    expect(recipients.map(item => item.status)).toEqual(['uncertain', 'uncertain']);
    expect(recipients.find(item => item.email === 'personal@issue55.test')).toMatchObject({ contact_id: a.id, mailsou_id: a.mailsou_id, subject: 'Hello Ava' });
    expect(batch).toMatchObject({ channel_id: channelId, channel_kind: 'UMAIL', reply_to: 'reply@issue55.test', umail_sender_address: 'sender@send.issue55.test' });
    for (const message of sendCalls) {
      expect(message).toMatchObject({ organizationId: orgA, resourceId: 'issue55-resource', senderAddress: 'sender@send.issue55.test', relpy_to: 'reply@issue55.test', attachmentNames: ['preset.txt'] });
      expect(message.to).not.toBe(accounts.admin.email);
    }
    const usage = async () => (await pool.query('SELECT reserved,used FROM email_daily_usage WHERE organization_id=$1', [orgA])).rows[0];
    expect(await usage()).toEqual({ reserved: 2, used: 0 });
    expect(await ledger()).toEqual({ balance: '9.7500', query_frozen: '0.0000' });
    await post('email-batches/execute', { batchId: batch.id });
    console.info('Issue55: uncertain result retained, checking navigation');
    expect(sendCalls).toHaveLength(2);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: 'Second Company · TUR' }).click();
    await expect(page).toHaveURL(new RegExp(saved.id));
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: 'Second Company · TUR' }).click();
    await expect(page).toHaveURL(new RegExp(second.id));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(saved.id));
    await expect(composer.getByRole('button', { name: '本次已入队' })).toBeDisabled();
    page.once('dialog', dialog => dialog.accept());
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(second.id));
    await page.getByRole('link', { name: 'Chosen Company · TUR' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '邮件发送记录', exact: true }).click();
    await page.getByRole('link', { name: '企业档案库', exact: true }).click();
    await page.getByRole('link', { name: 'Chosen Company · TUR' }).click();
    await expect(composer.getByRole('button', { name: '本次已入队' })).toBeDisabled();
    expect(sendCalls).toHaveLength(2); expect(await usage()).toEqual({ reserved: 2, used: 0 });
    // Session lifecycle destroys uncertain page context only after explicit logout.
    await page.getByRole('button', { name: `${accounts.admin.email} 的账号菜单`, exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await login('sales');
    console.info('Issue55: logout/account switch, checking pending contact refresh');
    await page.goto(`${origin}/terminal/profiles?id=${saved.id}`);
    await expect(composer.getByRole('heading', { name: '本次预览 · 2 个去重邮箱' })).toHaveCount(0);
    expect((await post('email-batches/execute', { batchId: batch.id })).status).toBe(404);
    expect((await post('company-contacts/profile', { profileId: foreign.id })).status).toBe(404);
    expect((await post('company-contacts/profile', { profileId: saved.id, organizationId: orgB })).status).toBe(400);
    // Refresh requires a fresh quote; timeout retains original query and frozen balance.
    await panel.getByRole('button', { name: '主动更新当前职位第 1 页' }).click();
    await expect(panel.getByText('确认本次更新费用', { exact: true })).toBeVisible();
    expect(vendorCalls).toHaveLength(1);
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    await panel.getByRole('button', { name: '主动更新当前职位第 1 页' }).click();
    omitSecondContact = true;
    await panel.getByRole('button', { name: '再次确认费用并更新本页' }).click();
    await expect(panel.getByText('本次更新未返回；仅表示本次查询结果，不代表离职或邮箱失效')).toBeVisible();
    expect(vendorCalls).toHaveLength(2);
    expect((await pool.query('SELECT id,not_returned_in_last_update FROM company_contacts WHERE mailsou_id=$1', ['mailsou-55-b'])).rows[0])
      .toEqual({ id: contactRows[1].id, not_returned_in_last_update: true });
    expect(await ledger()).toEqual({ balance: '9.5000', query_frozen: '0.0000' });
    await panel.getByRole('button', { name: '主动更新当前职位第 1 页' }).click();
    vendorPending = true;
    await panel.getByRole('button', { name: '再次确认费用并更新本页' }).click();
    await expect(panel.getByText('结果确认中，冻结保留；请勿重复发起')).toBeVisible();
    const pending = (await pool.query("SELECT id FROM company_contact_queries WHERE profile_id=$1 AND state='pending'", [saved.id])).rows[0];
    await post('company-contacts/execute', { queryId: pending.id });
    expect(vendorCalls).toHaveLength(3);
    expect(await ledger()).toEqual({ balance: '9.5000', query_frozen: '0.5000' });
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    expect(vendorCalls).toHaveLength(3); expect(sendCalls).toHaveLength(2);
    for (const role of ['foreign', 'platform', 'distributor', 'temporary']) {
      await login(role);
      const denied = await post('company-contacts/profile', { profileId: saved.id });
      expect(denied.status).toBe(role === 'foreign' ? 404 : 403);
      expect((await post('email-batches/execute', { batchId: batch.id })).status).toBe(role === 'foreign' ? 404 : 403);
      await page.goto(`${origin}/terminal/profiles?id=${saved.id}`);
      await expect(page.getByText('来源 mailsou-55-a', { exact: true })).toHaveCount(0);
    }
    devApp = await createApplication(pool, 'http://127.0.0.1:3257', false);
    await devApp.listen(3256, '127.0.0.1');
    vite = await createServer(mergeConfig(viteConfig, { configFile: false, root: process.cwd(),
      server: { host: '127.0.0.1', port: 3257, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3256' } } }));
    await vite.listen();
    const devContext = await browser.newContext();
    const devPage = await devContext.newPage();
    try {
      await devPage.goto(`http://127.0.0.1:3257/terminal/profiles?id=${saved.id}`);
      await devPage.getByLabel('登录账号', { exact: true }).fill(accounts.sales.email);
      await devPage.getByLabel('密码', { exact: true }).fill(password);
      await devPage.getByRole('button', { name: '登录', exact: true }).click();
      await expect(devPage.getByRole('button', { name: `${accounts.sales.email} 的账号菜单`, exact: true })).toBeVisible();
      await devPage.goto(`http://127.0.0.1:3257/terminal/profiles?id=${saved.id}`);
      await expect(devPage.getByText('来源 mailsou-55-a', { exact: true })).toBeVisible();
      await devPage.reload();
      await expect(devPage.getByText('来源 mailsou-55-a', { exact: true })).toBeVisible();
      expect(sendCalls).toHaveLength(2); expect(vendorCalls).toHaveLength(3);
    } finally { await devContext.close(); }
    await writeFile(resolve('..', 'docs/delivery/application/ISSUE-55-EVIDENCE.json'), JSON.stringify({
      date: '2026-10-28', environment: { database: new URL(url).pathname.slice(1), httpPort: 3255, provider: 'controlled' },
      identifiers: { saved, second, foreign, contacts: contactRows, templateId: template.templateId, channelId, batchId: batch.id },
      requests, preview: { recipients: preview.recipient_snapshot, rendered: preview.preview_snapshot }, recipients, sendCalls,
      vendorCalls, balance: await ledger(), usage: await usage(), verdict: 'browser scenarios passed'
    }, null, 2));
  } finally {
    await vite?.close();
    await devApp?.close();
    await app.close();
    await pool.end();
  }
});
