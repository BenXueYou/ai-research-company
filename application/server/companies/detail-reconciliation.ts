import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../database.js';
import type { Identity } from '../identity/identity.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const points = /^\d{1,12}(\.\d{1,4})?$/;
function required(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new BadRequestException(`${label}必填且不超过500字符`);
  return value.trim();
}
function inputObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('核对参数无效');
  return body as Record<string, unknown>;
}

export class DetailReconciliationService {
  constructor(private readonly pool: pg.Pool) {}
  private async authorize(identity: Identity) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台可核对查询');
    const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (org?.kind !== 'platform' || !org.active) throw new ForbiddenException('平台身份不可用');
  }
  async list(identity: Identity) {
    await this.authorize(identity);
    return (await this.pool.query(`SELECT q.id AS "queryId",q.organization_id AS "organizationId",q.name,q.country_code3 AS "countryCode3",
      q.state,q.maximum_points AS "maximumPoints",q.charged_points AS "chargedPoints",q.coefficient,
      q.trace_id AS "traceId",q.billing_reference AS "billingReference",q.result,q.created_at AS "createdAt",
      r.evidence AS "reconciliationEvidence",r.actor_id AS "reconciledBy",r.resolved_at AS "reconciledAt",
      l.purpose AS "lossPurpose",l.upstream_points AS "lossUpstreamPoints",e.id AS "expenseId",
      coalesce((SELECT jsonb_agg(jsonb_build_object('traceId',x.trace_id,'billingReference',x.billing_reference,
        'result',x.result,'evidence',x.evidence,'recordedAt',x.recorded_at,'actorId',x.actor_id) ORDER BY x.recorded_at)
        FROM company_detail_late_results x WHERE x.query_id=q.id),'[]'::jsonb) AS "lateResults"
      FROM company_detail_queries q LEFT JOIN company_detail_reconciliations r ON r.query_id=q.id
      LEFT JOIN company_detail_losses l ON l.query_id=q.id
      LEFT JOIN platform_expenses e ON e.detail_loss_query_id=q.id
      WHERE q.state<>'quoted' ORDER BY CASE WHEN q.state='pending' THEN 0 ELSE 1 END,q.updated_at DESC,q.id DESC`)).rows;
  }
  async reconcile(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = inputObject(body);
    if (Object.keys(input).some(key => !['queryId','outcome','billingReference','traceId','upstreamPoints','result','evidence'].includes(key)) ||
      !uuid.test(String(input.queryId)) || !['settled','zero','failed'].includes(String(input.outcome)))
      throw new BadRequestException('核对标识或结果无效');
    const evidence = required(input.evidence, '核对依据');
    const billingReference = required(input.billingReference, '账单引用');
    const traceId = input.traceId == null || input.traceId === '' ? null : required(input.traceId, 'traceId');
    if (input.upstreamPoints !== undefined && (typeof input.upstreamPoints !== 'string' || !points.test(input.upstreamPoints)))
      throw new BadRequestException('实际上游扣点无效');
    if (input.outcome !== 'failed' && (!traceId || input.upstreamPoints === undefined))
      throw new BadRequestException('结算须关联traceId及实际账单扣点');
    if (input.outcome === 'failed' && input.result !== undefined) throw new BadRequestException('最终失败不能附可查看结果');
    return transaction(this.pool, async db => {
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      if (query.state !== 'pending') {
        const previous = (await db.query('SELECT * FROM company_detail_reconciliations WHERE query_id=$1', [query.id])).rows[0];
        const sameResult = (await db.query('SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS same',
          [previous?.result_evidence ?? null, input.result === undefined ? null : JSON.stringify(input.result)])).rows[0].same;
        if (previous && previous.outcome === input.outcome && previous.evidence === evidence &&
          previous.billing_reference === billingReference && previous.trace_id === traceId &&
          String(query.actual_upstream_points ?? '') === String(input.upstreamPoints ?? '') && sameResult)
          return { queryId: query.id, state: query.state, chargedPoints: query.charged_points };
        throw new ConflictException('查询已有不同的最终处理结果');
      }
      let result: Record<string, unknown> | null = null;
      if (input.outcome !== 'failed') {
        if (!input.result || typeof input.result !== 'object' || Array.isArray(input.result))
          throw new BadRequestException('须提供可查看结果证据');
        result = input.result as Record<string, unknown>;
        if (input.outcome === 'zero') {
          if (result.id !== null) throw new BadRequestException('零结果必须以data.id=null证明');
        } else if (typeof result.id !== 'string' || !result.id || result.countryCode3 !== query.country_code3)
          throw new BadRequestException('结果标识或国家与已确认查询不一致');
      }
      const charge = input.outcome === 'settled'
        ? (await db.query('SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount',
          [input.upstreamPoints, query.coefficient, query.maximum_points])).rows[0].amount as string
        : '0.0000';
      const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,
        query_frozen=query_frozen-$3::numeric WHERE organization_id=$1 RETURNING balance,query_frozen`,
      [query.organization_id, charge, query.maximum_points])).rows[0];
      await db.query(`UPDATE company_detail_queries SET state=$2,charged_points=$3,actual_upstream_points=$4,
        detail_id=$5,result=$6,trace_id=$7,billing_reference=$8,updated_at=clock_timestamp() WHERE id=$1`,
      [query.id, input.outcome, charge, input.upstreamPoints ?? null, result?.id ?? null,
        result ? JSON.stringify(result) : null, traceId, billingReference]);
      if (input.outcome !== 'failed') await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',$4,$5,$6)`, [query.id, query.organization_id, identity.id, charge, after.balance, after.query_frozen]);
      await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'release',round($4::numeric-$5::numeric,4),$6,$7)`,
      [query.id, query.organization_id, identity.id, query.maximum_points, charge, after.balance, after.query_frozen]);
      await db.query(`INSERT INTO company_detail_reconciliations(query_id,actor_id,evidence,outcome,billing_reference,trace_id,result_evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [query.id, identity.id, evidence, input.outcome, billingReference, traceId, result ? JSON.stringify(result) : null]);
      if (input.outcome === 'settled' && query.refresh_profile_id) {
        await db.query(`UPDATE company_profiles SET detail_id=$3,detail=$4,query_id=$5,fetched_at=clock_timestamp()
          WHERE id=$1 AND organization_id=$2`, [query.refresh_profile_id, query.organization_id,
          result!.id, JSON.stringify(result), query.id]);
      } else if (input.outcome === 'settled') await db.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id,fetched_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) ON CONFLICT(organization_id,detail_id) DO NOTHING`,
      [randomUUID(), query.organization_id, result!.id, query.name, query.country_code3, JSON.stringify(result), query.id]);
      const loss = input.outcome === 'settled'
        ? (await db.query('SELECT greatest(round($1::numeric-$2::numeric/$3::numeric,4),0)::numeric(20,4) AS amount',
          [input.upstreamPoints, query.maximum_points, query.coefficient])).rows[0].amount as string
        : input.upstreamPoints ?? '0.0000';
      if (Number(loss) > 0) await db.query(`INSERT INTO company_detail_losses(query_id,purpose,upstream_points,billing_reference,evidence,actor_id)
        VALUES($1,$2,$3,$4,$5,$6)`, [query.id, input.outcome === 'settled' ? 'excess' : 'failure', loss, billingReference, evidence, identity.id]);
      return { queryId: query.id, state: input.outcome, chargedPoints: charge, lossUpstreamPoints: loss };
    });
  }
  async lateResult(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = inputObject(body);
    if (Object.keys(input).some(key => !['billingReference','evidence','queryId','result','traceId','upstreamPoints'].includes(key)) ||
      !uuid.test(String(input.queryId)))
      throw new BadRequestException('迟到结果参数无效');
    const traceId = required(input.traceId, 'traceId');
    const billingReference = required(input.billingReference, '账单引用');
    const evidence = required(input.evidence, '结果依据');
    if (input.upstreamPoints !== undefined && (typeof input.upstreamPoints !== 'string' || !points.test(input.upstreamPoints)))
      throw new BadRequestException('迟到账单扣点无效');
    if (!input.result || typeof input.result !== 'object' || Array.isArray(input.result)) throw new BadRequestException('结果证据无效');
    return transaction(this.pool, async db => {
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      if (query.state !== 'failed') throw new ConflictException('仅最终失败退款后的结果可登记为迟到结果');
      if (input.upstreamPoints !== undefined && Number(input.upstreamPoints) > 0) {
        const priorLoss = (await db.query('SELECT upstream_points FROM company_detail_losses WHERE query_id=$1', [query.id])).rows[0];
        if (priorLoss && Number(priorLoss.upstream_points) !== Number(input.upstreamPoints))
          throw new ConflictException('该查询已有不同的损耗扣点，须核对账单');
        await db.query(`INSERT INTO company_detail_losses(query_id,purpose,upstream_points,billing_reference,evidence,actor_id)
          VALUES($1,'failure',$2,$3,$4,$5) ON CONFLICT(query_id) DO NOTHING`,
        [query.id, input.upstreamPoints, billingReference, evidence, identity.id]);
      }
      const result = input.result as Record<string, unknown>;
      if (result.id !== null && (typeof result.id !== 'string' || !result.id || result.countryCode3 !== query.country_code3))
        throw new BadRequestException('迟到结果与查询不一致');
      const prior = (await db.query(`SELECT * FROM company_detail_late_results
        WHERE query_id=$1 AND trace_id=$2 AND billing_reference=$3`, [query.id, traceId, billingReference])).rows[0];
      if (prior) {
        const same = (await db.query('SELECT $1::jsonb=$2::jsonb AS same', [prior.result, JSON.stringify(result)])).rows[0].same;
        if (!same || prior.evidence !== evidence)
          throw new ConflictException('相同回执已有不同结果证据');
        return { queryId: query.id, lateResultId: prior.id, state: 'failed' };
      }
      const id = randomUUID();
      await db.query(`INSERT INTO company_detail_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(query_id,trace_id,billing_reference) DO NOTHING`,
      [id, query.id, identity.id, traceId, billingReference, JSON.stringify(result), evidence]);
      const saved = (await db.query(`SELECT id,result,evidence FROM company_detail_late_results
        WHERE query_id=$1 AND trace_id=$2 AND billing_reference=$3`, [query.id, traceId, billingReference])).rows[0];
      const same = (await db.query('SELECT $1::jsonb=$2::jsonb AS same', [saved.result, JSON.stringify(result)])).rows[0].same;
      if (!same || saved.evidence !== evidence)
        throw new ConflictException('相同回执已有不同结果证据');
      return { queryId: query.id, lateResultId: saved.id, state: 'failed' };
    });
  }
}
