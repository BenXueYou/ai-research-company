import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from './database.js';
import { digest, type Identity } from './identity.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function positive(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(value) || !/[1-9]/.test(value))
    throw new BadRequestException(`${label}须为正数，最多四位小数`);
  return value;
}
function validUuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new BadRequestException(`${label}无效`);
  return value;
}
export class PointOrderService {
  constructor(private readonly pool: pg.Pool) {}

  private async actor(client: pg.PoolClient, identity: Identity, token: string) {
    const actor = (await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [identity.id])).rows[0];
    const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
    if (!actor?.active || !live.rowCount) throw new UnauthorizedException('请重新登录');
    const seller = (await client.query('SELECT * FROM organizations WHERE id=$1 FOR SHARE', [actor.organization_id])).rows[0];
    if (!seller?.active || actor.must_change || !((actor.role==='platform' && seller.kind==='platform') ||
      (actor.role==='distributor' && seller.kind==='distributor')))
      throw new ForbiddenException('仅已完成改密的直属卖方管理员可操作点数订单');
    return seller;
  }

  private async stock(client: pg.PoolClient, seller: { id: string; kind: string }) {
    if (seller.kind==='platform') return (await client.query('SELECT * FROM platform_inventory FOR UPDATE')).rows[0];
    await client.query('INSERT INTO distributor_inventory(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [seller.id]);
    return (await client.query('SELECT * FROM distributor_inventory WHERE organization_id=$1 FOR UPDATE', [seller.id])).rows[0];
  }

  async overview(identity: Identity, token: string) {
    return transaction(this.pool, async client => {
      const seller = await this.actor(client, identity, token);
      const children = (await client.query(`SELECT id,name,kind FROM organizations WHERE parent_id=$1 AND active ORDER BY name,id`, [seller.id])).rows;
      const inventory = seller.kind==='platform'
        ? (await client.query('SELECT balance,frozen,reserved,average_cost FROM platform_inventory')).rows[0]
        : (await client.query('SELECT balance,frozen,reserved,average_cost FROM distributor_inventory WHERE organization_id=$1', [seller.id])).rows[0]
          ?? { balance:'0', frozen:'0', reserved:'0', average_cost:'0' };
      const pricing = (await client.query('SELECT minimum_markup FROM platform_pricing')).rows[0];
      const orders = (await client.query(`SELECT p.id,p.buyer_id AS "buyerId",o.name AS "buyerName",p.quantity,
        p.unit_price AS "unitPrice",p.amount,p.status,p.receipt_reference AS "receiptReference",
        p.created_at AS "createdAt",p.confirmed_at AS "confirmedAt",
        t.gross_profit AS "grossProfit",t.sales_cost AS "salesCost",
        r.amount AS "refundAmount",r.evidence AS "refundEvidence",r.created_at AS "refundedAt"
        FROM point_orders p JOIN organizations o ON o.id=p.buyer_id
        LEFT JOIN point_transfers t ON t.order_id=p.id
        LEFT JOIN point_order_refunds r ON r.order_id=p.id
        WHERE p.seller_id=$1 ORDER BY p.created_at DESC,p.id`, [seller.id])).rows;
      return { sellerId:seller.id, children, inventory, pricing, orders };
    });
  }

  async mutate(identity: Identity, token: string, operation: 'create'|'reprice'|'confirm'|'transfer'|'refund', input: Record<string, unknown>) {
    const fields = operation==='create' ? ['requestId','buyerId','quantity','unitPrice']
      : operation==='reprice' ? ['requestId','orderId','quantity','unitPrice']
        : operation==='confirm' ? ['requestId','orderId','receiptReference']
          : operation==='refund' ? ['requestId','orderId','refundEvidence'] : ['requestId','orderId'];
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)))
      throw new BadRequestException('订单字段无效');
    const requestId = validUuid(input.requestId,'请求标识');
    try {
      return await transaction(this.pool, async client => {
        const seller = await this.actor(client, identity, token);
        // One seller lock serializes duplicate requests, inventory changes and receipt confirmation.
        await client.query('SELECT singleton FROM platform_pricing FOR UPDATE');
        const previous = (await client.query('SELECT * FROM point_order_requests WHERE request_id=$1', [requestId])).rows[0];
        if (previous) {
          const same = (await client.query('SELECT $1::jsonb=$2::jsonb AS same', [previous.payload,JSON.stringify(input)])).rows[0].same;
          if (previous.actor_id!==identity.id || previous.operation!==operation || !same)
            throw new ConflictException('请求标识已用于其他订单操作');
          return previous.result;
        }
        const stock = await this.stock(client,seller);
        const markup = (await client.query('SELECT minimum_markup FROM platform_pricing')).rows[0].minimum_markup;
        let result: Record<string, unknown>;
        if (operation==='create' || operation==='reprice') {
          const quantity = positive(input.quantity,'点数数量');
          const price = positive(input.unitPrice,'每点售价');
          let orderId: string;
          if (operation==='create') {
            const buyerId = validUuid(input.buyerId,'买方标识');
            const buyer = (await client.query('SELECT id FROM organizations WHERE id=$1 AND parent_id=$2 AND active FOR SHARE', [buyerId,seller.id])).rows[0];
            if (!buyer) throw new ForbiddenException('仅可为有效直属下级建单');
            orderId = randomUUID();
          } else {
            orderId = validUuid(input.orderId,'订单标识');
            const current = (await client.query('SELECT * FROM point_orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [orderId,seller.id])).rows[0];
            if (!current) throw new ForbiddenException('订单不在直属卖方范围');
            if (current.status!=='unpaid') throw new ConflictException('已确认收款，数量与售价不可变更');
          }
          const amount = (await client.query(`SELECT round($1::numeric*$2::numeric,4) AS amount,
            $2::numeric >= average_cost*(1+$3::numeric) AS price_ok FROM
            (SELECT $4::numeric AS average_cost) cost`, [quantity,price,markup,stock.average_cost])).rows[0];
          if (!amount.price_ok) throw new ConflictException('售价低于当前成本及最低加价率，请重定价');
          if (Number(amount.amount)<=0) throw new BadRequestException('订单金额舍入后无效');
          if (operation==='create') await client.query(`INSERT INTO point_orders(id,seller_id,buyer_id,quantity,unit_price,amount,status,created_by)
            VALUES($1,$2,$3,$4,$5,$6,'unpaid',$7)`, [orderId,seller.id,input.buyerId,quantity,price,amount.amount,identity.id]);
          else await client.query('UPDATE point_orders SET quantity=$2,unit_price=$3,amount=$4 WHERE id=$1', [orderId,quantity,price,amount.amount]);
          result = { orderId, amount:amount.amount, status:'unpaid' };
        } else if (operation==='confirm') {
          const orderId = validUuid(input.orderId,'订单标识');
          const receipt = input.receiptReference;
          if (typeof receipt!=='string' || !receipt.trim() || receipt.length>500) throw new BadRequestException('须填写线下收款凭证');
          const order = (await client.query('SELECT * FROM point_orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [orderId,seller.id])).rows[0];
          if (!order) throw new ForbiddenException('订单不在直属卖方范围');
          if (order.status!=='unpaid') throw new ConflictException('订单已确认收款，不能重复预留');
          const buyer = (await client.query('SELECT id FROM organizations WHERE id=$1 AND parent_id=$2 AND active FOR SHARE', [order.buyer_id,seller.id])).rows[0];
          if (!buyer) throw new ConflictException('买方已停用或不再是直属下级');
          const priceOk = (await client.query('SELECT $1::numeric >= $2::numeric*(1+$3::numeric) AS ok',
            [order.unit_price,stock.average_cost,markup])).rows[0].ok;
          if (!priceOk) throw new ConflictException('当前成本或最低加价率已变化，原售价过低；请由卖方重定价');
          const available = (await client.query('SELECT $1::numeric-$2::numeric-$3::numeric >= $4::numeric AS ok',
            [stock.balance,stock.frozen,stock.reserved,order.quantity])).rows[0].ok;
          if (!available) throw new ConflictException('可用库存不足，系统未确认收款或预留；线下款可能已到账，请人工核对后处理');
          const table = seller.kind==='platform' ? 'platform_inventory' : 'distributor_inventory';
          const where = seller.kind==='platform' ? 'singleton=true' : 'organization_id=$2';
          const params = seller.kind==='platform' ? [order.quantity] : [order.quantity,seller.id];
          await client.query(`UPDATE ${table} SET reserved=reserved+$1::numeric WHERE ${where}`,params);
          await client.query(`UPDATE point_orders SET status='reserved',receipt_reference=$2,confirmed_by=$3,
            confirmed_at=clock_timestamp() WHERE id=$1`, [orderId,receipt,identity.id]);
          const after = await this.stock(client,seller);
          await client.query(`INSERT INTO point_order_ledger(order_id,seller_id,quantity,balance_after,reserved_after)
            VALUES($1,$2,$3,$4,$5)`, [orderId,seller.id,order.quantity,after.balance,after.reserved]);
          result = { orderId, status:'reserved', reserved:order.quantity };
        } else if (operation==='refund') {
          const orderId = validUuid(input.orderId,'订单标识');
          const evidence = input.refundEvidence;
          if (typeof evidence!=='string' || !evidence.trim() || evidence.length>500)
            throw new BadRequestException('须填写已完成线下整单退款的依据');
          const order = (await client.query('SELECT * FROM point_orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [orderId,seller.id])).rows[0];
          if (!order) throw new ForbiddenException('订单不在直属卖方范围');
          if (order.status!=='reserved') throw new ConflictException('仅已收款待划拨且已预留的订单可确认整单退款');
          const table = seller.kind==='platform' ? 'platform_inventory' : 'distributor_inventory';
          const where = seller.kind==='platform' ? 'singleton=true' : 'organization_id=$2';
          const params = seller.kind==='platform' ? [order.quantity] : [order.quantity,seller.id];
          const after = (await client.query(`UPDATE ${table} SET reserved=reserved-$1::numeric
            WHERE ${where} AND reserved >= $1::numeric RETURNING reserved`,params)).rows[0];
          if (!after) throw new ConflictException('订单预留不一致，须人工核对');
          await client.query(`INSERT INTO point_order_refunds(order_id,seller_id,actor_id,amount,evidence,released_quantity,reserved_after)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,[orderId,seller.id,identity.id,order.amount,evidence,order.quantity,after.reserved]);
          await client.query("UPDATE point_orders SET status='refunded' WHERE id=$1",[orderId]);
          result={orderId,status:'refunded',amount:order.amount,released:order.quantity};
        } else {
          const orderId = validUuid(input.orderId,'订单标识');
          const order = (await client.query('SELECT * FROM point_orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [orderId,seller.id])).rows[0];
          if (!order) throw new ForbiddenException('订单不在直属卖方范围');
          if (order.status!=='reserved') throw new ConflictException('仅已收款待划拨订单可划拨一次');
          const buyer = (await client.query('SELECT id,kind FROM organizations WHERE id=$1 AND parent_id=$2 AND active FOR SHARE', [order.buyer_id,seller.id])).rows[0];
          if (!buyer) throw new ConflictException('买方已停用或不再是直属下级');
          const sellerTable = seller.kind==='platform' ? 'platform_inventory' : 'distributor_inventory';
          const sellerWhere = seller.kind==='platform' ? 'singleton=true' : 'organization_id=$2';
          const sellerParams = seller.kind==='platform' ? [order.quantity] : [order.quantity,seller.id];
          const sellerAfter = (await client.query(`UPDATE ${sellerTable} SET balance=balance-$1::numeric,reserved=reserved-$1::numeric
            WHERE ${sellerWhere} AND reserved >= $1::numeric RETURNING balance,reserved`,sellerParams)).rows[0];
          if (!sellerAfter) throw new ConflictException('订单预留不一致，须人工核对');
          let buyerBalance: string;
          let buyerAverageCost: string | null = null;
          if (buyer.kind==='distributor') {
            await client.query('INSERT INTO distributor_inventory(organization_id) VALUES($1) ON CONFLICT DO NOTHING',[buyer.id]);
            const buyerAfter = (await client.query(`UPDATE distributor_inventory SET
              average_cost=round(((balance*average_cost)+($2::numeric*$3::numeric))/(balance+$2::numeric),4),
              balance=balance+$2::numeric WHERE organization_id=$1 RETURNING balance,average_cost`,
              [buyer.id,order.quantity,order.unit_price])).rows[0];
            buyerBalance=buyerAfter.balance;
            buyerAverageCost=buyerAfter.average_cost;
          } else {
            await client.query('INSERT INTO internal_point_accounts(organization_id) VALUES($1) ON CONFLICT DO NOTHING',[buyer.id]);
            buyerBalance=(await client.query(`UPDATE internal_point_accounts SET balance=balance+$2::numeric
              WHERE organization_id=$1 RETURNING balance`,[buyer.id,order.quantity])).rows[0].balance;
          }
          const accounting=(await client.query(`SELECT round($1::numeric*$2::numeric,4) AS cost,
            $3::numeric-round($1::numeric*$2::numeric,4) AS profit`,[order.quantity,stock.average_cost,order.amount])).rows[0];
          await client.query(`INSERT INTO point_transfers(order_id,seller_id,buyer_id,actor_id,quantity,
            seller_balance_after,seller_reserved_after,buyer_balance_after,buyer_average_cost_after,
            sales_unit_cost,sales_cost,sales_amount,gross_profit)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [orderId,seller.id,buyer.id,identity.id,order.quantity,sellerAfter.balance,sellerAfter.reserved,
              buyerBalance,buyerAverageCost,stock.average_cost,accounting.cost,order.amount,accounting.profit]);
          await client.query("UPDATE point_orders SET status='transferred' WHERE id=$1",[orderId]);
          result={orderId,status:'transferred',quantity:order.quantity};
        }
        await client.query(`INSERT INTO point_order_requests(request_id,actor_id,operation,payload,result)
          VALUES($1,$2,$3,$4,$5)`, [requestId,identity.id,operation,JSON.stringify(input),JSON.stringify(result)]);
        return result;
      });
    } catch (error) {
      if ((error as {code?:string}).code==='23505') throw new ConflictException('收款凭证已用于其他订单或请求已完成');
      if (['23514','22003'].includes((error as {code?:string}).code ?? '')) throw new BadRequestException('订单数量或金额超出有效范围');
      throw error;
    }
  }
}
