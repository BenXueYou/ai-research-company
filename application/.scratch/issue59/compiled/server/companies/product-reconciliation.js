import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const points = /^\d{1,12}(\.\d{1,4})?$/;
function text(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 500)
        throw new BadRequestException(`${label}必填且不超过500字符`);
    return value.trim();
}
function object(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new BadRequestException('核对参数无效');
    return body;
}
function validResult(value, page) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const result = value;
    return result.page === page.page_no && result.size === page.page_size && Number.isInteger(result.total) &&
        Number(result.total) >= 0 && Array.isArray(result.content) && result.content.length <= page.page_size &&
        result.content.every(item => item && typeof item.name === 'string' && item.name.trim());
}
export class ProductReconciliationService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async authorize(identity) {
        if (identity.role !== 'platform')
            throw new ForbiddenException('仅平台可核对查询');
        const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
        if (org?.kind !== 'platform' || !org.active)
            throw new ForbiddenException('平台身份不可用');
    }
    async list(identity) {
        await this.authorize(identity);
        return (await this.pool.query(`SELECT q.id AS "queryId",q.organization_id AS "organizationId",q.product_desc AS name,
      q.buyer_country_code3 AS "countryCode3",q.state,q.maximum_points AS "maximumPoints",
      q.charged_points AS "chargedPoints",q.coefficient,q.trace_id AS "traceId",q.billing_reference AS "billingReference",
      CASE WHEN q.result IS NULL THEN null ELSE jsonb_build_object('page',q.page_no,'size',q.page_size,'total',q.total,'content',q.result) END AS result,
      q.page_no AS "pageNo",q.page_size AS "pageSize",q.start_date AS "startDate",q.end_date AS "endDate",
      r.evidence AS "reconciliationEvidence",r.actor_id AS "reconciledBy",r.resolved_at AS "reconciledAt",
      l.purpose AS "lossPurpose",l.upstream_points AS "lossUpstreamPoints",e.id AS "expenseId",
      coalesce((SELECT jsonb_agg(jsonb_build_object('traceId',x.trace_id,'billingReference',x.billing_reference,
        'result',x.result,'evidence',x.evidence,'recordedAt',x.recorded_at,'actorId',x.actor_id) ORDER BY x.recorded_at)
        FROM product_search_late_results x WHERE x.page_id=q.id),'[]'::jsonb) AS "lateResults"
      FROM product_search_pages q LEFT JOIN product_search_reconciliations r ON r.page_id=q.id
      LEFT JOIN product_search_losses l ON l.page_id=q.id LEFT JOIN platform_expenses e ON e.product_loss_page_id=q.id
      WHERE q.state<>'quoted' ORDER BY CASE WHEN q.state='pending' THEN 0 ELSE 1 END,q.updated_at DESC,q.id DESC`)).rows;
    }
    async reconcile(identity, body) {
        await this.authorize(identity);
        const input = object(body);
        if (Object.keys(input).some(key => !['queryId', 'outcome', 'billingReference', 'traceId', 'upstreamPoints', 'result', 'evidence'].includes(key)) ||
            !uuid.test(String(input.queryId)) || !['settled', 'zero', 'failed'].includes(String(input.outcome)))
            throw new BadRequestException('核对标识或结果无效');
        const evidence = text(input.evidence, '核对依据');
        const billingReference = text(input.billingReference, '账单引用');
        const traceId = input.traceId == null || input.traceId === '' ? null : text(input.traceId, 'traceId');
        if (input.upstreamPoints !== undefined && (typeof input.upstreamPoints !== 'string' || !points.test(input.upstreamPoints)))
            throw new BadRequestException('实际上游扣点无效');
        if (input.outcome !== 'failed' && (!traceId || input.upstreamPoints === undefined))
            throw new BadRequestException('结算须关联traceId及实际账单扣点');
        if (input.outcome === 'failed' && input.result !== undefined)
            throw new BadRequestException('最终失败不能附可查看结果');
        return transaction(this.pool, async (db) => {
            const page = (await db.query('SELECT * FROM product_search_pages WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
            if (!page)
                throw new NotFoundException('名单页不存在');
            if (page.state !== 'pending') {
                const previous = (await db.query('SELECT * FROM product_search_reconciliations WHERE page_id=$1', [page.id])).rows[0];
                const sameResult = (await db.query('SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS same', [previous?.result_evidence ?? null, input.result === undefined ? null : JSON.stringify(input.result)])).rows[0].same;
                if (previous && previous.outcome === input.outcome && previous.evidence === evidence &&
                    previous.billing_reference === billingReference && previous.trace_id === traceId &&
                    String(page.actual_upstream_points ?? '') === String(input.upstreamPoints ?? '') && sameResult)
                    return { queryId: page.id, state: page.state, chargedPoints: page.charged_points };
                throw new ConflictException('名单页已有不同的最终处理结果');
            }
            const result = input.outcome === 'failed' ? null : input.result;
            if (result !== null && !validResult(result, page))
                throw new BadRequestException('名单页证据与原确认页码不一致');
            if (input.outcome === 'zero' && (result.total !== 0 ||
                result.content.length !== 0))
                throw new BadRequestException('零结果必须证明无候选');
            if (input.outcome === 'settled' && result.total === 0)
                throw new BadRequestException('无候选须按零结果处理');
            const charge = input.outcome === 'settled'
                ? (await db.query('SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount', [input.upstreamPoints, page.coefficient, page.maximum_points])).rows[0].amount
                : '0.0000';
            const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,
        query_frozen=query_frozen-$3::numeric WHERE organization_id=$1 RETURNING balance,query_frozen`, [page.organization_id, charge, page.maximum_points])).rows[0];
            const list = result === null ? null : result.content;
            await db.query(`UPDATE product_search_pages SET state=$2,charged_points=$3,actual_upstream_points=$4,
        total=$5,trace_id=$6,result=$7,billing_reference=$8,updated_at=clock_timestamp() WHERE id=$1`, [page.id, input.outcome, charge, input.upstreamPoints ?? null, result === null ? null : result.total,
                traceId, list === null ? null : JSON.stringify(list), billingReference]);
            if (input.outcome !== 'failed')
                await db.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',$4,$5,$6)`, [page.id, page.organization_id, identity.id, charge, after.balance, after.query_frozen]);
            await db.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'release',round($4::numeric-$5::numeric,4),$6,$7)`, [page.id, page.organization_id, identity.id, page.maximum_points, charge, after.balance, after.query_frozen]);
            if (input.outcome === 'settled')
                for (const [position, item] of list.entries())
                    await db.query(`INSERT INTO product_search_candidates(id,page_id,organization_id,position,source_name)
          VALUES($1,$2,$3,$4,$5)`, [randomUUID(), page.id, page.organization_id, position, item.name]);
            await db.query(`INSERT INTO product_search_reconciliations(page_id,actor_id,outcome,evidence,billing_reference,trace_id,result_evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [page.id, identity.id, input.outcome, evidence, billingReference, traceId,
                result === null ? null : JSON.stringify(result)]);
            const loss = input.outcome === 'settled'
                ? (await db.query('SELECT greatest(round($1::numeric-$2::numeric/$3::numeric,4),0)::numeric(20,4) AS amount', [input.upstreamPoints, page.maximum_points, page.coefficient])).rows[0].amount
                : input.upstreamPoints ?? '0.0000';
            if (Number(loss) > 0)
                await db.query(`INSERT INTO product_search_losses(page_id,purpose,upstream_points,billing_reference,evidence,actor_id)
        VALUES($1,$2,$3,$4,$5,$6)`, [page.id, input.outcome === 'settled' ? 'excess' : 'failure', loss, billingReference, evidence, identity.id]);
            return { queryId: page.id, state: input.outcome, chargedPoints: charge, lossUpstreamPoints: loss };
        });
    }
    async lateResult(identity, body) {
        await this.authorize(identity);
        const input = object(body);
        if (Object.keys(input).some(key => !['queryId', 'billingReference', 'traceId', 'upstreamPoints', 'result', 'evidence'].includes(key)) ||
            !uuid.test(String(input.queryId)))
            throw new BadRequestException('迟到结果参数无效');
        const billingReference = text(input.billingReference, '账单引用');
        const traceId = text(input.traceId, 'traceId');
        const evidence = text(input.evidence, '结果依据');
        if (input.upstreamPoints !== undefined && (typeof input.upstreamPoints !== 'string' || !points.test(input.upstreamPoints)))
            throw new BadRequestException('迟到账单扣点无效');
        return transaction(this.pool, async (db) => {
            const page = (await db.query('SELECT * FROM product_search_pages WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
            if (!page)
                throw new NotFoundException('名单页不存在');
            if (page.state !== 'failed')
                throw new ConflictException('仅最终失败退款后的名单页可登记迟到结果');
            if (!validResult(input.result, page))
                throw new BadRequestException('迟到名单页与原确认页码不一致');
            if (input.upstreamPoints !== undefined && Number(input.upstreamPoints) > 0) {
                const prior = (await db.query('SELECT upstream_points FROM product_search_losses WHERE page_id=$1', [page.id])).rows[0];
                if (prior && Number(prior.upstream_points) !== Number(input.upstreamPoints))
                    throw new ConflictException('该名单页已有不同损耗扣点，须核对账单');
                await db.query(`INSERT INTO product_search_losses(page_id,purpose,upstream_points,billing_reference,evidence,actor_id)
          VALUES($1,'failure',$2,$3,$4,$5) ON CONFLICT(page_id) DO NOTHING`, [page.id, input.upstreamPoints, billingReference, evidence, identity.id]);
            }
            await db.query(`INSERT INTO product_search_late_results(id,page_id,actor_id,trace_id,billing_reference,result,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(page_id,trace_id,billing_reference) DO NOTHING`, [randomUUID(), page.id, identity.id, traceId, billingReference, JSON.stringify(input.result), evidence]);
            const saved = (await db.query(`SELECT id,result,evidence FROM product_search_late_results
        WHERE page_id=$1 AND trace_id=$2 AND billing_reference=$3`, [page.id, traceId, billingReference])).rows[0];
            const same = (await db.query('SELECT $1::jsonb=$2::jsonb AS same', [saved.result, JSON.stringify(input.result)])).rows[0].same;
            if (!same || saved.evidence !== evidence)
                throw new ConflictException('相同回执已有不同结果证据');
            return { queryId: page.id, lateResultId: saved.id, state: 'failed' };
        });
    }
}
//# sourceMappingURL=product-reconciliation.js.map