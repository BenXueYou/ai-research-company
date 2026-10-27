import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { database, migrate } from './database.js';
import { IdentityService } from './identity.js';
const pool = database();
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    await migrate(pool);
    console.log('数据库迁移完成');
  } else if (command === 'bootstrap' && process.argv.includes('--confirm-bootstrap') && stdin.isTTY && stdout.isTTY) {
    const reader = createInterface({ input: stdin, output: stdout });
    try {
      const email = await reader.question('初始平台管理员邮箱（本地部分区分大小写）：');
      const organization = await reader.question('平台组织名称：');
      const result = await new IdentityService(pool).bootstrap(email, organization);
      console.log(`账号：${result.email}\n临时密码（仅显示本次，有效72小时）：${result.password}\n请安全交付，首次登录必须改密。勿录屏或保存终端日志。`);
    } finally {
      reader.close();
    }
  } else {
    throw new Error('使用 migrate 或 bootstrap --confirm-bootstrap；引导必须在交互式部署终端执行');
  }
} catch {
  console.error('操作失败：请检查参数、数据库连接及是否已完成引导。不会回显敏感错误。');
  process.exitCode = 1;
} finally {
  await pool.end();
}
