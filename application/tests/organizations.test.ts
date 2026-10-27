import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { bindContactKey } from '../server/organizations.js';
import { createApplication } from '../server/app.js';
import { migrate } from '../server/database.js';
import { testDatabase } from './helpers.js';

test('T02 真实HTTP / PostgreSQL开户业务及权限', async t => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3091';
  const app = await createApplication(pool, origin);
  await app.listen(3091, '127.0.0.1');
  type Session = { cookie: string; csrf: string };
  type Created = { organizationId: string; accountId: string; email: string; temporaryPassword: string; expiresAt: string };
  const empty = { cookie: '', csrf: '' };
  let serial = 0;
  const data = (kind = 'terminal') => ({ name: `测试组织-${++serial}`, kind, countryCode: '+86', phone: `1387000${String(serial).padStart(4, '0')}`, email: `Owner.${serial}+tag@EXAMPLE.COM`, requestId: randomUUID() });
  async function http(session: Session, path: string, body?: object, method = body ? 'POST' : 'GET') {
    return fetch(`${origin}/api/${path}`, { method, headers: {
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
    assert.equal((await http(session, 'organizations')).status, 403);
    const next = '新密码-开户验证-安全😀十二字符';
    assert.equal((await http(session, 'auth/password', { currentPassword: password, newPassword: next, confirmPassword: next })).status, 200);
    assert.equal((await http(session, 'workspace')).status, 401);
    return login(email, next);
  }
  async function create(session: Session, input = data()): Promise<Created> {
    const response = await http(session, 'organizations', input);
    assert.equal(response.status, 201);
    return response.json() as Promise<Created>;
  }
  const count = async () => Number((await pool.query('SELECT count(*) FROM organizations')).rows[0].count);
  let platform: Session;
  let first: Created;
  let firstSession: Session;
  let second: Created;
  let secondSession: Session;
  let terminal: Created;
  let terminalSession: Session;
  try {
    platform = await activate('super_admin', 'init@Base123');
    await t.test('错误联系信息密钥拒绝启动，不允许换钥绕过电话判重', async () => {
      await assert.rejects(bindContactKey(pool, randomBytes(32)), /ORG_CONTACT_KEY/);
      await bindContactKey(pool, Buffer.from(process.env.ORG_CONTACT_KEY!, 'hex'));
    });
    await t.test('未登录、CSRF、跨级输入与手填初始密码拒绝且无写入', async () => {
      const before = await count();
      assert.equal((await http(empty, 'organizations', data())).status, 401);
      assert.equal((await http({ ...platform, csrf: 'wrong' }, 'organizations', data())).status, 403);
      for (const extra of [{ parentId: randomUUID() }, { role: 'platform' }, { password: 'hand-filled' }, { active: false }])
        assert.equal((await http(platform, 'organizations', { ...data(), ...extra })).status, 400);
      assert.equal(await count(), before);
    });
    await t.test('必填、区号、空白电话拒绝；无静默裁剪', async () => {
      const before = await count();
      for (const field of ['name', 'kind', 'countryCode', 'phone', 'email']) {
        assert.equal((await http(platform, 'organizations', { ...data(), [field]: '' })).status, 400);
        const missing: Record<string, unknown> = data(); delete missing[field];
        assert.equal((await http(platform, 'organizations', missing)).status, 400);
      }
      for (const phone of [' 13800000000', '138 00000000', '13800000000 ', '138\t000', '138\u3000000', '138\n000'])
        assert.equal((await http(platform, 'organizations', { ...data(), phone })).status, 400);
      assert.equal((await http(platform, 'organizations', { ...data(), countryCode: '86' })).status, 400);
      assert.equal(await count(), before);
    });
    await t.test('平台开一级与短链终端；组织/账号/电话/登录邮箱来源准确，加密保存', async () => {
      const input = data('distributor');
      first = await create(platform, input);
      assert.notEqual(first.organizationId, first.accountId);
      assert.equal(first.email, input.email.replace('EXAMPLE.COM', 'example.com'));
      assert.equal(first.temporaryPassword.length, 24);
      const org = (await pool.query('SELECT * FROM organizations WHERE id=$1', [first.organizationId])).rows[0];
      const actor = (await http(platform, 'auth/session').then(r => r.json())) as { id: string; organizationId: string };
      assert.equal(org.parent_id, actor.organizationId);
      assert.notEqual(org.parent_id, actor.id);
      assert.equal(org.name, input.name);
      assert.equal(org.distributor_level, 1);
      assert.equal(org.active, true);
      assert.ok(!JSON.stringify(org).includes(input.phone));
      const [iv, tag, encrypted] = org.phone_encrypted.split('.').map((part: string) => Buffer.from(part, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.ORG_CONTACT_KEY!, 'hex'), iv);
      decipher.setAAD(Buffer.from(org.id)); decipher.setAuthTag(tag);
      assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString()), [input.countryCode, input.phone]);
      const account = (await pool.query('SELECT * FROM accounts WHERE id=$1', [first.accountId])).rows[0];
      assert.equal(account.organization_id, first.organizationId);
      assert.equal(account.email, first.email);
      assert.equal(account.username, null);
      assert.equal(account.role, 'distributor');
      assert.ok(account.active && account.must_change);
      assert.ok(Math.abs(new Date(first.expiresAt).getTime() - Date.now() - 72 * 3600000) < 10000);
      assert.ok(!JSON.stringify(account).includes(first.temporaryPassword));
      terminal = await create(platform);
      terminalSession = await activate(terminal.email, terminal.temporaryPassword);
      firstSession = await activate(first.email, first.temporaryPassword);
    });
    await t.test('一级开二级/短链终端，二级开终端；三级分销、终端开户和跨组织读取拒绝', async () => {
      second = await create(firstSession, data('distributor'));
      secondSession = await activate(second.email, second.temporaryPassword);
      await create(firstSession);
      await create(secondSession);
      const before = await count();
      assert.equal((await http(secondSession, 'organizations', data('distributor'))).status, 403);
      assert.equal((await http(terminalSession, 'organizations', data())).status, 403);
      assert.equal((await http(terminalSession, 'organizations')).status, 403);
      assert.equal((await http(platform, 'organizations', { ...data(), parentId: second.organizationId })).status, 400);
      assert.equal((await http(firstSession, 'organizations', { ...data(), parentId: terminal.organizationId })).status, 400);
      assert.equal(await count(), before);
      const list = await http(firstSession, 'organizations').then(r => r.json());
      assert.ok(list.children.every((child: { parentId: string }) => child.parentId === first.organizationId));
      assert.ok(!JSON.stringify(list).includes(terminal.email));
      assert.ok(!JSON.stringify(list).includes('password'));
      assert.equal((await http(firstSession, `organizations/${terminal.organizationId}`)).status, 404);
      assert.equal((await http(firstSession, `organizations/${second.organizationId}`, { parentId: terminal.organizationId }, 'PATCH')).status, 404);
      await assert.rejects(pool.query('UPDATE organizations SET parent_id=$1 WHERE id=$2', [terminal.organizationId, second.organizationId]));
    });
    await t.test('跨组织电话唯一、邮箱域名规范唯一；大小写本地部分及别名不合并', async () => {
      const input = data(); await create(platform, input);
      const before = await count();
      assert.equal((await http(firstSession, 'organizations', { ...data(), phone: input.phone })).status, 409);
      assert.equal((await http(firstSession, 'organizations', { ...data(), email: input.email.replace('EXAMPLE.COM', 'example.com') })).status, 409);
      assert.equal(await count(), before);
      await create(firstSession, { ...data(), email: input.email.toLowerCase() });
      await create(firstSession, { ...data(), email: input.email.replace('+tag', '+other') });
      await create(firstSession, { ...data(), email: input.email.replace('Owner.', 'Owner') });
      await create(firstSession, { ...data(), countryCode: '+44', phone: input.phone });
    });
    await t.test('不同操作者并发争抢电话/邮箱均仅一个成功，失败事务无孤立组织', async () => {
      for (const field of ['phone', 'email'] as const) {
        const shared = data(); const before = await count();
        const inputs = [shared, { ...data(), [field]: shared[field] }];
        const responses = await Promise.all([http(platform, 'organizations', inputs[0]), http(firstSession, 'organizations', inputs[1])]);
        assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
        assert.equal(await count(), before + 1);
      }
    });
    await t.test('同请求并发/网络重试不重复开户、不重复返回凭据', async () => {
      const input = data(); const before = await count();
      const responses = await Promise.all([http(platform, 'organizations', input), http(platform, 'organizations', input)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      assert.equal((await http(platform, 'organizations', { ...data(), requestId: input.requestId })).status, 409);
      assert.equal(await count(), before + 1);
      const repeated = responses.find(r => r.status === 409)!;
      assert.ok(!JSON.stringify(await repeated.json()).includes('temporaryPassword'));
    });
    await t.test('管理员插入故障回滚组织、审计成功与幂等记录；修复后同请求可重试', async () => {
      const input = { ...data(), email: 'FailAccount@example.com' };
      const before = await count();
      await pool.query(`CREATE FUNCTION test_account_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.email='FailAccount@example.com' THEN RAISE EXCEPTION 'Injected account insert failure'; END IF;
        RETURN NEW; END $$; CREATE TRIGGER test_account_failure BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION test_account_failure()`);
      try {
        assert.equal((await http(platform, 'organizations', input)).status, 500);
        assert.equal(await count(), before);
        assert.equal((await pool.query('SELECT 1 FROM organization_openings WHERE request_id=$1', [input.requestId])).rowCount, 0);
      } finally { await pool.query('DROP TRIGGER test_account_failure ON accounts; DROP FUNCTION test_account_failure()'); }
      await create(platform, input);
    });
    await t.test('组织停用拒绝登录/已有会话且不级联；账号角色不能伪装权限', async () => {
      await pool.query('UPDATE organizations SET active=false WHERE id=$1', [first.organizationId]);
      assert.equal((await http(firstSession, 'organizations', data())).status, 401);
      assert.equal((await http(empty, 'auth/login', { email: first.email, password: '新密码-开户验证-安全😀十二字符' })).status, 401);
      await create(secondSession);
      await pool.query('UPDATE organizations SET active=true WHERE id=$1', [first.organizationId]);
      await pool.query("UPDATE accounts SET role='sales' WHERE id=$1", [first.accountId]);
      assert.equal((await http(firstSession, 'organizations', data())).status, 403);
      await pool.query("UPDATE accounts SET role='distributor' WHERE id=$1", [first.accountId]);
    });
    await t.test('临时凭据到期拒绝登录；审计目标准确且不含凭据/电话；重复初始化保留开户', async () => {
      const expired = await create(platform);
      await pool.query("UPDATE accounts SET temporary_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.accountId]);
      assert.equal((await http(empty, 'auth/login', { email: expired.email, password: expired.temporaryPassword })).status, 401);
      const audit = (await pool.query('SELECT * FROM opening_audit')).rows;
      assert.ok(audit.some(row => row.target_organization_id === first.organizationId && row.target_account_id === first.accountId && row.result === 'created'));
      assert.ok(audit.some(row => row.result === 'rejected'));
      assert.ok(!JSON.stringify(audit).includes(first.temporaryPassword));
      assert.ok(!JSON.stringify(audit).includes(first.email));
      const before = await count(); await migrate(pool); assert.equal(await count(), before);
      const orphan = await pool.query("SELECT o.id FROM organizations o LEFT JOIN accounts a ON a.organization_id=o.id WHERE o.kind<>'platform' AND a.id IS NULL");
      assert.equal(orphan.rowCount, 0);
    });
  } finally { await app.close(); await pool.end(); }
});
