import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../vite.config.js';

test('Issue52 real profiles, isolation, maintenance, attachments and paid refresh lifecycle', async ({ page, browser }) => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const pool = database(url);
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const root = resolve('.scratch/issue52');
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'scanner.mjs'), 'process.exit(0);');
  process.env.COMPANY_ATTACHMENT_STORAGE_DIR = resolve(root, 'private');
  process.env.COMPANY_ATTACHMENT_SCANNER = process.execPath;
  process.env.COMPANY_ATTACHMENT_SCANNER_ARGS = JSON.stringify([resolve(root, 'scanner.mjs')]);
  const origin = 'http://127.0.0.1:3252';
  const password = 'Issue52-test-password!';
  const vendorCalls: Array<{ name: string; countryCode3: string }> = [];
  let vendorPending = false;
  let vendorGate: Promise<void> | undefined;
  let releaseVendor: (() => void) | undefined;
  const vendor = { detail: async (input: { name: string; countryCode3: string }) => {
    vendorCalls.push(input);
    if (vendorGate) await vendorGate;
    if (vendorPending) throw new Error('Controlled vendor timeout');
    return { data: { id: 'upstream-detail-updated', countryCode3: 'TUR', website: 'https://fixture.example' }, actualUpstreamPoints: '0.2500' };
  } };
  await migrate(pool);
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, vendor, undefined, undefined,
    undefined, undefined, undefined, resolve(root, 'web'));
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
      const account = { id: randomUUID(), email: `${label}@issue52.test`, org };
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
    const contactId = randomUUID(); const contactQuery = randomUUID(); const templateId = randomUUID();
    await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'Chosen Company','{}',1,20,1,1,$5,'settled')`, [contactQuery, orgA, accounts.admin.id, saved.id, randomUUID()]);
    await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,returned_company_name,ownership_status,email,source_payload)
      VALUES($1,$2,$3,$4,'upstream-mailsou-52','Chosen Company','Chosen Company','matched','contact@issue52.test','{}')`, [contactId, orgA, saved.id, contactQuery]);
    await pool.query("INSERT INTO public_templates(id,name,current_version) VALUES($1,'Issue52 template',1)", [templateId]);
    await pool.query("INSERT INTO public_template_versions(template_id,version,subject,content,created_by) VALUES($1,1,'Hello {{companyName}}','Dear {{contactName}}',$2)", [templateId, platform.id]);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,10),($2,10)', [orgA, orgB]);
    await pool.query('UPDATE platform_pricing SET coefficient=1');
    const login = async (label: string, path = `/terminal/profiles?id=${saved.id}`) => {
      await page.context().clearCookies();
      await page.goto(`${origin}${path}`);
      await page.getByLabel('登录账号', { exact: true }).fill(label === 'platform' ? 'super_admin' : accounts[label].email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${label === 'platform' ? 'super_admin' : accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
      await page.goto(`${origin}${path}`);
    };
    const post = async (path: string, body: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('identity_csrf='))?.slice(14) ?? '';
      const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body });
    await app.listen(3252, '127.0.0.1');
    await login('admin');
    const detail = page.locator('.profile-detail:visible');
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    await expect(page.locator('.company-search')).toHaveCount(0);
    await expect(page.getByText('Foreign Company · TUR')).toHaveCount(0);
    expect(vendorCalls).toHaveLength(0);
    await page.reload();
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    if (process.env.ISSUE52_VISUAL_CHECK === '1') {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.screenshot({ path: resolve(root, 'profiles-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(root, 'profiles-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await detail.locator('.contact-panel').screenshot({ path: resolve(root, 'contacts-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await detail.locator('.contact-panel').screenshot({ path: resolve(root, 'contacts-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    const composer = detail.locator('.email-composer');
    await expect(composer.getByText('来源 upstream-mailsou-52', { exact: true })).toBeVisible();
    await composer.locator('.el-form-item').filter({ hasText: '公共模板' }).locator('.el-select').click();
    await page.getByRole('option', { name: 'Issue52 template · v1' }).click();
    await composer.getByPlaceholder('本次联系人称呼（模板变量 contactName）').fill('Buyer');
    await composer.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(composer.getByRole('heading', { name: '本次预览 · 1 个去重邮箱' })).toBeVisible();
    await composer.getByRole('button', { name: '确认本次内容与收件人（不发送）' }).click();
    await expect(composer.getByRole('button', { name: '本次快照已确认' })).toBeVisible();
    const draft = (await pool.query('SELECT profile_id,selections FROM email_drafts WHERE organization_id=$1', [orgA])).rows[0];
    expect(draft.profile_id).toBe(saved.id); expect(draft.selections[0].contactId).toBe(contactId);
    expect(draft.selections[0].emailKind).toBe('company');
    expect((await pool.query('SELECT count(*)::int AS n FROM email_batches')).rows[0].n).toBe(0);
    const editor = detail.locator('[data-draft="editor"]');
    await editor.getByRole('textbox').first().fill('工业阀门');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: 'Second Company · TUR' }).click();
    await expect(page).toHaveURL(new RegExp(saved.id));
    await expect(editor.getByRole('textbox').first()).toHaveValue('工业阀门');
    await editor.locator('select').first().selectOption('following');
    await editor.locator('select').nth(1).selectOption('4');
    await editor.getByRole('textbox').last().fill('重点,出口');
    await editor.locator('input[type=datetime-local]').fill('2026-11-03T00:30');
    await editor.getByRole('button', { name: '保存补充' }).click();
    await expect(editor.getByText('档案补充已保存')).toBeVisible();
    expect((await pool.query('SELECT main_products,detail_id FROM company_profiles WHERE id=$1', [saved.id])).rows[0]).toEqual({ main_products: '工业阀门', detail_id: saved.detailId });
    const followUp = (await pool.query("SELECT (next_follow_up_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day FROM company_profiles WHERE id=$1", [saved.id])).rows[0].day;
    await page.getByLabel('跟进开始', { exact: true }).fill(followUp);
    await page.getByLabel('跟进结束', { exact: true }).fill(followUp);
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(page.getByRole('link', { name: 'Chosen Company · TUR' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Second Company · TUR' })).toHaveCount(0);
    await page.getByLabel('跟进开始', { exact: true }).fill('');
    await page.getByLabel('跟进结束', { exact: true }).fill('');
    await page.locator('.company-profiles > form select').selectOption('replied');
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(page.getByText('当前筛选下没有档案', { exact: true })).toBeVisible();
    await page.locator('.company-profiles > form select').selectOption('following');
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(page.getByRole('link', { name: 'Chosen Company · TUR' })).toBeVisible();
    await page.getByLabel('跟进开始', { exact: true }).fill('2026-11-03');
    await page.getByLabel('跟进结束', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '跟进日期范围无效' })).toBeVisible();
    await expect(page.getByText('当前筛选下没有档案', { exact: true })).toHaveCount(0);
    await page.getByLabel('跟进开始', { exact: true }).fill('');
    await page.getByLabel('跟进结束', { exact: true }).fill('');
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    expect((await pool.query('SELECT customer_status,star_rating,tags FROM company_profiles WHERE id=$1', [saved.id])).rows[0])
      .toEqual({ customer_status: 'following', star_rating: 4, tags: ['重点', '出口'] });
    await page.locator('.company-profiles > form select').selectOption('');
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(page.getByRole('link', { name: 'Second Company · TUR' })).toBeVisible();
    await editor.getByRole('textbox').first().fill('未提交修改');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: 'Second Company · TUR' }).click();
    await expect(detail.getByRole('heading', { name: 'Second Company · TUR' })).toBeVisible();
    await page.goBack();
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    await expect(editor.getByRole('textbox').first()).toHaveValue('工业阀门');
    await page.goForward();
    await expect(detail.getByRole('heading', { name: 'Second Company · TUR' })).toBeVisible();
    await page.goBack();
    const timeline = detail.locator('.timeline-panel');
    await timeline.locator('.el-form-item').filter({ hasText: '记录类型' }).locator('.el-select').click();
    await page.getByRole('option', { name: '备注', exact: true }).click();
    await timeline.getByLabel('发生时间').fill('2026-10-28T10:30');
    await timeline.getByLabel('摘要', { exact: true }).fill('Issue52 follow-up');
    await timeline.getByRole('button', { name: '登记记录' }).click();
    await expect(timeline.getByText('Issue52 follow-up', { exact: true })).toBeVisible();
    const record = (await pool.query('SELECT id,company_id,created_by FROM timeline_manual_records WHERE company_id=$1', [saved.id])).rows[0];
    expect(record.company_id).toBe(saved.id); expect(record.created_by).toBe(accounts.admin.id);
    const pdf = Buffer.from('%PDF-1.4\nIssue52 attachment\n');
    await timeline.locator('.attachment-panel').first().locator('input[type=file]').setInputFiles({ name: 'issue52.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(timeline.getByText('issue52.pdf', { exact: false })).toBeVisible();
    const attachment = (await pool.query('SELECT id,company_id FROM company_attachments WHERE company_id=$1', [saved.id])).rows[0];
    expect(attachment.company_id).toBe(saved.id);
    const download = page.waitForEvent('download');
    await timeline.getByRole('button', { name: '下载', exact: true }).click();
    expect(await readFile(await (await download).path() as string)).toEqual(pdf);
    await timeline.locator('.record-upload input[type=file]').setInputFiles({ name: 'record52.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(timeline.getByText('record52.pdf', { exact: false })).toBeVisible();
    const recordAttachment = (await pool.query('SELECT id,company_id,communication_id FROM company_attachments WHERE communication_id=$1', [record.id])).rows[0];
    expect(recordAttachment.company_id).toBe(saved.id); expect(recordAttachment.communication_id).toBe(record.id);
    expect(new Set([orgA, accounts.admin.id, saved.id, saved.query, saved.candidate, record.id, attachment.id, recordAttachment.id, contactId, contactQuery, templateId]).size).toBe(11);
    page.once('dialog', dialog => dialog.accept());
    await timeline.locator('.attachment-panel').first().getByRole('button', { name: '删除', exact: true }).click();
    await expect(timeline.getByText('issue52.pdf', { exact: false })).toHaveCount(0);
    expect((await pool.query('SELECT deleted_at IS NOT NULL AS deleted FROM company_attachments WHERE id=$1', [attachment.id])).rows[0].deleted).toBe(true);
    // A quote failure must remain visible and must not call the supplier.
    await detail.getByRole('button', { name: '主动更新企业详情', exact: true }).click();
    await expect(detail.getByRole('alert').filter({ hasText: '尚无已核实' })).toBeVisible();
    expect(vendorCalls).toHaveLength(0);
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/company',0.5,2,'Issue52 controlled fixture','controlled_test',$1,$2)`, [randomUUID(), platform.id]);
    await detail.getByRole('button', { name: '主动更新企业详情', exact: true }).click();
    await expect(detail.getByRole('button', { name: '再次确认费用并更新' })).toBeVisible();
    if (process.env.ISSUE52_VISUAL_CHECK === '1') {
      await detail.locator('.profile-source').screenshot({ path: resolve(root, 'refresh-quote-desktop.png') });
    }
    await detail.getByRole('button', { name: '取消', exact: true }).click();
    expect(vendorCalls).toHaveLength(0);
    await detail.getByRole('button', { name: '主动更新企业详情', exact: true }).click();
    vendorGate = new Promise<void>(resolve => { releaseVendor = resolve; });
    await detail.getByRole('button', { name: '再次确认费用并更新' }).click();
    await expect.poll(() => vendorCalls.length).toBe(1);
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(saved.id));
    releaseVendor!();
    vendorGate = undefined;
    await expect(detail.getByText('企业详情已更新，实际扣点 0.2500')).toBeVisible();
    expect(vendorCalls).toEqual([{ name: 'Chosen Company', countryCode3: 'TUR' }]);
    const settled = (await pool.query('SELECT detail_id,query_id FROM company_profiles WHERE id=$1', [saved.id])).rows[0];
    expect(settled.detail_id).toBe('upstream-detail-updated');
    expect((await post('company-details/execute', { queryId: settled.query_id })).status).toBe(200);
    expect(vendorCalls).toHaveLength(1);
    const account = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(account).toEqual({ balance: '9.7500', query_frozen: '0.0000' });
    expect((await post('company-profiles/update', { profileId: foreign.id, mainProducts: 'forbidden' })).status).toBe(404);
    expect((await post('company-attachments/download', { profileId: foreign.id, attachmentId: attachment.id })).status).toBe(404);
    expect((await post('company-profiles/list', { organizationId: orgB })).status).toBe(400);
    await login('sales');
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    await expect(detail.getByRole('button', { name: '软删除档案' })).toHaveCount(0);
    expect((await post('company-profiles/delete', { profileId: saved.id })).status).toBe(403);
    expect((await post('company-attachments/delete', { profileId: saved.id, attachmentId: attachment.id })).status).toBe(403);
    expect((await post('company-timeline/edit', { profileId: saved.id, recordId: record.id, type: 'note', eventTime: '2026-10-28T00:00:00.000Z', contactOrPhone: null, content: 'forbidden' })).status).toBe(403);
    await detail.locator('[data-draft=editor]').getByRole('textbox').first().fill('业务员维护');
    await detail.getByRole('button', { name: '保存补充' }).click();
    await expect(detail.getByText('档案补充已保存')).toBeVisible();
    await login('admin');
    await expect(detail.getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await detail.getByRole('button', { name: '软删除档案' }).click();
    await expect(page.getByRole('link', { name: 'Chosen Company · TUR' })).toHaveCount(0);
    await page.getByLabel('查看已删除').check();
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(detail.getByRole('button', { name: '恢复档案' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await detail.getByRole('button', { name: '恢复档案' }).click();
    await page.getByLabel('查看已删除').uncheck();
    await page.getByRole('button', { name: '筛选档案' }).click();
    await expect(detail.getByRole('button', { name: '主动更新企业详情' })).toBeVisible();
    await detail.getByRole('button', { name: '查看操作记录' }).click();
    await expect(detail.locator('.profile-history')).toHaveCount(4);
    await expect(detail.getByText('Issue52 follow-up', { exact: true })).toBeVisible();
    await expect(detail.getByText('record52.pdf', { exact: false })).toBeVisible();
    vendorPending = true;
    await detail.getByRole('button', { name: '主动更新企业详情' }).click();
    await detail.getByRole('button', { name: '再次确认费用并更新' }).click();
    await expect(detail.getByText('更新结果确认中，冻结保留；请勿重复发起')).toBeVisible();
    const beforeLeave = requests.filter(entry => entry.path.endsWith('/execute')).length;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await page.getByRole('link', { name: '企业档案库', exact: true }).click();
    await page.getByRole('link', { name: 'Chosen Company · TUR' }).click();
    await expect(detail.getByText('更新结果确认中，冻结保留；请勿重复发起')).toBeVisible();
    expect(requests.filter(entry => entry.path.endsWith('/execute'))).toHaveLength(beforeLeave);
    expect(vendorCalls).toHaveLength(2);
    await expect(detail.getByRole('button', { name: '再次确认费用并更新' })).toBeDisabled();
    const pending = (await pool.query("SELECT id FROM company_detail_queries WHERE refresh_profile_id=$1 AND state='pending'", [saved.id])).rows[0].id;
    expect((await post('company-details/execute', { queryId: pending })).body.state).toBe('pending');
    expect(vendorCalls).toHaveLength(2);
    const frozen = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(frozen).toEqual({ balance: '9.7500', query_frozen: '1.0000' });
    // New browser sessions prove direct role gates and tenant selection without sharing local page state.
    for (const label of ['foreign', 'platform', 'distributor', 'temporary']) {
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${origin}/terminal/profiles?id=${saved.id}`);
      await tab.getByLabel('登录账号', { exact: true }).fill(label === 'platform' ? 'super_admin' : accounts[label].email);
      await tab.getByLabel('密码', { exact: true }).fill(password);
      await tab.getByRole('button', { name: '登录', exact: true }).click();
      if (label !== 'temporary') {
        await expect(tab.getByRole('button', { name: `${label === 'platform' ? 'super_admin' : accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
        await tab.goto(`${origin}/terminal/profiles?id=${saved.id}`);
      }
      if (label === 'foreign') {
        await expect(tab.getByText('当前筛选下找不到本企业档案，请核对档案链接或调整筛选。')).toBeVisible();
        await expect(tab.getByRole('link', { name: 'Foreign Company · TUR' })).toBeVisible();
      } else if (label === 'temporary') await expect(tab.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
      else await expect(tab).not.toHaveURL(/terminal\/profiles/);
      await expect(tab.locator('.profile-detail:visible')).toHaveCount(0);
      const csrf = (await context.cookies()).find(cookie => cookie.name === 'identity_csrf')?.value ?? '';
      const denied = await context.request.post(`${origin}/api/company-profiles/history`, {
        headers: { Origin: origin, 'X-CSRF-Token': csrf }, data: { profileId: saved.id }
      });
      expect(denied.status()).toBe(label === 'foreign' ? 404 : 403);
      await context.close();
    }
    devApp = await createApplication(pool, 'http://127.0.0.1:3253', false, undefined, undefined, undefined, vendor,
      undefined, undefined, undefined, undefined, undefined, resolve(root, 'web'));
    await devApp.listen(3254, '127.0.0.1');
    vite = await createServer(mergeConfig(viteConfig, {
      configFile: false,
      server: { host: '127.0.0.1', port: 3253, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3254' } }
    }));
    await vite.listen();
    const devContext = await browser.newContext();
    await devContext.addCookies(await page.context().cookies());
    const devPage = await devContext.newPage();
    await devPage.goto(`http://127.0.0.1:3253/terminal/profiles?id=${saved.id}`);
    await expect(devPage.locator('.profile-detail:visible').getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    await devPage.reload();
    await expect(devPage.locator('.profile-detail:visible').getByRole('heading', { name: 'Chosen Company · TUR' })).toBeVisible();
    expect(vendorCalls).toHaveLength(2);
    await devContext.close();
    await writeFile(resolve(root, 'evidence.json'), JSON.stringify({ route: '/terminal/profiles', ids: { saved, second, foreign, record, attachment, recordAttachment, contactId, contactQuery, templateId }, vendorCalls, account, frozen, requests, passed: true }, null, 2));
  } finally {
    await vite?.close();
    await devApp?.close();
    await app.close();
    await pool.end();
  }
});
