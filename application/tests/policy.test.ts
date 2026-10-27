import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validNewPassword, hashPassword, verifyPassword, temporaryPassword } from '../server/policy.js';

test('邮箱只折叠域名；不合并本地大小写、别名、圆点', () => {
  assert.equal(normalizeEmail('A.b+x@EXAMPLE.COM'), 'A.b+x@example.com');
  assert.notEqual(normalizeEmail('Ab@example.com'), normalizeEmail('ab@example.com'));
  assert.throws(() => normalizeEmail('not-email'));
});
test('按Unicode码点计数且不裁剪、归一化，不强制字符组合', () => {
  assert.equal(validNewPassword('😀'.repeat(12)), true);
  assert.equal(validNewPassword(' '.repeat(12)), true);
  assert.equal(validNewPassword('a'.repeat(128)), true);
  assert.equal(validNewPassword('a'.repeat(129)), false);
  assert.equal(validNewPassword('😀'.repeat(11)), false);
});
test('安全随机临时密码24字符；KDF随机盐且精确验证', async () => {
  const password = temporaryPassword();
  assert.equal(password.length, 24);
  assert.notEqual(password, temporaryPassword());
  const hash = await hashPassword(' 密码 '.repeat(4));
  assert.notEqual(hash, await hashPassword(' 密码 '.repeat(4)));
  assert.equal(await verifyPassword(' 密码 '.repeat(4), hash), true);
  assert.equal(await verifyPassword('密码 '.repeat(4), hash), false);
});
