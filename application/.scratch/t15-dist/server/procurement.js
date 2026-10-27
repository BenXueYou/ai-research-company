import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { transaction } from './database.js';
import { digest } from './identity.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(input, label) {
    if (typeof input !== 'string' || !input.trim() || input.length > 500)
        throw new BadRequestException(`${label}必填且不超过500字符`);
    return input;
}
function decimal(input, label, zero = false) {
    if (typeof input !== 'string' || !/^\d{1,12}(\.\d{1,8})?$/.test(input) || (!zero && !/[1-9]/.test(input)))
        throw new BadRequestException(`${label}须为有效非负十进制金额或点数`);
    return input;
}
export class ProcurementService {
    pool;
    production;
    constructor(pool, production = false) {
        this.pool = pool;
        this.production = production;
    }
    async authorize(client, identity, token) {
        const actor = (await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [identity.id])).rows[0];
        const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
        if (!actor?.active || !live.rowCount)
            throw new UnauthorizedException('请重新登录');
        const org = (await client.query('SELECT * FROM organizations WHERE id=$1 FOR SHARE', [actor.organization_id])).rows[0];
        if (!org?.active || actor.must_change || actor.role !== 'platform' || org.kind !== 'platform')
            throw new ForbiddenException('仅已完成改密的平台管理员可管理采购与计价');
    }
    async overview(identity, token) {
        return transaction(this.pool, async (client) => {
            await this.authorize(client, identity, token);
            await client.query('SELECT singleton FROM platform_pricing FOR SHARE');
            const pricing = (await client.query('SELECT coefficient,minimum_markup FROM platform_pricing')).rows[0];
            const inventory = (await client.query(`SELECT *,balance-frozen-reserved AS available,
        round(average_cost*(1+(SELECT minimum_markup FROM platform_pricing)),4) AS minimum_sale_price FROM platform_inventory`)).rows[0];
            const totals = (await client.query(`SELECT coalesce(sum(upstream_delta),0)::numeric(20,4) AS recorded_upstream_credits,
        coalesce(sum(cash_outflow),0)::numeric(20,4) AS cash_outflow,
        coalesce(sum(expense_delta),0)::numeric(20,4) AS expenses FROM procurement_ledger`)).rows[0];
            return { currency: 'CNY', pricing, inventory, totals,
                prices: (await client.query(`SELECT * FROM interface_prices WHERE NOT $1::boolean OR evidence_type='supplier_verified' ORDER BY interface_path`, [this.production])).rows,
                purchases: (await client.query('SELECT * FROM point_purchases ORDER BY created_at,id')).rows,
                expenses: (await client.query(`SELECT e.*,
          ARRAY(SELECT p.id FROM point_purchases p WHERE p.expense_id=e.id ORDER BY p.created_at,p.id) AS purchase_ids,
          coalesce((SELECT sum(p.amount) FROM point_purchases p WHERE p.expense_id=e.id),0)::numeric(20,4) AS replenished_amount,
          (coalesce((SELECT sum(p.amount) FROM point_purchases p WHERE p.expense_id=e.id),0)-e.amount)::numeric(20,4) AS reconciliation_difference
          FROM platform_expenses e ORDER BY e.created_at,e.id`)).rows,
                ledger: (await client.query('SELECT * FROM procurement_ledger ORDER BY id')).rows };
        });
    }
    async mutate(identity, token, operation, input) {
        try {
            return await transaction(this.pool, async (client) => {
                await this.authorize(client, identity, token);
                const allowed = operation === 'purchase'
                    ? ['requestId', 'purpose', 'upstreamPoints', 'amount', 'receiptReference', 'evidence', 'expenseId']
                    : operation === 'expense' ? ['requestId', 'purpose', 'amount', 'sourceReference', 'evidence', 'detailLossQueryId', 'contactLossQueryId', 'productLossPageId']
                        : ['requestId', 'minimumMarkup', 'interfacePath', 'upstreamUnitPrice', 'maximumBillableUnits', 'evidence', 'evidenceType'];
                if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) || !uuid.test(String(input.requestId)))
                    throw new BadRequestException('请求字段或幂等标识无效；系数仅可通过生效流程修改');
                await client.query('SELECT singleton FROM platform_pricing FOR UPDATE');
                const previous = (await client.query('SELECT * FROM procurement_requests WHERE request_id=$1', [input.requestId])).rows[0];
                if (previous) {
                    const same = await client.query('SELECT $1::jsonb=$2::jsonb AS same', [previous.payload, JSON.stringify(input)]);
                    if (previous.actor_id !== identity.id || previous.operation !== operation || !same.rows[0].same)
                        throw new ConflictException('请求标识已用于其他提交');
                    return previous.result;
                }
                const config = (await client.query('SELECT * FROM platform_pricing')).rows[0];
                const inventory = (await client.query('SELECT * FROM platform_inventory FOR UPDATE')).rows[0];
                const id = randomUUID();
                let result = { id };
                if (operation === 'pricing') {
                    const evidence = text(input.evidence, '价格依据');
                    if (input.minimumMarkup === undefined && input.interfacePath === undefined)
                        throw new BadRequestException('请提供计价配置');
                    if (input.minimumMarkup !== undefined)
                        await client.query('UPDATE platform_pricing SET minimum_markup=round($1::numeric,4)', [decimal(input.minimumMarkup, '最低加价率', true)]);
                    if (input.interfacePath !== undefined) {
                        if (!['supplier_verified', 'controlled_test'].includes(String(input.evidenceType)) || (this.production && input.evidenceType !== 'supplier_verified'))
                            throw new BadRequestException('生产计价须有已核实供应商依据，禁止使用受控测试价格');
                        const path = text(input.interfacePath, '接口路径');
                        if (!/^\/v[0-9]+\/[a-zA-Z0-9/_-]+$/.test(path) || typeof input.maximumBillableUnits !== 'string' || !/^[1-9]\d{0,8}$/.test(input.maximumBillableUnits))
                            throw new BadRequestException('须提供准确接口路径及已核实的本页最大计费量');
                        await client.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,version,actor_id,evidence_type)
              VALUES($1,round($2::numeric,4),$3,$4,$5,$6,$7) ON CONFLICT(interface_path) DO UPDATE SET
              upstream_unit_price=excluded.upstream_unit_price,maximum_billable_units=excluded.maximum_billable_units,
              evidence=excluded.evidence,evidence_type=excluded.evidence_type,version=excluded.version,actor_id=excluded.actor_id`, [path, decimal(input.upstreamUnitPrice, '上游接口单价', true), input.maximumBillableUnits, evidence, id, identity.id, input.evidenceType]);
                    }
                    else if (input.upstreamUnitPrice !== undefined || input.maximumBillableUnits !== undefined)
                        throw new BadRequestException('接口价格必须关联准确路径');
                    await client.query(`INSERT INTO procurement_ledger(event,reference,actor_id,balance_after,average_cost_after,details)
            VALUES('pricing',$1,$2,$3,$4,$5)`, [id, identity.id, inventory.balance, inventory.average_cost, JSON.stringify({ previous: config, submitted: input })]);
                }
                else {
                    const purpose = text(input.purpose, '用途');
                    if (!(operation === 'purchase' ? ['sale', 'coverage', 'failure', 'excess'] : ['coverage', 'failure', 'excess']).includes(purpose))
                        throw new BadRequestException('用途无效');
                    const amount = decimal(input.amount, '人民币金额');
                    const evidence = text(input.evidence, '核对依据');
                    if (operation === 'purchase' && ['failure', 'excess'].includes(purpose) && !input.expenseId)
                        throw new BadRequestException('失败或超额充值须先登记费用来源，再选择对应费用关联核对');
                    let detailLossQueryId = null;
                    let contactLossQueryId = null;
                    let productLossPageId = null;
                    if ([input.detailLossQueryId, input.contactLossQueryId, input.productLossPageId].filter(Boolean).length > 1)
                        throw new BadRequestException('费用只能关联一笔查询损耗');
                    if (operation === 'expense' && input.detailLossQueryId !== undefined) {
                        if (!uuid.test(String(input.detailLossQueryId)))
                            throw new BadRequestException('查询损耗标识无效');
                        const loss = (await client.query('SELECT purpose FROM company_detail_losses WHERE query_id=$1', [input.detailLossQueryId])).rows[0];
                        if (!loss || loss.purpose !== purpose)
                            throw new BadRequestException('查询损耗不存在或用途不一致');
                        detailLossQueryId = String(input.detailLossQueryId);
                    }
                    if (operation === 'expense' && input.contactLossQueryId !== undefined) {
                        if (!uuid.test(String(input.contactLossQueryId)))
                            throw new BadRequestException('联系人查询损耗标识无效');
                        const loss = (await client.query('SELECT purpose FROM company_contact_losses WHERE query_id=$1', [input.contactLossQueryId])).rows[0];
                        if (!loss || loss.purpose !== purpose)
                            throw new BadRequestException('联系人查询损耗不存在或用途不一致');
                        contactLossQueryId = String(input.contactLossQueryId);
                    }
                    if (operation === 'expense' && input.productLossPageId !== undefined) {
                        if (!uuid.test(String(input.productLossPageId)))
                            throw new BadRequestException('产品名单损耗标识无效');
                        const loss = (await client.query('SELECT purpose FROM product_search_losses WHERE page_id=$1', [input.productLossPageId])).rows[0];
                        if (!loss || loss.purpose !== purpose)
                            throw new BadRequestException('产品名单损耗不存在或用途不一致');
                        productLossPageId = String(input.productLossPageId);
                    }
                    let expenseId = null;
                    if (operation === 'expense' || purpose !== 'sale') {
                        if (operation === 'purchase' && input.expenseId) {
                            if (!uuid.test(String(input.expenseId)))
                                throw new BadRequestException('费用标识无效');
                            const expense = (await client.query(`SELECT * FROM platform_expenses WHERE id=$1
                AND purpose=$2 FOR UPDATE`, [input.expenseId, purpose])).rows[0];
                            if (!expense)
                                throw new BadRequestException('关联费用不存在或用途不一致');
                            expenseId = expense.id;
                        }
                        else {
                            expenseId = operation === 'expense' ? id : randomUUID();
                            const reference = operation === 'expense' ? text(input.sourceReference, '费用来源') : text(input.receiptReference, '充值凭证');
                            await client.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id,detail_loss_query_id,contact_loss_query_id,product_loss_page_id)
                VALUES($1,$2,$3,round($4::numeric,4),$5,$6,$7,$8,$9)`, [expenseId, purpose, reference, amount, evidence, identity.id, detailLossQueryId, contactLossQueryId, productLossPageId]);
                            await client.query(`INSERT INTO procurement_ledger(event,reference,actor_id,expense_delta,balance_after,average_cost_after,details)
                VALUES('expense',$1,$2,round($3::numeric,4),$4,$5,$6)`, [expenseId, identity.id, amount, inventory.balance, inventory.average_cost, JSON.stringify({ purpose, evidence })]);
                        }
                    }
                    else if (input.expenseId)
                        throw new BadRequestException('销售采购不能关联平台承担费用');
                    if (operation === 'purchase') {
                        const upstream = decimal(input.upstreamPoints, '上游点数');
                        const receipt = text(input.receiptReference, '采购凭证');
                        const points = (await client.query(`SELECT round(round($1::numeric,4)*$2::numeric,4)::numeric(20,4) AS generated`, [upstream, purpose === 'sale' ? config.coefficient : '0'])).rows[0].generated;
                        if (purpose === 'sale')
                            await client.query(`UPDATE platform_inventory SET
              average_cost=round((balance*average_cost+round($1::numeric,4))/(balance+$2::numeric),4),balance=balance+$2::numeric`, [amount, points]);
                        await client.query(`INSERT INTO point_purchases(id,purpose,upstream_points,coefficient_snapshot,generated_internal_points,amount,receipt_reference,evidence,expense_id,actor_id)
              VALUES($1,$2,round($3::numeric,4),$4,$5,round($6::numeric,4),$7,$8,$9,$10)`, [id, purpose, upstream, config.coefficient, points, amount, receipt, evidence, expenseId, identity.id]);
                        const after = (await client.query('SELECT * FROM platform_inventory')).rows[0];
                        await client.query(`INSERT INTO procurement_ledger(event,reference,actor_id,internal_delta,upstream_delta,cash_outflow,balance_after,average_cost_after,details)
              VALUES('purchase',$1,$2,$3,round($4::numeric,4),round($5::numeric,4),$6,$7,$8)`, [id, identity.id, points, upstream, amount, after.balance, after.average_cost, JSON.stringify({ purpose, expenseId, coefficientSnapshot: config.coefficient, receiptReference: receipt })]);
                        result = { id, expenseId, generatedInternalPoints: points, coefficientSnapshot: config.coefficient };
                    }
                }
                await client.query('INSERT INTO procurement_requests(request_id,actor_id,operation,payload,result) VALUES($1,$2,$3,$4,$5)', [input.requestId, identity.id, operation, JSON.stringify(input), JSON.stringify(result)]);
                return result;
            });
        }
        catch (error) {
            const code = error.code;
            if (code === '23505')
                throw new ConflictException('凭证、费用来源或费用关联已入账，请核对已有记录');
            if (code === '23514' || code === '22003' || code === '22012')
                throw new BadRequestException('金额或点数舍入后无效或超出范围');
            throw error;
        }
    }
}
//# sourceMappingURL=procurement.js.map