import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './database.js';
import type { Identity } from './identity.js';

export interface DetailResult {
  data: Record<string, unknown> | null;
  actualUpstreamPoints?: string;
  traceId?: string;
}
export interface CompanyDetailClient {
  detail(input: { name: string; countryCode3: string }): Promise<DetailResult>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exact(body: unknown, field: string): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求参数无效');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !uuid.test(String(input[field]))) throw new BadRequestException('请求标识无效');
  return String(input[field]);
}

export class CompanyDetailService {
  constructor(private readonly pool: pg.Pool, private readonly vendor: CompanyDetailClient, private readonly production: boolean) {}
  private async authorize(identity: Identity) {
    if (!['admin', 'sales'].includes(identity.role)) throw new ForbiddenException('仅终端企业成员可查询详情');
    const org = await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id]);
    if (org.rows[0]?.kind !== 'terminal' || !org.rows[0]?.active) throw new ForbiddenException('终端企业不可用');
  }
  async quote(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const candidateId = exact(body, 'candidateId');
    return transaction(this.pool, async db => {
      const candidate = (await db.query(`SELECT source_name,source_country FROM company_candidates
        WHERE id=$1 AND organization_id=$2 AND verification_status='verified' FOR UPDATE`, [candidateId, identity.organization_id])).rows[0];
      if (!candidate) throw new NotFoundException('已核实候选不存在');
      if (!/^[A-Z]{3}$/.test(candidate.source_country)) throw new ConflictException('候选国家需要核实');
      const existing = (await db.query(`SELECT p.id,p.name,p.country_code3 FROM company_profiles p
        JOIN company_detail_queries q ON q.id=p.query_id WHERE q.candidate_id=$1 AND p.organization_id=$2`,
      [candidateId, identity.organization_id])).rows[0];
      if (existing) return { localProfile: existing, chargedPoints: '0.0000' };
      const active = (await db.query(`SELECT id AS "queryId",name,country_code3 AS "countryCode3",coefficient,
        maximum_points AS "maximumPoints",state FROM company_detail_queries
        WHERE organization_id=$1 AND candidate_id=$2 AND (state='pending' OR
          (state='quoted' AND coefficient=(SELECT coefficient FROM platform_pricing)))`, [identity.organization_id, candidateId])).rows[0];
      if (active) return active;
      const price = (await db.query(`SELECT upstream_unit_price,maximum_billable_units,version FROM interface_prices
        WHERE interface_path='/v2/company' AND (NOT $1::boolean OR evidence_type='supplier_verified')`, [this.production])).rows[0];
      if (!price) throw new ConflictException('企业详情尚无已核实的单价及最高计费量');
      const coefficient = (await db.query('SELECT coefficient FROM platform_pricing FOR SHARE')).rows[0].coefficient as string;
      const maximum = (await db.query(`SELECT round($1::numeric*$2::numeric*$3::numeric,4) AS amount`,
        [price.upstream_unit_price, price.maximum_billable_units, coefficient])).rows[0].amount as string;
      if (Number(maximum) <= 0) throw new ConflictException('企业详情最高扣点额度不可证明');
      const id = randomUUID();
      await db.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'quoted')`,
      [id, identity.organization_id, identity.id, candidateId, candidate.source_name, candidate.source_country, coefficient, maximum, price.version]);
      return { queryId: id, name: candidate.source_name, countryCode3: candidate.source_country, coefficient, maximumPoints: maximum };
    });
  }
  async execute(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const queryId = exact(body, 'queryId');
    const reserved = await transaction(this.pool, async db => {
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 AND organization_id=$2 FOR UPDATE', [queryId, identity.organization_id])).rows[0];
      if (!query) throw new NotFoundException('查询授权不存在');
      if (query.state === 'expired') throw new ConflictException('报价系数已变化，请重新报价确认');
      if (query.state !== 'quoted') return { duplicate: true, query };
      const currentCoefficient = (await db.query('SELECT coefficient FROM platform_pricing')).rows[0].coefficient as string;
      if (Number(query.coefficient) !== Number(currentCoefficient)) throw new ConflictException('报价系数已变化，请重新报价确认');
      const candidate = (await db.query(`SELECT source_name,source_country,verification_status FROM company_candidates
        WHERE id=$1 AND organization_id=$2`, [query.candidate_id, identity.organization_id])).rows[0];
      if (!candidate || candidate.verification_status !== 'verified' || candidate.source_name !== query.name || candidate.source_country !== query.country_code3)
        throw new ConflictException('已确认候选发生变化');
      const account = (await db.query('SELECT * FROM internal_point_accounts WHERE organization_id=$1 FOR UPDATE', [identity.organization_id])).rows[0];
      if (!account || Number(account.balance) - Number(account.query_frozen) - Number(account.sales_reserved) < Number(query.maximum_points))
        throw new ConflictException('可用点数不足');
      const after = (await db.query(`UPDATE internal_point_accounts SET query_frozen=query_frozen+$2::numeric
        WHERE organization_id=$1 RETURNING balance,query_frozen`, [identity.organization_id, query.maximum_points])).rows[0];
      await db.query("UPDATE company_detail_queries SET state='pending',updated_at=clock_timestamp() WHERE id=$1", [queryId]);
      await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'freeze',$4,$5,$6)`, [queryId, identity.organization_id, identity.id, query.maximum_points, after.balance, after.query_frozen]);
      return { duplicate: false, query };
    });
    if (reserved.duplicate) return this.get(identity, queryId);
    let detail: DetailResult;
    try {
      detail = await this.vendor.detail({ name: reserved.query.name, countryCode3: reserved.query.country_code3 });
    } catch {
      return this.get(identity, queryId);
    }
    if (!detail || !detail.data || !Object.hasOwn(detail.data, 'id')) return this.get(identity, queryId);
    if (detail.data.id !== null && (typeof detail.data.id !== 'string' || !detail.data.id || detail.data.countryCode3 !== reserved.query.country_code3))
      return this.get(identity, queryId);
    const resultData = detail.data;
    const arrivedAfterFailure = await transaction(this.pool, async db => {
      const current = (await db.query('SELECT state FROM company_detail_queries WHERE id=$1 FOR UPDATE', [queryId])).rows[0];
      if (current?.state === 'failed') {
        await db.query(`INSERT INTO company_detail_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(query_id,trace_id,billing_reference) DO NOTHING`,
        [randomUUID(), queryId, identity.id, detail.traceId ?? 'unavailable', 'unavailable', JSON.stringify(resultData), '原查询异步迟到结果']);
        return true;
      }
      if (current?.state === 'pending') await db.query(`UPDATE company_detail_queries SET trace_id=$2,result=$3,detail_id=$4,updated_at=clock_timestamp()
        WHERE id=$1`, [queryId, detail.traceId && detail.traceId.length <= 500 ? detail.traceId : null,
        JSON.stringify(resultData), resultData.id]);
      return false;
    });
    if (arrivedAfterFailure) return this.get(identity, queryId);
    if (detail.actualUpstreamPoints === undefined || !/^\d{1,12}(\.\d{1,4})?$/.test(detail.actualUpstreamPoints))
      return this.get(identity, queryId);
    try {
      await transaction(this.pool, async db => {
        const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 FOR UPDATE', [queryId])).rows[0];
        if (query.state === 'failed') {
          await db.query(`INSERT INTO company_detail_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(query_id,trace_id,billing_reference) DO NOTHING`,
          [randomUUID(), queryId, identity.id, detail.traceId ?? 'unavailable', 'unavailable', JSON.stringify(detail.data), '原查询异步迟到结果']);
          return;
        }
        if (query.state !== 'pending') return;
        const zero = detail.data?.id === null;
        const charge = zero ? '0.0000' : (await db.query(`SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount`,
          [detail.actualUpstreamPoints, query.coefficient, query.maximum_points])).rows[0].amount as string;
        const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,query_frozen=query_frozen-$3::numeric
          WHERE organization_id=$1 RETURNING balance,query_frozen`, [query.organization_id, charge, query.maximum_points])).rows[0];
        await db.query(`UPDATE company_detail_queries SET state=$2,actual_upstream_points=$3,charged_points=$4,
          detail_id=$5,result=$6,updated_at=clock_timestamp() WHERE id=$1`,
        [queryId, zero ? 'zero' : 'settled', detail.actualUpstreamPoints, charge, zero ? null : detail.data!.id, zero ? null : JSON.stringify(detail.data)]);
        await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,'settle',$4,$5,$6)`, [queryId, query.organization_id, identity.id, charge, after.balance, after.query_frozen]);
        await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,'release',round($4::numeric-$5::numeric,4),$6,$7)`,
        [queryId, query.organization_id, identity.id, query.maximum_points, charge, after.balance, after.query_frozen]);
        if (!zero) await db.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id,fetched_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) ON CONFLICT(organization_id,detail_id) DO NOTHING`,
        [randomUUID(), query.organization_id, detail.data!.id, query.name, query.country_code3, JSON.stringify(detail.data), queryId]);
      });
    } catch {
      return this.get(identity, queryId);
    }
    return this.get(identity, queryId);
  }
  async get(identity: Identity, queryId: string) {
    await this.authorize(identity);
    if (!uuid.test(queryId)) throw new BadRequestException('查询标识无效');
    const row = (await this.pool.query(`SELECT id AS "queryId",state,name,country_code3 AS "countryCode3",
      maximum_points AS "maximumPoints",charged_points AS "chargedPoints",
      CASE WHEN state='settled' THEN result ELSE null END AS result
      FROM company_detail_queries WHERE id=$1 AND organization_id=$2`, [queryId, identity.organization_id])).rows[0];
    if (!row) throw new NotFoundException('查询不存在');
    return row;
  }
  async profiles(identity: Identity) {
    await this.authorize(identity);
    const profiles = (await this.pool.query(`SELECT id,name,country_code3 AS "countryCode3",detail,fetched_at AS "fetchedAt"
      FROM company_profiles WHERE organization_id=$1 ORDER BY name,id`, [identity.organization_id])).rows;
    const account = (await this.pool.query(`SELECT balance,query_frozen AS "queryFrozen",sales_reserved AS "salesReserved",
      balance-query_frozen-sales_reserved AS available FROM internal_point_accounts WHERE organization_id=$1`, [identity.organization_id])).rows[0];
    const ledger = (await this.pool.query(`SELECT l.query_id AS "queryId",l.event,l.amount,l.balance_after AS "balanceAfter",
      l.frozen_after AS "frozenAfter",l.created_at AS "createdAt",q.name,q.maximum_points AS "maximumPoints"
      FROM query_point_ledger l JOIN company_detail_queries q ON q.id=l.query_id
      WHERE l.organization_id=$1 ORDER BY l.id DESC LIMIT 50`, [identity.organization_id])).rows;
    return { profiles, account: account ?? null, ledger };
  }
  async confirmFinalFailure(identity: Identity, body: unknown) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台可核对最终失败');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('核对参数无效');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'evidence,queryId' || !uuid.test(String(input.queryId)) ||
      typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 500)
      throw new BadRequestException('须提供查询标识及最终失败依据');
    const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (org?.kind !== 'platform' || !org.active) throw new ForbiddenException('平台身份不可用');
    return transaction(this.pool, async db => {
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      if (query.state === 'failed') return { queryId: query.id, state: 'failed' };
      if (query.state !== 'pending') throw new ConflictException('仅结果确认中可核对最终失败');
      const account = (await db.query(`UPDATE internal_point_accounts SET query_frozen=query_frozen-$2::numeric
        WHERE organization_id=$1 RETURNING balance,query_frozen`, [query.organization_id, query.maximum_points])).rows[0];
      await db.query(`UPDATE company_detail_queries SET state='failed',charged_points=0,
        updated_at=clock_timestamp() WHERE id=$1`, [query.id]);
      await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'release',$4,$5,$6)`,
      [query.id, query.organization_id, identity.id, query.maximum_points, account.balance, account.query_frozen]);
      await db.query(`INSERT INTO company_detail_reconciliations(query_id,actor_id,evidence) VALUES($1,$2,$3)`,
        [query.id, identity.id, input.evidence]);
      return { queryId: query.id, state: 'failed' };
    });
  }
}
