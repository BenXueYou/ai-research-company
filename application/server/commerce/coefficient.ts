import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from '../database.js';
import { digest, type Identity } from '../identity/identity.js';
import type { UpstreamAccountClient } from '../upstream/upstream-monitor.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const amount = /^\d{1,12}(\.\d{1,4})?$/;

export class CoefficientService {
  constructor(private readonly pool: pg.Pool, private readonly upstream?: UpstreamAccountClient) {}

  async notices() {
    return (await this.pool.query(`SELECT previous_coefficient AS "previousCoefficient",
      proposed_coefficient AS "proposedCoefficient",effective_at AS "effectiveAt",notice,
      announced_at AS "announcedAt",activated_at AS "activatedAt"
      FROM coefficient_changes ORDER BY announced_at DESC,id DESC LIMIT 5`)).rows;
  }

  private async authorize(db: pg.PoolClient, identity: Identity, token: string) {
    const actor = (await db.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [identity.id])).rows[0];
    const session = await db.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
    if (!actor?.active || !session.rowCount) throw new UnauthorizedException('请重新登录');
    const org = (await db.query('SELECT kind,active FROM organizations WHERE id=$1 FOR SHARE', [actor.organization_id])).rows[0];
    if (actor.must_change || actor.role !== 'platform' || org?.kind !== 'platform' || !org.active)
      throw new ForbiddenException('仅平台管理员可调整系数');
  }

  async overview(identity: Identity, token: string) {
    return transaction(this.pool, async db => {
      await this.authorize(db, identity, token);
      const current = (await db.query('SELECT coefficient FROM platform_pricing')).rows[0].coefficient as string;
      const changes = (await db.query(`SELECT id,previous_coefficient AS "previousCoefficient",
        proposed_coefficient AS "proposedCoefficient",effective_at AS "effectiveAt",notice,
        announced_at AS "announcedAt",activated_at AS "activatedAt",coverage
        FROM coefficient_changes ORDER BY announced_at DESC,id DESC LIMIT 20`)).rows;
      return { current, changes };
    });
  }

  async announce(identity: Identity, token: string, input: Record<string, unknown>) {
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['requestId','coefficient','effectiveAt','notice'].includes(key))
      || !uuid.test(String(input.requestId)) || typeof input.coefficient !== 'string'
      || !amount.test(input.coefficient) || Number(input.coefficient) <= 0
      || typeof input.effectiveAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.effectiveAt)
      || !Number.isFinite(Date.parse(input.effectiveAt)) || typeof input.notice !== 'string'
      || !input.notice.trim() || input.notice.length > 500)
      throw new BadRequestException('系数、通知或生效时间无效');
    return transaction(this.pool, async db => {
      await this.authorize(db, identity, token);
      const current = (await db.query('SELECT coefficient FROM platform_pricing FOR UPDATE')).rows[0].coefficient as string;
      const previous = (await db.query('SELECT * FROM coefficient_changes WHERE request_id=$1', [input.requestId])).rows[0];
      if (previous) {
        if (previous.actor_id !== identity.id || Number(previous.proposed_coefficient) !== Number(input.coefficient)
          || new Date(previous.effective_at).toISOString() !== new Date(input.effectiveAt as string).toISOString() || previous.notice !== input.notice)
          throw new ConflictException('通知请求标识已用于其他内容');
        return { id: previous.id, effectiveAt: previous.effective_at, coefficient: previous.proposed_coefficient };
      }
      if (Number(input.coefficient) === Number(current)) throw new BadRequestException('新系数须与当前系数不同');
      if (Date.parse(input.effectiveAt as string) <= Date.now()) throw new BadRequestException('须提前告知未来生效时间');
      const id = randomUUID();
      try {
        await db.query(`INSERT INTO coefficient_changes(id,request_id,actor_id,previous_coefficient,proposed_coefficient,effective_at,notice)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [id,input.requestId,identity.id,current,input.coefficient,input.effectiveAt,input.notice]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new ConflictException('已有待生效系数通知');
        throw error;
      }
      return { id, effectiveAt: input.effectiveAt, coefficient: input.coefficient };
    });
  }

  private async coverage(db: pg.PoolClient, proposed: string) {
    const rows = (await db.query(`SELECT
      (SELECT balance FROM platform_inventory) AS platform,
      (SELECT coalesce(sum(balance),0) FROM distributor_inventory) AS distributors,
      (SELECT coalesce(sum(balance),0) FROM internal_point_accounts) AS terminals,
      (SELECT coalesce(sum(frozen+reserved),0) FROM platform_inventory) AS platform_held,
      (SELECT coalesce(sum(frozen+reserved),0) FROM distributor_inventory) AS distributor_held,
      (SELECT coalesce(sum(query_frozen+sales_reserved),0) FROM internal_point_accounts) AS terminal_held`)).rows[0];
    const pending = (await db.query(`SELECT maximum_points,coefficient,actual_upstream_points FROM company_detail_queries WHERE state='pending'
      UNION ALL SELECT maximum_points,coefficient,actual_upstream_points FROM company_contact_queries WHERE state='pending'
      UNION ALL SELECT maximum_points,coefficient,actual_upstream_points FROM product_search_pages WHERE state='pending'`)).rows;
    const locked = pending.reduce((sum, row) => sum + Number(row.maximum_points), 0);
    const total = Number(rows.platform) + Number(rows.distributors) + Number(rows.terminals);
    if (locked > total + 0.00001) throw new ConflictException('冻结查询与全链余额不一致，须人工核对');
    let oldExposure = 0;
    let inTransitCharged = 0;
    for (const row of pending) {
      const maximum = Number(row.maximum_points) / Number(row.coefficient);
      const charged = row.actual_upstream_points === null ? 0 : Number(row.actual_upstream_points);
      if (!Number.isFinite(maximum) || maximum < 0 || !Number.isFinite(charged) || charged < 0)
        throw new ConflictException('在途查询点数证据无效');
      inTransitCharged += charged;
      oldExposure += Math.max(0, maximum - charged);
    }
    const normalExposure = (total - locked) / Number(proposed);
    const required = Math.ceil((normalExposure + oldExposure - 1e-10) * 10000) / 10000;
    return {
      platformBalance: rows.platform,
      distributorBalance: rows.distributors,
      terminalBalance: rows.terminals,
      platformHeldIncluded: rows.platform_held,
      distributorHeldIncluded: rows.distributor_held,
      terminalHeldIncluded: rows.terminal_held,
      lockedInternalPoints: locked.toFixed(4),
      pendingCount: pending.length,
      inTransitChargedUpstreamPoints: inTransitCharged.toFixed(4),
      normalExposure: normalExposure.toFixed(4),
      oldAuthorizationExposure: oldExposure.toFixed(4),
      requiredUpstreamPoints: required.toFixed(4)
    };
  }

  async activate(identity: Identity, token: string, id: string) {
    if (!uuid.test(id)) throw new BadRequestException('通知标识无效');
    const upstream = this.upstream;
    if (!upstream) throw new ServiceUnavailableException('腾道账户实时查询尚未配置');
    return transaction(this.pool, async db => {
      await this.authorize(db, identity, token);
      const current = (await db.query('SELECT coefficient FROM platform_pricing FOR UPDATE')).rows[0].coefficient as string;
      const change = (await db.query('SELECT * FROM coefficient_changes WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!change) throw new BadRequestException('系数通知不存在');
      if (change.activated_at) return { id, coefficient: change.proposed_coefficient, coverage: change.coverage };
      if (Number(current) !== Number(change.previous_coefficient)) throw new ConflictException('当前系数已变化，通知须重新发布');
      if (new Date(change.effective_at).getTime() > Date.now()) throw new ConflictException('尚未到已告知生效时间');
      await db.query("SELECT id FROM company_detail_queries WHERE state IN ('quoted','pending') ORDER BY id FOR UPDATE");
      await db.query("SELECT id FROM company_contact_queries WHERE state IN ('quoted','pending') ORDER BY id FOR UPDATE");
      await db.query("SELECT id FROM product_search_pages WHERE state IN ('quoted','pending') ORDER BY id FOR UPDATE");
      await db.query('SELECT singleton FROM platform_inventory FOR UPDATE');
      await db.query('SELECT organization_id FROM distributor_inventory ORDER BY organization_id FOR UPDATE');
      await db.query('SELECT organization_id FROM internal_point_accounts ORDER BY organization_id FOR UPDATE');
      const account = await upstream.account();
      if (!amount.test(account.balance)) throw new ServiceUnavailableException('实时上游余额无有效点数证据');
      const calculation = await this.coverage(db, change.proposed_coefficient);
      const shortfall = Math.max(0, Number(calculation.requiredUpstreamPoints) - Number(account.balance));
      const coverage = {
        ...calculation,
        upstreamBalance: account.balance,
        upstreamTraceId: account.traceId,
        upstreamCheckedAt: new Date().toISOString(),
        shortfall: shortfall.toFixed(4)
      };
      if (Number(change.proposed_coefficient) < Number(current) && shortfall > 0.0000001)
        throw new ConflictException(`全链额度覆盖不足，须先补上游 ${coverage.shortfall} 点；补缺口采购不增销售库存`);
      await db.query("UPDATE company_detail_queries SET state='expired' WHERE state='quoted' AND coefficient<>$1", [change.proposed_coefficient]);
      await db.query("UPDATE company_contact_queries SET state='expired' WHERE state='quoted' AND coefficient<>$1", [change.proposed_coefficient]);
      await db.query("UPDATE product_search_pages SET state='expired' WHERE state='quoted' AND coefficient<>$1", [change.proposed_coefficient]);
      await db.query('UPDATE platform_pricing SET coefficient=$1 WHERE singleton=true', [change.proposed_coefficient]);
      await db.query('UPDATE coefficient_changes SET activated_at=clock_timestamp(),coverage=$2 WHERE id=$1', [id,JSON.stringify(coverage)]);
      return { id, coefficient: change.proposed_coefficient, coverage };
    });
  }
}
