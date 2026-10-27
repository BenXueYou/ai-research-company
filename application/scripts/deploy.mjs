import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (existsSync('.env')) process.loadEnvFile('.env');
if (!/^[a-f0-9]{64}$/i.test(process.env.ORG_CONTACT_KEY ?? '')) throw new Error('必须配置32字节 ORG_CONTACT_KEY（64位十六进制）');
if (!/^[a-f0-9]{64}$/i.test(process.env.SMTP_CREDENTIAL_KEY ?? '')) throw new Error('必须配置独立的32字节 SMTP_CREDENTIAL_KEY（64位十六进制）');
if (!process.env.DATABASE_URL) throw new Error('必须配置 DATABASE_URL');
const origin = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000');
if (origin.origin !== (process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000') ||
    (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:'))
  throw new Error('APP_ORIGIN 必须是精确源；生产环境要求 HTTPS');

// Fixed commands only. Credentials stay in the inherited environment, never arguments.
for (const script of ['build', 'db:migrate']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    stdio: 'inherit', shell: process.platform === 'win32', env: process.env
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('单环境部署准备完成。使用 npm start 启动；首次平台登录必须改密。');
