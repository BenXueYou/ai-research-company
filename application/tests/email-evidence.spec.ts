import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../server/app.js';
import { EmailPreviewService } from '../server/email-preview.js';
import { SmtpChannelService } from '../server/smtp-channel.js';
import { hashPassword } from '../server/policy.js';
import { testDatabase } from './helpers.js';

test('T24 浏览器核对证据并确认可能重复后手动重发', async ({ page }) => {
  const { pool } = await testDatabase();
  const origin = 'http://127.0.0.1:3144';
  let originalRecipientId = '';
  let sends = 0;
  const platformOrg = randomUUID();
  const platformActor = randomUUID();
  const org = randomUUID();
  const actor = randomUUID();
  const search = randomUUID();
  const candidate = randomUUID();
  const detail = randomUUID();
  const profile = randomUUID();
  const query = randomUUID();
  const contact = randomUUID();
  const templateName = `Browser Intro ${randomUUID()}`;
  const password = 'browser-preview-password-2026';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, { async send(message) {
      sends++;
      return { state: sends === 1 ? 'uncertain' as const : 'accepted' as const, detail: 'controlled result',
        organizationId: message.organizationId, resourceId: message.resourceId, recipientId: message.recipientId };
    } }, resolve('.scratch/t24-web'), { async check(request) {
      return { organizationId: request.organizationId, recipientId: request.recipientId, resourceId: request.resourceId,
        finding: request.recipientId === originalRecipientId ? 'unknown' as const : 'delivered' as const,
        evidenceId: request.recipientId === originalRecipientId ? null : 'controlled-delivery-proof',
        detail: 'controlled channel evidence' };
    } });
  await app.listen(3144, '127.0.0.1');
  try {
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'Platform','platform')", [platformOrg]);
    await pool.query("INSERT INTO accounts(id,organization_id,username,password_hash,role,must_change) VALUES($1,$2,'super_admin',$3,'platform',false)",
      [platformActor, platformOrg, await hashPassword(password)]);
    await pool.query('INSERT INTO bootstrap_marker(account_id) VALUES($1)', [platformActor]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'Team','terminal',$2,'encrypted','t21-browser-phone','***')`, [org, platformOrg]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'preview-browser@example.com',$3,'admin',false)`, [actor, org, await hashPassword(password)]);
    const channel = new SmtpChannelService(pool, Buffer.from(process.env.SMTP_CREDENTIAL_KEY!, 'hex'), {
      async verify() { return { state: 'available', detail: 'controlled' }; }
    });
    await channel.configure({ id: actor, organization_id: org, email: 'preview-browser@example.com', username: null,
      role: 'admin', must_change: false, csrf_hash: '' }, {
      host: 'smtp.example.com', port: 465, security: 'tls', username: 'sender@example.com',
      credential: 'controlled-secret', replyTo: 'reply@example.net', defaultChannel: true, requestId: randomUUID()
    });
    const umailChannelId = randomUUID();
    await pool.query(`INSERT INTO umail_resources(organization_id,external_resource_id,resource_status,
      verification_detail,checked_at,configured_by) VALUES($1,'browser-resource','available','controlled',clock_timestamp(),$2)`,
    [org, platformActor]);
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,reply_to,verification_state,
      verification_detail,verified_at,updated_by,umail_domain,umail_sender_address,umail_domain_status,
      umail_account_status,umail_dns_records) VALUES($1,$2,'UMAIL','umail-reply@example.net','available',
      'controlled',clock_timestamp(),$3,'send.example.com','sender@send.example.com','verified','available','[]')`,
    [umailChannelId, org, actor]);
    const service = new EmailPreviewService(pool);
    await service.provision({ id: platformActor, organization_id: platformOrg, email: null, username: 'super_admin',
      role: 'platform', must_change: false, csrf_hash: '' },
    { name: templateName, subject: 'Hi {{contactName}}', content: '{{companyName}}: {{contactName}}' }, async () => true);
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'Search','TUR',1,20,1,'verified')`, [search, org, actor]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'list-id-browser','Browser Company','TUR','verified')`, [candidate, search, org]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,
      coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Browser Company','TUR',1,1,$5,'settled')`,
    [detail, org, actor, candidate, randomUUID()]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'detail-data-browser','Browser Company','TUR','{}',$3)`, [profile, org, detail]);
    await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,
      page_no,page_size,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'Browser Company','{}',1,20,1,1,$5,'settled')`, [query, org, actor, profile, randomUUID()]);
    await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,
      returned_company_name,ownership_status,email,personal_email,source_payload)
      VALUES($1,$2,$3,$4,'mailsou-browser','Browser Company','Other Company','pending','company@browser.example',
      'personal@browser.example',$5)`, [contact, org, profile, query,
      JSON.stringify({ mailsouId: 'mailsou-browser', id: 'different-id-browser', fileId: 'different-file-browser' })]);
    await page.goto(origin);
    await page.getByLabel('登录账号', { exact: true }).fill('preview-browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('Browser Company · TUR').click();
    await expect(page.getByText('来源 mailsou-browser')).toBeVisible();
    await page.getByPlaceholder('逐条填写归属确认说明').fill('已向客户核实归属');
    await page.getByRole('button', { name: '确认该联系人归属' }).click();
    await expect(page.getByText('归属已说明：已向客户核实归属')).toBeVisible();
    await page.getByRole('combobox', { name: '公共模板' }).click();
    await page.getByText(`${templateName} · v1`).click();
    await page.locator('.email-contact').getByRole('combobox').click();
    await page.getByText('个人邮箱 personal@browser.example').last().click();
    await page.getByPlaceholder('本次联系人称呼（模板变量 contactName）').fill('Ava');
    await page.getByRole('button', { name: '保存并预览本次邮件' }).click();
    await expect(page.getByText('本次预览 · 1 个去重邮箱')).toBeVisible();
    await expect(page.getByText('personal@browser.example · 变量来源 mailsou-browser')).toBeVisible();
    await expect(page.getByText('主题：Hi Ava')).toBeVisible();
    await expect(page.getByText('Browser Company: Ava')).toBeVisible();
    await page.getByRole('button', { name: '确认本次内容与收件人（不发送）' }).click();
    await expect(page.getByText('本次内容与收件人已确认；尚未发送或占用日额度')).toBeVisible();
    await expect(page.getByText('本批 1 个去重邮箱；今日额度 2000')).toBeVisible();
    await page.locator('.email-send-confirmation .el-select').click();
    await page.getByText('U-Mail 域名 · umail-reply@example.net').last().click();
    await page.getByText('已核对本批退订提示').click();
    await page.getByText('确认使用本企业今日额度').click();
    await page.getByRole('button', { name: '确认并执行本次单轮发送' }).click();
    await expect(page.getByText('本次已执行，1 个收件人结果已记录；受理不代表送达')).toBeVisible();
    await page.getByRole('button', { name: '刷新记录' }).click();
    await expect(page.getByText('UMAIL · 1 封')).toBeVisible();
    const sent = (await pool.query('SELECT email,mailsou_id,contact_id,status FROM email_recipients')).rows[0];
    expect(sent).toMatchObject({ email: 'personal@browser.example', mailsou_id: 'mailsou-browser',
      contact_id: contact, status: 'uncertain' });
    const batch = (await pool.query('SELECT channel_id,channel_kind,umail_resource_id,reply_to FROM email_batches')).rows[0];
    expect(batch).toMatchObject({ channel_id: umailChannelId, channel_kind: 'UMAIL',
      umail_resource_id: 'browser-resource', reply_to: 'umail-reply@example.net' });
    const usage = (await pool.query('SELECT reserved,used FROM email_daily_usage WHERE organization_id=$1', [org])).rows[0];
    expect(usage).toMatchObject({ reserved: 1, used: 0 });
    const saved = (await pool.query('SELECT recipient_snapshot,preview_snapshot FROM email_previews')).rows[0];
    expect(saved.recipient_snapshot[0].contactId).toBe(contact);
    expect(saved.preview_snapshot[0].mailsouId).toBe('mailsou-browser');
    expect(saved.preview_snapshot[0].email).toBe('personal@browser.example');
    originalRecipientId = (await pool.query('SELECT id FROM email_recipients WHERE status=$1', ['uncertain'])).rows[0].id;
    await page.getByRole('button', { name: '查看逐收件人结果' }).click();
    await expect(page.getByText('结果待确认', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '核对渠道证据' }).click();
    await expect(page.getByRole('button', { name: '决定重发' })).toBeVisible();
    await page.getByRole('button', { name: '决定重发' }).click();
    await expect(page.getByText('可能重复发送', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '明确重发' }).click();
    await expect.poll(() => sends).toBe(2);
    const attempts = (await pool.query('SELECT id,email,mailsou_id,contact_id,status,parent_recipient_id FROM email_recipients ORDER BY submitted_at')).rows;
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({ email: attempts[0].email, mailsou_id: attempts[0].mailsou_id,
      contact_id: attempts[0].contact_id, parent_recipient_id: attempts[0].id, status: 'accepted' });
    await expect(page.getByRole('button', { name: '核对渠道证据' })).toHaveCount(2);
    await page.locator('.email-send-record li').filter({ hasText: '人工重发' })
      .getByRole('button', { name: '核对渠道证据' }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM email_recipients WHERE id=$1',
      [attempts[1].id])).rows[0].status).toBe('delivered');
    await expect(page.getByText('有证据送达 1', { exact: false })).toBeVisible();
    expect((await pool.query('SELECT reserved,used FROM email_daily_usage WHERE organization_id=$1', [org])).rows[0])
      .toMatchObject({ reserved: 1, used: 1 });
  } finally {
    await app.close();
    await pool.end();
  }
});


