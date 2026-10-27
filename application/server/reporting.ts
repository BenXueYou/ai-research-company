import { ForbiddenException } from '@nestjs/common';
import type pg from 'pg';
import type { Identity } from './identity.js';

export class ReportingService {
  constructor(private readonly pool: pg.Pool) {}

  private async actor(identity: Identity) {
    const actor = (await this.pool.query('SELECT kind FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (!actor) throw new ForbiddenException('组织不存在');
    return actor as { kind: string };
  }

  async overview(identity: Identity) {
    const actor = await this.actor(identity);
    const platform = identity.role === 'platform' && actor.kind === 'platform';
    const distributor = identity.role === 'distributor' && actor.kind === 'distributor';
    if (!platform && !distributor && actor.kind !== 'terminal') throw new ForbiddenException('无报表权限');
    const scope = (await this.pool.query(`WITH RECURSIVE visible AS (
      SELECT id,name,kind,parent_id,active,0 AS depth FROM organizations WHERE id=$1
      UNION ALL SELECT child.id,child.name,child.kind,child.parent_id,child.active,visible.depth+1
      FROM organizations child JOIN visible ON child.parent_id=visible.id
    ) SELECT id,name,kind,parent_id AS "parentId",active,depth FROM visible ORDER BY depth,name,id`,
    [identity.organization_id])).rows;
    const ids = scope.map(row => row.id as string);
    const accounts = (await this.pool.query(`SELECT organization_id AS "organizationId",balance,query_frozen AS "queryFrozen",
      sales_reserved AS "salesReserved",balance-query_frozen-sales_reserved AS available
      FROM internal_point_accounts WHERE organization_id=ANY($1::uuid[]) ORDER BY organization_id`,
    [platform || distributor ? ids : [identity.organization_id]])).rows;
    const ledger = (await this.pool.query(`SELECT 'detail' AS source,id,organization_id AS "organizationId",query_id AS "referenceId",
      event,amount,balance_after AS "balanceAfter",frozen_after AS "frozenAfter",created_at AS "createdAt"
      FROM query_point_ledger WHERE organization_id=ANY($1::uuid[])
      UNION ALL SELECT 'contact',id,organization_id,query_id,event,amount,balance_after,frozen_after,created_at
      FROM company_contact_point_ledger WHERE organization_id=ANY($1::uuid[])
      UNION ALL SELECT 'product',id,organization_id,page_id,event,amount,balance_after,frozen_after,created_at
      FROM product_search_ledger WHERE organization_id=ANY($1::uuid[])
      ORDER BY "createdAt",source,id`, [platform ? ids : [identity.organization_id]])).rows;
    if (!platform && !distributor) return {
      role: 'terminal',
      accounts: accounts.map(row => ({ balance: row.balance, queryFrozen: row.queryFrozen })),
      ledger
    };
    const sales = (await this.pool.query(`SELECT t.order_id AS "orderId",t.seller_id AS "sellerId",t.buyer_id AS "buyerId",
      t.quantity,t.sales_amount AS "salesAmount",t.sales_cost AS "salesCost",t.gross_profit AS "grossProfit",
      t.created_at AS "createdAt" FROM point_transfers t WHERE t.seller_id=ANY($1::uuid[])
      ORDER BY t.created_at,t.order_id`, [platform ? ids : [identity.organization_id]])).rows;
    const transactions = (await this.pool.query(`SELECT p.id,p.seller_id AS "sellerId",p.buyer_id AS "buyerId",
      p.quantity,p.amount,p.status,p.created_at AS "createdAt",r.amount AS "refundAmount"
      FROM point_orders p LEFT JOIN point_order_refunds r ON r.order_id=p.id
      WHERE p.seller_id=ANY($1::uuid[]) ORDER BY p.created_at,p.id`,
    [platform ? ids : [identity.organization_id]])).rows;
    const usage = (await this.pool.query(`SELECT organization_id AS "organizationId",source,
      coalesce(sum(amount) FILTER (WHERE event='settle'),0)::numeric(20,4) AS "chargedPoints"
      FROM (SELECT organization_id,'detail' AS source,event,amount FROM query_point_ledger
        UNION ALL SELECT organization_id,'contact',event,amount FROM company_contact_point_ledger
        UNION ALL SELECT organization_id,'product',event,amount FROM product_search_ledger) x
      WHERE organization_id=ANY($1::uuid[]) GROUP BY organization_id,source ORDER BY organization_id,source`, [ids])).rows;
    const emailUsage = (await this.pool.query(`SELECT organization_id AS "organizationId",usage_day AS "usageDay",reserved,used
      FROM email_daily_usage WHERE organization_id=ANY($1::uuid[]) ORDER BY usage_day,organization_id`, [ids])).rows;
    if (distributor) return {
      role: 'distributor', organizations: scope, accounts, ledger, sales, transactions, usage, emailUsage,
      grossProfit: (await this.pool.query(`SELECT coalesce(sum(gross_profit),0)::numeric(20,4) AS value
        FROM point_transfers WHERE seller_id=$1`, [identity.organization_id])).rows[0].value
    };
    const totals = (await this.pool.query(`SELECT
      (SELECT coalesce(sum(gross_profit),0) FROM point_transfers WHERE seller_id=$1)::numeric(20,4) AS "salesGrossProfit",
      (SELECT coalesce(sum(amount),0) FROM platform_expenses)::numeric(20,4) AS "platformExpenses",
      ((SELECT coalesce(sum(gross_profit),0) FROM point_transfers WHERE seller_id=$1)
        -(SELECT coalesce(sum(amount),0) FROM platform_expenses))::numeric(20,4) AS "afterPlatformExpenses"`,
    [identity.organization_id])).rows[0];
    const expenses = (await this.pool.query(`SELECT id,purpose,source_reference AS "sourceReference",amount,
      detail_loss_query_id AS "detailLossQueryId",contact_loss_query_id AS "contactLossQueryId",
      product_loss_page_id AS "productLossPageId",created_at AS "createdAt"
      FROM platform_expenses ORDER BY created_at,id`)).rows;
    const customers = (await this.pool.query(`SELECT id,organization_id AS "organizationId",name,country_code3 AS "countryCode3",
      customer_status AS "customerStatus",deleted_at AS "deletedAt",fetched_at AS "fetchedAt",
      main_products AS "mainProducts",purchasing_needs AS "purchasingNeeds",
      cooperation_intent AS "cooperationIntent",detail
      FROM company_profiles ORDER BY organization_id,id`)).rows;
    const emails = (await this.pool.query(`SELECT b.id,b.organization_id AS "organizationId",b.profile_id AS "profileId",
      b.channel_kind AS "channelKind",b.usage_day AS "usageDay",r.id AS "recipientId",r.status,
      r.email,r.subject,r.content
      FROM email_batches b JOIN email_recipients r ON r.batch_id=b.id ORDER BY b.created_at,b.id,r.id`)).rows;
    const procurement = (await this.pool.query(`SELECT id,event,reference,internal_delta AS "internalDelta",
      upstream_delta AS "upstreamDelta",cash_outflow AS "cashOutflow",expense_delta AS "expenseDelta",
      balance_after AS "balanceAfter",created_at AS "createdAt"
      FROM procurement_ledger ORDER BY id`)).rows;
    const inventory = (await this.pool.query(`SELECT balance,frozen,reserved,average_cost AS "averageCost"
      FROM platform_inventory WHERE singleton=true`)).rows[0];
    return { role: 'platform', organizations: scope, accounts, ledger, sales, transactions, usage, emailUsage,
      totals, expenses, customers, emails, procurement, inventory };
  }

  async exportOwnLedger(identity: Identity): Promise<string> {
    const actor = await this.actor(identity);
    const distributor = identity.role === 'distributor' && actor.kind === 'distributor';
    const platform = identity.role === 'platform' && actor.kind === 'platform';
    if (!distributor && !platform) throw new ForbiddenException('仅平台或分销可导出自有账务');
    const snapshot = await this.overview(identity);
    const rows = distributor ? (snapshot.ledger as Record<string, unknown>[]).map(row =>
      [row.source,row.referenceId,row.event,row.amount,row.balanceAfter,row.frozenAfter,row.createdAt])
      : (snapshot as { procurement: Record<string, unknown>[] }).procurement.map(row =>
        ['procurement',row.reference,row.event,row.cashOutflow,row.balanceAfter,row.expenseDelta,row.createdAt]);
    const sales = (snapshot.sales as Record<string, unknown>[])
      .filter(row => row.sellerId === identity.organization_id).map(row =>
      ['sale',row.orderId,'transferred',row.salesAmount,row.salesCost,row.grossProfit,row.createdAt]);
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [['type','reference','event','amount','balance_or_cost','frozen_or_gross','created_at'],
      ...rows,...sales].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }
}
