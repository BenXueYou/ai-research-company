import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';
import type { Identity } from './identity.js';
import type { TengdaoUsage } from './tengdao.js';

export interface UpstreamAccountClient {
  account(): Promise<{ balance: string; expiresIn: string; traceId: string | null }>;
  usage(): Promise<TengdaoUsage | null>;
  limits(): { minute: number; dataToday: number; businessToday: number };
}

function category(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('40304')) return 'points_exhausted';
  if (message.includes('40101') || message.includes('今日') || message.includes('调用次数')) return 'daily_calls_exhausted';
  if (message.includes('40102') || message.includes('频率')) return 'rate_limited';
  if (message.includes('40300') || message.includes('到期')) return 'account_unavailable';
  return 'upstream_unavailable';
}

export class UpstreamMonitorService {
  constructor(private readonly pool: pg.Pool, private readonly client?: UpstreamAccountClient) {}
  private async authorize(identity: Identity) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台运营可查看上游账号');
    const result = await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id]);
    if (result.rows[0]?.kind !== 'platform' || !result.rows[0]?.active)
      throw new ForbiddenException('平台身份不可用');
  }
  async overview(identity: Identity) {
    await this.authorize(identity);
    const snapshot = (await this.pool.query(`SELECT balance,expires_in AS "expiresIn",trace_id AS "traceId",
      fetched_at AS "fetchedAt" FROM upstream_account_snapshot WHERE singleton=true`)).rows[0] ?? null;
    const events = (await this.pool.query(`SELECT endpoint,result,category,trace_id AS "traceId",
      duration_ms AS "durationMs",happened_at AS "happenedAt"
      FROM upstream_monitor_events ORDER BY id DESC LIMIT 20`)).rows;
    let usage: TengdaoUsage | null = null;
    let usageUnavailable = false;
    if (this.client) {
      try {
        usage = await this.client.usage();
      } catch {
        usageUnavailable = true;
      }
    }
    return { configured: Boolean(this.client), snapshot, usage, usageUnavailable, limits: this.client?.limits() ?? null, events };
  }
  async refresh(identity: Identity) {
    await this.authorize(identity);
    if (!this.client) throw new ServiceUnavailableException('腾道账号尚未配置');
    const started = Date.now();
    try {
      const account = await this.client.account();
      await this.pool.query(`INSERT INTO upstream_account_snapshot(singleton,balance,expires_in,trace_id,fetched_at)
        VALUES(true,$1,$2,$3,clock_timestamp()) ON CONFLICT(singleton) DO UPDATE
        SET balance=EXCLUDED.balance,expires_in=EXCLUDED.expires_in,trace_id=EXCLUDED.trace_id,fetched_at=EXCLUDED.fetched_at`,
      [account.balance, account.expiresIn, account.traceId]);
      await this.pool.query(`INSERT INTO upstream_monitor_events(actor_id,endpoint,result,trace_id,duration_ms)
        VALUES($1,'/v2/account','success',$2,$3)`, [identity.id, account.traceId, Date.now() - started]);
      return this.overview(identity);
    } catch (error) {
      await this.pool.query(`INSERT INTO upstream_monitor_events(actor_id,endpoint,result,category,duration_ms)
        VALUES($1,'/v2/account','failed',$2,$3)`, [identity.id, category(error), Date.now() - started]);
      throw error;
    }
  }
}
