import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './database.js';
import type { Identity } from './identity.js';
import type { ContactPageResult } from './company-contacts.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const points = /^\d{1,12}(\.\d{1,4})?$/;
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new BadRequestException(`${label}必填且不超过500字符`);
  return value.trim();
}
function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('核对参数无效');
  return body as Record<string, unknown>;
}
export function validPage(value: unknown, query: { page_no: number; page_size: number }): value is NonNullable<ContactPageResult['data']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.list) && [data.pageNo, data.pageSize, data.total].every(Number.isInteger) &&
    data.pageNo === query.page_no && data.pageSize === query.page_size && Number(data.total) >= 0 && Number(data.total) <= 200 &&
    data.list.length <= query.page_size && (data.total !== 0 || data.list.length === 0) &&
    data.list.every(item => item && typeof item === 'object' && typeof item.mailsouId === 'string' && item.mailsouId &&
      typeof item.companyName === 'string' && (typeof item.email === 'string' || item.email == null) &&
      (typeof item.personalEmail === 'string' || item.personalEmail == null) &&
      (typeof item.positionTag === 'string' || item.positionTag == null) &&
      (typeof item.credibility === 'string' || item.credibility == null));
}
export class ContactReconciliationService {
  constructor(private readonly pool: pg.Pool) {}
  private async authorize(identity: Identity) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台可核对查询');
    const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (org?.kind !== 'platform' || !org.active) throw new ForbiddenException('平台身份不可用');
  }
  async list(identity: Identity) {
    await this.authorize(identity);
    return (await this.pool.query(`SELECT q.id AS "queryId",q.organization_id AS "organizationId",q.company_name AS name,
      p.country_code3 AS "countryCode3",q.state,q.maximum_points AS "maximumPoints",q.charged_points AS "chargedPoints",
      q.coefficient,q.trace_id AS "traceId",q.billing_reference AS "billingReference",q.result_evidence AS result,
      q.page_no AS "pageNo",q.page_size AS "pageSize",q.position_tags AS "positionTags",
      r.evidence AS "reconciliationEvidence",r.actor_id AS "reconciledBy",r.resolved_at AS "reconciledAt",
      l.purpose AS "lossPurpose",l.upstream_points AS "lossUpstreamPoints",e.id AS "expenseId",
      coalesce((SELECT jsonb_agg(jsonb_build_object('traceId',x.trace_id,'billingReference',x.billing_reference,
        'result',x.result,'evidence',x.evidence,'recordedAt',x.recorded_at,'actorId',x.actor_id) ORDER BY x.recorded_at)
        FROM company_contact_late_results x WHERE x.query_id=q.id),'[]'::jsonb) AS "lateResults"
      FROM company_contact_queries q JOIN company_profiles p ON p.id=q.profile_id
      LEFT JOIN company_contact_reconciliations r ON r.query_id=q.id
      LEFT JOIN company_contact_losses l ON l.query_id=q.id
      LEFT JOIN platform_expenses e ON e.contact_loss_query_id=q.id
      WHERE q.state<>'quoted' ORDER BY CASE WHEN q.state='pending' THEN 0 ELSE 1 END,q.updated_at DESC,q.id DESC`)).rows;
  }
  async reconcile(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = object(body);
    if (Object.keys(input).some(key => !['queryId','outcome','billingReference','traceId','upstreamPoints','result','evidence'].includes(key)) ||
      !uuid.test(String(input.queryId)) || !['settled','zero','failed'].includes(String(input.outcome)))
      throw new BadRequestException('核对标识或结果无效');
    const evidence = text(input.evidence, '核对依据');
    const billingReference = text(input.billingReference, '账单引用');
    const traceId = input.traceId == null || input.traceId === '' ? null : text(input.traceId, 'traceId');
    if (input.upstreamPoints !== undefined && (typeof input.upstreamPoints !== 'string' || !points.test(input.upstreamPoints)))
      throw new BadRequestException('实际上游扣点无效');
    if (input.outcome !== 'failed' && (!traceId || input.upstreamPoints === undefined))
      throw new BadRequestException('结算须关联traceId及实际账单扣点');
    if (input.outcome === 'failed' && input.result !== undefined) throw new BadRequestException('最终失败不能附可查看结果');
    return transaction(this.pool, async db => {
      const query = (await db.query('SELECT * FROM company_contact_queries WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      if (query.state !== 'pending') {
        const previous = (await db.query('SELECT * FROM company_contact_reconciliations WHERE query_id=$1', [query.id])).rows[0];
        const sameResult = (await db.query('SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS same',
          [previous?.result_evidence ?? null, input.result === undefined ? null : JSON.stringify(input.result)])).rows[0].same;
        if (previous && previous.outcome === input.outcome && previous.evidence === evidence &&
          previous.billing_reference === billingReference && previous.trace_id === traceId &&
          String(query.actual_upstream_points ?? '') === String(input.upstreamPoints ?? '') && sameResult)
          return { queryId: query.id, state: query.state, chargedPoints: query.charged_points };
        throw new ConflictException('查询已有不同的最终处理结果');
      }
      const data = input.outcome === 'failed' ? null : input.result;
      if (data !== null && !validPage(data, query)) throw new BadRequestException('联系人页证据与原确认条件不一致');
      if (input.outcome === 'zero' && (data as NonNullable<ContactPageResult['data']>).total !== 0)
        throw new BadRequestException('零结果必须以total=0证明');
      if (input.outcome === 'settled' && (data as NonNullable<ContactPageResult['data']>).total === 0)
        throw new BadRequestException('无联系人须按零结果处理');
      const charge = input.outcome === 'settled'
        ? (await db.query('SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount',
          [input.upstreamPoints, query.coefficient, query.maximum_points])).rows[0].amount as string
        : '0.0000';
      if (query.refresh_requested && input.outcome !== 'failed') {
        await db.query(`UPDATE company_contacts c SET not_returned_in_last_update=true
          FROM company_contact_page_items i JOIN company_contact_queries old ON old.id=i.query_id
          WHERE c.id=i.contact_id AND c.organization_id=$1 AND c.profile_id=$2
            AND old.position_tags=$3 AND old.page_no=$4 AND old.page_size=$5 AND old.state='settled'`,
        [query.organization_id, query.profile_id, query.position_tags, query.page_no, query.page_size]);
      }
      if (input.outcome === 'settled') {
        const page = data as NonNullable<ContactPageResult['data']>;
        for (const item of page.list) {
          const contactId = randomUUID();
          const stored = (await db.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,
            query_company_name,returned_company_name,ownership_status,email,personal_email,position_tag,credibility,source_payload)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT(organization_id,profile_id,mailsou_id) DO UPDATE SET
            query_id=EXCLUDED.query_id,query_company_name=EXCLUDED.query_company_name,
            returned_company_name=EXCLUDED.returned_company_name,ownership_status=EXCLUDED.ownership_status,
            email=EXCLUDED.email,personal_email=EXCLUDED.personal_email,position_tag=EXCLUDED.position_tag,
            credibility=EXCLUDED.credibility,source_payload=EXCLUDED.source_payload,fetched_at=clock_timestamp(),
            not_returned_in_last_update=false
            RETURNING id`, [contactId, query.organization_id, query.profile_id, query.id, item.mailsouId,
            query.company_name, item.companyName, item.companyName === query.company_name ? 'matched' : 'pending',
            item.email ?? null, item.personalEmail ?? null, item.positionTag ?? null, item.credibility ?? null,
            JSON.stringify(item)])).rows[0];
          await db.query('INSERT INTO company_contact_page_items(query_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [query.id, stored.id]);
          await db.query(`INSERT INTO company_contact_source_history(query_id,contact_id,mailsou_id,source_payload,returned_company_name)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [query.id, stored.id, item.mailsouId, JSON.stringify(item), item.companyName]);
        }
      }
      const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,
        query_frozen=query_frozen-$3::numeric WHERE organization_id=$1 RETURNING balance,query_frozen`,
      [query.organization_id, charge, query.maximum_points])).rows[0];
      await db.query(`UPDATE company_contact_queries SET state=$2,charged_points=$3,actual_upstream_points=$4,total=$5,
        result_evidence=$6,trace_id=$7,billing_reference=$8,updated_at=clock_timestamp() WHERE id=$1`,
      [query.id, input.outcome, charge, input.upstreamPoints ?? null, data === null ? null : (data as NonNullable<ContactPageResult['data']>).total,
        data === null ? null : JSON.stringify(data), traceId, billingReference]);
      if (input.outcome !== 'failed') await db.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',$4,$5,$6)`, [query.id, query.organization_id, identity.id, charge, after.balance, after.query_frozen]);
      await db.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'release',round($4::numeric-$5::numeric,4),$6,$7)`,
      [query.id, query.organization_id, identity.id, query.maximum_points, charge, after.balance, after.query_frozen]);
      await db.query(`INSERT INTO company_contact_reconciliations(query_id,actor_id,evidence,outcome,billing_reference,trace_id,result_evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [query.id, identity.id, evidence, input.outcome, billingReference, traceId,
        data === null ? null : JSON.stringify(data)]);
      const loss = input.outcome === 'settled'
        ? (await db.query('SELECT greatest(round($1::numeric-$2::numeric/$3::numeric,4),0)::numeric(20,4) AS amount',
          [input.upstreamPoints, query.maximum_points, query.coefficient])).rows[0].amount as string
        : input.upstreamPoints ?? '0.0000';
      if (Number(loss) > 0) await db.query(`INSERT INTO company_contact_losses(query_id,purpose,upstream_points,billing_reference,evidence,actor_id)
        VALUES($1,$2,$3,$4,$5,$6)`, [query.id, input.outcome === 'settled' ? 'excess' : 'failure', loss, billingReference, evidence, identity.id]);
      return { queryId: query.id, state: input.outcome, chargedPoints: charge, lossUpstreamPoints: loss };
    });
  }
  async lateResult(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = object(body);
    if (Object.keys(input).some(key => !['queryId','billingReference','traceId','upstreamPoints','result','evidence'].includes(key)) ||
      !uuid.test(String(input.queryId))) throw new BadRequestException('迟到结果参数无效');
    const billingReference = text(input.billingReference, '账单引用');
    const traceId = text(input.traceId, 'traceId');
    const evidence = text(input.evidence, '结果依据');
    if (input.upstreamPoints !== undefined && (typeof input.upstreamPoints !== 'string' || !points.test(input.upstreamPoints)))
      throw new BadRequestException('迟到账单扣点无效');
    return transaction(this.pool, async db => {
      const query = (await db.query('SELECT * FROM company_contact_queries WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      if (query.state !== 'failed') throw new ConflictException('仅最终失败退款后的结果可登记为迟到结果');
      if (!validPage(input.result, query)) throw new BadRequestException('迟到联系人页与原确认条件不一致');
      if (input.upstreamPoints !== undefined && Number(input.upstreamPoints) > 0) {
        const priorLoss = (await db.query('SELECT upstream_points FROM company_contact_losses WHERE query_id=$1', [query.id])).rows[0];
        if (priorLoss && Number(priorLoss.upstream_points) !== Number(input.upstreamPoints))
          throw new ConflictException('该查询已有不同的损耗扣点，须核对账单');
        await db.query(`INSERT INTO company_contact_losses(query_id,purpose,upstream_points,billing_reference,evidence,actor_id)
          VALUES($1,'failure',$2,$3,$4,$5) ON CONFLICT(query_id) DO NOTHING`,
        [query.id, input.upstreamPoints, billingReference, evidence, identity.id]);
      }
      await db.query(`INSERT INTO company_contact_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(query_id,trace_id,billing_reference) DO NOTHING`,
      [randomUUID(), query.id, identity.id, traceId, billingReference, JSON.stringify(input.result), evidence]);
      const saved = (await db.query(`SELECT id,result,evidence FROM company_contact_late_results
        WHERE query_id=$1 AND trace_id=$2 AND billing_reference=$3`, [query.id, traceId, billingReference])).rows[0];
      const same = (await db.query('SELECT $1::jsonb=$2::jsonb AS same', [saved.result, JSON.stringify(input.result)])).rows[0].same;
      if (!same || saved.evidence !== evidence) throw new ConflictException('相同回执已有不同结果证据');
      return { queryId: query.id, lateResultId: saved.id, state: 'failed' };
    });
  }
}
