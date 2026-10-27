import { createApplication } from './app.js';
import { database } from './database.js';
const pool = database();
try {
  await pool.query('SELECT 1 FROM bootstrap_marker LIMIT 1');
  const app = await createApplication(pool, process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000', process.env.NODE_ENV === 'production');
  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
  app.getHttpServer().on('close', () => { void pool.end(); });
  console.log('身份应用已启动');
} catch {
  console.error('启动失败：检查数据库迁移、连接及 APP_ORIGIN 配置');
  await pool.end();
  process.exitCode = 1;
}
