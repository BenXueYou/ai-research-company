import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDecipheriv,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import {
  bindSmtpCredentialKey,
  type DomesticSmtpAdapter,
  type DomesticSmtpSettings
} from '../server/email/smtp-channel.js';
import { testDatabase } from './helpers.js';

test('T19 国内SMTP团队渠道设置、隔离、权限与凭据保护', async t => {
  const { pool } = await testDatabase();
  const password = 'T19-测试账号密码-十二字符';
  const passwordHash = await hashPassword(password);
  const platformOrganizationId = randomUUID();
  const terminalAId = randomUUID();
  const terminalBId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'平台夹具','platform')", [platformOrganizationId]);
  await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
    VALUES($1,'终端甲','terminal',$2,'encrypted-a','phone-a','***0001'),
      ($3,'终端乙','terminal',$2,'encrypted-b','phone-b','***0002')`, [terminalAId, platformOrganizationId, terminalBId]);
  const accounts = {
    adminA: { id: randomUUID(), organizationId: terminalAId, email: 'smtp-admin-a@example.com', role: 'admin' },
    salesA: { id: randomUUID(), organizationId: terminalAId, email: 'smtp-sales-a@example.com', role: 'sales' },
    adminB: { id: randomUUID(), organizationId: terminalBId, email: 'smtp-admin-b@example.com', role: 'admin' },
    platform: { id: randomUUID(), organizationId: platformOrganizationId, email: 'smtp-platform@example.com', role: 'platform' }
  };
  for (const account of Object.values(accounts)) {
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [account.id, account.organizationId, account.email, passwordHash, account.role]);
  }
  const verified: DomesticSmtpSettings[] = [];
  const adapter: DomesticSmtpAdapter = {
    async verify(settings) {
      verified.push(settings);
      return settings.host.startsWith('down.')
        ? { state: 'unavailable', detail: '受控验证：服务不可用' }
        : { state: 'available', detail: '受控验证：设置可用' };
    }
  };
  const origin = 'http://127.0.0.1:3093';
  const app = await createApplication(pool, origin, false, adapter);
  await app.listen(3093, '127.0.0.1');
  type Session = { cookie: string; csrf: string };
  async function login(email: string): Promise<Session> {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.equal(response.status, 200);
    const pairs = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return {
      cookie: pairs.join('; '),
      csrf: pairs.find(item => item.startsWith('identity_csrf='))!.slice(14)
    };
  }
  async function http(session: Session, body?: Record<string, unknown>, path = 'sending-channels/smtp') {
    return fetch(`${origin}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  const input = (overrides: Record<string, unknown> = {}) => ({
    host: 'smtp.domestic-a.example',
    port: '465',
    security: 'tls',
    username: 'sender-team-a@example.com',
    credential: 'smtp-secret-team-a',
    replyTo: 'reply-team-a@example.net',
    defaultChannel: true,
    requestId: randomUUID(),
    ...overrides
  });
  try {
    const adminA = await login(accounts.adminA.email);
    const salesA = await login(accounts.salesA.email);
    const adminB = await login(accounts.adminB.email);
    const platform = await login(accounts.platform.email);

    await t.test('管理员提交字段按原来源进入适配器和本企业记录，明文凭据不落库不返回', async () => {
      const payload = input();
      const response = await http(adminA, payload);
      assert.equal(response.status, 201);
      const result = await response.json() as { channel: Record<string, unknown> };
      assert.equal(result.channel.host, payload.host);
      assert.equal(result.channel.username, payload.username);
      assert.equal(result.channel.replyTo, payload.replyTo);
      assert.equal(result.channel.defaultChannel, true);
      assert.equal(result.channel.verificationState, 'available');
      assert.equal(result.channel.credentialConfigured, true);
      assert.ok(!JSON.stringify(result).includes(payload.credential));
      assert.deepEqual(verified[0], {
        host: payload.host,
        port: 465,
        security: payload.security,
        username: payload.username,
        credential: payload.credential,
        replyTo: payload.replyTo
      });
      const stored = (await pool.query('SELECT * FROM team_sending_channels WHERE organization_id=$1', [terminalAId])).rows[0];
      assert.equal(stored.organization_id, terminalAId);
      assert.notEqual(stored.organization_id, accounts.adminA.id);
      assert.equal(stored.updated_by, accounts.adminA.id);
      assert.equal(stored.reply_to, payload.replyTo);
      assert.ok(!stored.credential_encrypted.includes(payload.credential));
      const [iv, tag, encrypted] = stored.credential_encrypted.split('.').map((part: string) => Buffer.from(part, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.SMTP_CREDENTIAL_KEY!, 'hex'), iv);
      decipher.setAAD(Buffer.from(`${terminalAId}:SMTP`));
      decipher.setAuthTag(tag);
      assert.equal(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(), payload.credential);
      const audit = (await pool.query('SELECT * FROM sending_channel_audit WHERE channel_id=$1', [stored.id])).rows[0];
      assert.equal(audit.actor_id, accounts.adminA.id);
      assert.equal(audit.organization_id, terminalAId);
      assert.ok(!JSON.stringify(audit).includes(payload.credential));
    });

    await t.test('同一企业最多一套并可更新默认选择；请求重试幂等且冲突载荷拒绝', async () => {
      const payload = input({ host: 'smtp-updated.example', defaultChannel: false });
      const first = await http(adminA, payload);
      assert.equal(first.status, 201);
      const repeated = await http(adminA, payload);
      assert.equal(repeated.status, 201);
      const conflict = await http(adminA, { ...payload, replyTo: 'different@example.net' });
      assert.equal(conflict.status, 409);
      const stored = await pool.query("SELECT * FROM team_sending_channels WHERE organization_id=$1 AND kind='SMTP'", [terminalAId]);
      assert.equal(stored.rowCount, 1);
      assert.equal(stored.rows[0].smtp_host, payload.host);
      assert.equal(stored.rows[0].default_flag, false);
      const requests = await pool.query('SELECT count(*) FROM smtp_configuration_requests WHERE actor_id=$1 AND request_id=$2', [accounts.adminA.id, payload.requestId]);
      assert.equal(Number(requests.rows[0].count), 1);
    });

    await t.test('业务员可查看脱敏团队状态但无维护权，平台查看权不扩大为企业写权', async () => {
      const read = await http(salesA);
      assert.equal(read.status, 200);
      const result = await read.json();
      assert.equal(result.channel.replyTo, 'reply-team-a@example.net');
      assert.ok(!JSON.stringify(result).includes('smtp-secret'));
      assert.equal((await http(salesA, input())).status, 403);
      assert.equal((await http(platform)).status, 403);
      assert.equal((await http(platform, input())).status, 403);
      assert.equal(verified.length, 2);
    });

    await t.test('不同企业设置隔离，适配器不可用结果按本企业保存且不伪装为真实联调通过', async () => {
      const before = await http(adminB);
      assert.equal(before.status, 200);
      assert.deepEqual(await before.json(), { channel: null });
      const payload = input({
        host: 'down.smtp-team-b.example',
        username: 'sender-team-b@example.com',
        credential: 'smtp-secret-team-b',
        replyTo: 'reply-team-b@example.org'
      });
      const saved = await http(adminB, payload);
      assert.equal(saved.status, 201);
      const result = await saved.json();
      assert.equal(result.channel.verificationState, 'unavailable');
      const channels = await pool.query('SELECT organization_id,reply_to FROM team_sending_channels ORDER BY organization_id');
      assert.equal(channels.rowCount, 2);
      assert.ok(channels.rows.some(row => row.organization_id === terminalAId && row.reply_to === 'reply-team-a@example.net'));
      assert.ok(channels.rows.some(row => row.organization_id === terminalBId && row.reply_to === payload.replyTo));
    });

    await t.test('无效字段在适配器前拒绝，密钥换用被数据库指纹阻止', async () => {
      const calls = verified.length;
      for (const payload of [
        input({ host: ' smtp.example' }),
        input({ port: 0 }),
        input({ security: 'none' }),
        input({ replyTo: 'not-an-email' }),
        input({ defaultChannel: 'true' }),
        { ...input(), organizationId: terminalBId }
      ]) assert.equal((await http(adminA, payload)).status, 400);
      assert.equal(verified.length, calls);
      await assert.rejects(bindSmtpCredentialKey(pool, randomBytes(32)), /SMTP_CREDENTIAL_KEY/);
    });
  } finally {
    await app.close();
    await pool.end();
  }
});
