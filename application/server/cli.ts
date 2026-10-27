import { database, migrate } from './database.js';
const pool = database();
try {
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'bootstrap')
    throw new Error('使用 migrate 或 bootstrap');
  await migrate(pool);
  console.log('数据库初始化完成；已有账号和密码保持不变。初始平台账号首次登录必须改密。');
} catch {
  console.error('初始化失败：检查数据库连接、权限及是否为当前版本的新库。不会回显敏感错误。');
  process.exitCode = 1;
} finally {
  await pool.end();
}
