import { createApplication } from './app.js';
import { database } from './database.js';
import { createClient } from 'redis';
import { HttpTengdaoCompanyClient, RedisTengdaoSharedState, type TengdaoCompanyClient } from './upstream/tengdao.js';
const pool = database();
let redis: ReturnType<typeof createClient> | undefined;
try {
  await pool.query('SELECT 1 FROM bootstrap_marker LIMIT 1');
  let tengdao: TengdaoCompanyClient | undefined;
  if (process.env.TENGDAO_BASE_URL || process.env.TENGDAO_API_KEY || process.env.TENGDAO_BUSINESS_DAILY_LIMIT || process.env.REDIS_URL) {
    if (!process.env.TENGDAO_BASE_URL || !process.env.TENGDAO_API_KEY || !process.env.TENGDAO_BUSINESS_DAILY_LIMIT || !process.env.REDIS_URL)
      throw new Error('启用腾道查询必须完整配置 TENGDAO_BASE_URL、TENGDAO_API_KEY、TENGDAO_BUSINESS_DAILY_LIMIT、REDIS_URL');
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', () => undefined);
    await redis.connect();
    tengdao = new HttpTengdaoCompanyClient(new RedisTengdaoSharedState(redis), {
      baseUrl: process.env.TENGDAO_BASE_URL,
      apiKey: process.env.TENGDAO_API_KEY,
      businessDailyLimit: Number(process.env.TENGDAO_BUSINESS_DAILY_LIMIT)
    });
  }
  const app = await createApplication(pool, process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000', process.env.NODE_ENV === 'production', undefined, tengdao, undefined,
    tengdao instanceof HttpTengdaoCompanyClient ? tengdao : undefined);
  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
  app.getHttpServer().on('close', () => { void pool.end(); if (redis?.isOpen) void redis.close(); });
  console.log('身份应用已启动');
} catch {
  console.error('启动失败：检查数据库迁移、连接及 APP_ORIGIN 配置');
  if (redis?.isOpen) await redis.close();
  await pool.end();
  process.exitCode = 1;
}
