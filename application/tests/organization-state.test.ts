import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { migrate } from '../server/database.js';
import { testDatabase } from './helpers.js';

test('T26 HTTP/PostgreSQL organization suspension preserves in-flight work and direct trading boundary', async () => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3196';
  const app = await createApplication(pool, origin);
  await app.listen(3196, '127.0.0.1');
  type Session = { cookie: string; csrf: string };
  const empty: Session = { cookie: '', csrf: '' };
  async function http(session: Session, path: string, body?: object) {
    return fetch(`${origin}/api/${path}`, { method: body ? 'POST' : 'GET', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf
    }, body: body ? JSON.stringify(body) : undefined });
  }
  async function login(email: string, password: string): Promise<Session> {
    const response = await http(empty, 'auth/login', { email, password });
    assert.equal(response.status, 200);
    const pairs = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return { cookie: pairs.join('; '), csrf: pairs.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  async function activate(email: string, password: string) {
    const session = await login(email, password);
    const next = 'OrgStatePwd123!';
    assert.equal((await http(session, 'auth/password', { currentPassword: password, newPassword: next, confirmPassword: next })).status, 200);
    return { session: await login(email, next), password: next };
  }
  let serial = 0;
  async function open(session: Session, kind: 'terminal' | 'distributor') {
    serial++;
    const response = await http(session, 'organizations', { name: `T26-${serial}`, kind, countryCode: '+86',
      phone: `1392600${String(serial).padStart(4, '0')}`, email: `t26-${serial}@example.com`, requestId: randomUUID() });
    assert.equal(response.status, 201);
    return response.json() as Promise<{ organizationId: string; accountId: string; email: string; temporaryPassword: string }>;
  }
  try {
    const platform = await activate('super_admin', 'init@Base123');
    const distributor = await open(platform.session, 'distributor');
    const distributorLogin = await activate(distributor.email, distributor.temporaryPassword);
    const grandchild = await open(distributorLogin.session, 'terminal');
    const grandchildLogin = await activate(grandchild.email, grandchild.temporaryPassword);
    const secondDistributor = await open(distributorLogin.session, 'distributor');
    const secondDistributorLogin = await activate(secondDistributor.email, secondDistributor.temporaryPassword);
    const terminalBelow = await open(secondDistributorLogin.session, 'terminal');
    const terminal = await open(platform.session, 'terminal');
    const terminalLogin = await activate(terminal.email, terminal.temporaryPassword);
    const platformId = (await pool.query("SELECT organization_id FROM accounts WHERE username='super_admin'")).rows[0].organization_id;
    await pool.query('UPDATE platform_inventory SET balance=10,frozen=0,reserved=0,average_cost=1');
    const orderResponse = await http(platform.session, 'point-orders', { requestId: randomUUID(), buyerId: terminal.organizationId,
      quantity: '2.0000', unitPrice: '1.1000' });
    assert.equal(orderResponse.status, 201);
    const orderId = (await orderResponse.json()).orderId;
    assert.equal((await http(platform.session, 'point-orders/confirm', { requestId: randomUUID(), orderId,
      receiptReference: 'T26-receipt-1' })).status, 201);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,5)', [terminal.organizationId]);
    const searchId = randomUUID();
    const candidateId = randomUUID();
    const queryId = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'Fixture','TUR',1,20,1,'verified')`, [searchId, terminal.organizationId, terminal.accountId]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'list-id-distinct','Fixture','TUR','verified')`, [candidateId, searchId, terminal.organizationId]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'Fixture','TUR',1,1,$5,'quoted')`, [queryId, terminal.organizationId, terminal.accountId, candidateId, randomUUID()]);
    const pendingId = randomUUID();
    const pendingCandidate = randomUUID();
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'another-list-id','Pending','TUR','verified')`, [pendingCandidate, searchId, terminal.organizationId]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'Pending','TUR',1,1,$5,'pending')`, [pendingId, terminal.organizationId, terminal.accountId, pendingCandidate, randomUUID()]);
    await pool.query('UPDATE internal_point_accounts SET query_frozen=1 WHERE organization_id=$1', [terminal.organizationId]);
    const profileId = randomUUID();
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'detail-id-distinct','Fixture','TUR','{}',$3)`, [profileId, terminal.organizationId, pendingId]);
    const templateId = randomUUID();
    const draftId = randomUUID();
    const previewId = randomUUID();
    const channelId = randomUUID();
    const batchId = randomUUID();
    const queuedId = randomUUID();
    const uncertainId = randomUUID();
    await pool.query("INSERT INTO public_templates(id,name,current_version) VALUES($1,$2,1)", [templateId, `T26-${templateId}`]);
    await pool.query("INSERT INTO public_template_versions(template_id,version,subject,content,created_by) VALUES($1,1,'S','B',$2)", [templateId, terminal.accountId]);
    await pool.query(`INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,selections)
      VALUES($1,$2,$3,$4,$5,1,'S','B','[]')`, [draftId, terminal.organizationId, terminal.accountId, profileId, templateId]);
    await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
      VALUES($1,$2,$3,$4,$5,$6,1,'S','B','{}','[]','[]',clock_timestamp())`, [previewId, draftId, terminal.organizationId, terminal.accountId, profileId, templateId]);
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,credential_encrypted,reply_to,verification_state,verification_detail,verified_at,updated_by)
      VALUES($1,$2,'SMTP','smtp.example.com',465,'ssl','sender','fixture','reply@example.com','available','fixture',clock_timestamp(),$3)`,
      [channelId, terminal.organizationId, terminal.accountId]);
    await pool.query(`INSERT INTO email_batches(id,preview_id,organization_id,actor_id,profile_id,channel_id,channel_kind,reply_to,usage_day,attachment_ids)
      VALUES($1,$2,$3,$4,$5,$6,'SMTP','reply@example.com',(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date,'{}')`,
      [batchId, previewId, terminal.organizationId, terminal.accountId, profileId, channelId]);
    const contactQueryId = randomUUID();
    const contactId = randomUUID();
    await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'Fixture','{}',1,20,1,1,$5,'settled')`, [contactQueryId, terminal.organizationId, terminal.accountId, profileId, randomUUID()]);
    await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,returned_company_name,ownership_status,email,source_payload)
      VALUES($1,$2,$3,$4,'mailsou-distinct','Fixture','Fixture','matched','Queued@Example.com','{}')`,
      [contactId, terminal.organizationId, profileId, contactQueryId]);
    await pool.query('UPDATE email_previews SET preview_snapshot=$2 WHERE id=$1', [previewId,
      JSON.stringify([{ email: 'queued@example.com', emailKey: 'queued@example.com', contactId,
        mailsouId: 'mailsou-distinct', sourceContactIds: [contactId], unsubscribedContactIds: [] }])]);
    for (const [id, status] of [[queuedId, 'queued'], [uncertainId, 'uncertain']])
      await pool.query(`INSERT INTO email_recipients(id,batch_id,organization_id,profile_id,email,email_key,contact_id,mailsou_id,subject,content,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,'mailsou-distinct','S','B',$8)`, [id, batchId, terminal.organizationId, profileId,
        `${status}@example.com`, `${status}@example.com`, contactId, status]);
    await pool.query(`INSERT INTO email_daily_usage(organization_id,usage_day,reserved)
      VALUES($1,(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date,2)`, [terminal.organizationId]);
    assert.equal((await http(distributorLogin.session, 'organizations/state', { organizationId: terminal.organizationId, active: false })).status, 403);
    const stopped = await http(platform.session, 'organizations/state', { organizationId: terminal.organizationId, active: false });
    assert.equal(stopped.status, 201);
    assert.equal((await stopped.json()).pausedRecipients, 1);
    assert.equal((await http(terminalLogin.session, 'workspace')).status, 401);
    assert.equal((await http(empty, 'auth/login', { email: terminal.email, password: terminalLogin.password })).status, 401);
    assert.equal((await http(platform.session, 'point-orders/transfer', { requestId: randomUUID(), orderId })).status, 409);
    assert.equal((await pool.query('SELECT reserved,balance FROM platform_inventory')).rows[0].reserved, '2.0000');
    assert.equal((await pool.query('SELECT status FROM point_orders WHERE id=$1', [orderId])).rows[0].status, 'reserved');
    assert.equal((await pool.query('SELECT state FROM company_detail_queries WHERE id=$1', [pendingId])).rows[0].state, 'pending');
    assert.equal((await pool.query('SELECT query_frozen,balance FROM internal_point_accounts WHERE organization_id=$1', [terminal.organizationId])).rows[0].query_frozen, '1.0000');
    assert.equal((await http(platform.session, 'company-details/final-failure', { queryId: pendingId,
      evidence: '停用期间核对原查询最终失败' })).status, 200);
    assert.equal((await pool.query('SELECT query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminal.organizationId])).rows[0].query_frozen, '0.0000');
    assert.equal((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [queuedId])).rows[0].status, 'paused');
    assert.equal((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [uncertainId])).rows[0].status, 'uncertain');
    assert.equal((await pool.query('SELECT reserved FROM email_daily_usage WHERE organization_id=$1', [terminal.organizationId])).rows[0].reserved, 1);
    assert.equal((await http(platform.session, 'organizations/state', { organizationId: terminal.organizationId, active: false })).status, 201);
    assert.equal((await http(platform.session, 'organizations/state', { organizationId: terminal.organizationId, active: true })).status, 201);
    const renewed = await login(terminal.email, terminalLogin.password);
    assert.equal((await http(renewed, 'company-details/execute', { queryId })).status, 200);
    assert.equal((await http(platform.session, 'point-orders/transfer', { requestId: randomUUID(), orderId })).status, 201);
    assert.equal((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [queuedId])).rows[0].status, 'paused');
    const reconfirmed = await http(renewed, 'email-recipients/reconfirm', { recipientId: queuedId,
      confirmUnsubscribeNotice: true, confirmQuota: true });
    assert.equal(reconfirmed.status, 201, await reconfirmed.text());
    assert.equal((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [queuedId])).rows[0].status, 'queued');
    assert.equal((await pool.query('SELECT reserved FROM email_daily_usage WHERE organization_id=$1', [terminal.organizationId])).rows[0].reserved, 2);
    assert.equal((await http(platform.session, 'organizations/state', { organizationId: distributor.organizationId, active: false })).status, 201);
    assert.equal((await http(grandchildLogin.session, 'workspace')).status, 200);
    assert.equal((await pool.query('SELECT active FROM organizations WHERE id=$1', [grandchild.organizationId])).rows[0].active, true);
    await pool.query('INSERT INTO distributor_inventory(organization_id,balance,average_cost) VALUES($1,3,1)',
      [secondDistributor.organizationId]);
    const subOrder = await http(secondDistributorLogin.session, 'point-orders', { requestId: randomUUID(),
      buyerId: terminalBelow.organizationId, quantity: '1.0000', unitPrice: '1.1000' });
    assert.equal(subOrder.status, 201);
    const subOrderId = (await subOrder.json()).orderId;
    assert.equal((await http(secondDistributorLogin.session, 'point-orders/confirm', { requestId: randomUUID(),
      orderId: subOrderId, receiptReference: 'T26-sub-receipt' })).status, 201);
    assert.equal((await http(secondDistributorLogin.session, 'point-orders/transfer', { requestId: randomUUID(),
      orderId: subOrderId })).status, 201);
    assert.notEqual(platformId, terminal.organizationId);
    assert.notEqual(candidateId, 'list-id-distinct');
    assert.notEqual(profileId, 'detail-id-distinct');
  } finally {
    await app.close();
    await pool.end();
  }
});
