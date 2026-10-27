import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './database.js';
import type { Identity } from './identity.js';
import type { CompanySearchService } from './company-search.js';

export interface ImporterNameInput {
  catalog: 'imports';
  productDesc: string;
  buyerCountryCode3: string;
  startDate: string;
  endDate: string;
  pageNo: number;
  pageSize: number;
}
export interface ImporterNamePage {
  content: Array<{ name: string }>;
  page: number;
  size: number;
  total: number;
  traceId?: string;
  actualUpstreamPoints?: string;
}
export interface ImporterNameClient {
  readonly buyerCountryFilterVerified: true;
  importerNames(input: ImporterNameInput): Promise<ImporterNamePage>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = new Set(['productDesc', 'buyerCountryCode3', 'startDate', 'endDate', 'pageNo', 'pageSize']);
function dateValue(value: unknown) {
  if (!(value instanceof Date)) return String(value);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function inputObject(body: unknown, allowed: Set<string>) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求参数无效');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.has(key))) throw new BadRequestException('请求包含未支持字段');
  return input;
}
function id(body: unknown, key: string) {
  const input = inputObject(body, new Set([key]));
  if (Object.keys(input).length !== 1 || typeof input[key] !== 'string' || !uuid.test(input[key]))
    throw new BadRequestException('请求标识无效');
  return input[key];
}
function quoteInput(body: unknown): Omit<ImporterNameInput, 'catalog'> {
  const input = inputObject(body, fields);
  if (typeof input.productDesc !== 'string' || input.productDesc.length < 2 || input.productDesc.length > 200 ||
    input.productDesc !== input.productDesc.trim() || input.productDesc === '*')
    throw new BadRequestException('产品词须为至少两个字符且不得包含首尾空格');
  if (typeof input.buyerCountryCode3 !== 'string' || !/^[A-Z]{3}$/.test(input.buyerCountryCode3))
    throw new BadRequestException('请选择采购企业所在国三位代码');
  if (typeof input.startDate !== 'string' || typeof input.endDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))
    throw new BadRequestException('请选择贸易时间范围');
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (!Number.isFinite(days) || start.toISOString().slice(0, 10) !== input.startDate ||
    end.toISOString().slice(0, 10) !== input.endDate || days < 0 || days > 1096)
    throw new BadRequestException('贸易时间范围无效或超过三年');
  const pageNo = input.pageNo ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(pageNo) || Number(pageNo) < 1 || Number(pageNo) > 1000 ||
    !Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 20 || Number(pageNo) * Number(pageSize) > 10_000)
    throw new BadRequestException('分页参数无效');
  return {
    productDesc: input.productDesc,
    buyerCountryCode3: input.buyerCountryCode3,
    startDate: input.startDate,
    endDate: input.endDate,
    pageNo: Number(pageNo),
    pageSize: Number(pageSize)
  };
}

export class ProductSearchService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly client: ImporterNameClient | undefined,
    private readonly companySearch: CompanySearchService,
    private readonly production: boolean
  ) {}
  private async authorize(identity: Identity) {
    if (!['admin', 'sales'].includes(identity.role)) throw new ForbiddenException('仅终端企业成员可查询产品候选');
    const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (org?.kind !== 'terminal' || !org.active) throw new ForbiddenException('终端企业不可用');
  }
  private assertCountryMapping() {
    // The -name DTO has only name. A destination-country field cannot prove the buyer's location.
    if (!this.client || this.client.buyerCountryFilterVerified !== true)
      throw new ConflictException('采购企业所在国映射尚未核实，不能付费查询');
  }
  async quote(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = quoteInput(body);
    this.assertCountryMapping();
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
        [identity.organization_id, JSON.stringify(input)]);
      const previous = (await db.query(`SELECT * FROM product_search_pages WHERE organization_id=$1 AND product_desc=$2
        AND buyer_country_code3=$3 AND start_date=$4::date AND end_date=$5::date AND page_no=$6 AND page_size=$7
        AND (state IN ('pending','settled','zero') OR (state='quoted' AND coefficient=(SELECT coefficient FROM platform_pricing)))
        ORDER BY created_at DESC LIMIT 1`,
      [identity.organization_id, input.productDesc, input.buyerCountryCode3, input.startDate, input.endDate, input.pageNo, input.pageSize])).rows[0];
      if (previous) return this.pageResult(db, previous);
      const price = (await db.query(`SELECT upstream_unit_price,maximum_billable_units,version FROM interface_prices
        WHERE interface_path='/v2/trade/importers-name' AND (NOT $1::boolean OR evidence_type='supplier_verified')`, [this.production])).rows[0];
      if (!price) throw new ConflictException('产品名单尚无已核实的单价及最高计费量');
      const coefficient = (await db.query('SELECT coefficient FROM platform_pricing FOR SHARE')).rows[0].coefficient as string;
      const maximum = (await db.query(`SELECT round($1::numeric*$2::numeric*$3::numeric,4) AS amount`,
        [price.upstream_unit_price, price.maximum_billable_units, coefficient])).rows[0].amount as string;
      if (Number(maximum) <= 0) throw new ConflictException('产品名单最高扣点额度不可证明');
      const pageId = randomUUID();
      await db.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,
        start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'quoted')`,
      [pageId, identity.organization_id, identity.id, input.productDesc, input.buyerCountryCode3,
        input.startDate, input.endDate, input.pageNo, input.pageSize, coefficient, maximum, price.version]);
      return { pageId, state: 'quoted', ...input, coefficient, maximumPoints: maximum, chargedPoints: null, content: [] };
    });
  }
  private async pageResult(db: pg.Pool | pg.PoolClient, row: Record<string, unknown>) {
    const candidates = (await db.query(`SELECT id AS "candidateId",source_name AS name FROM product_search_candidates
      WHERE page_id=$1 ORDER BY position`, [row.id])).rows;
    return {
      pageId: row.id,
      state: row.state,
      productDesc: row.product_desc,
      buyerCountryCode3: row.buyer_country_code3,
      startDate: dateValue(row.start_date),
      endDate: dateValue(row.end_date),
      pageNo: row.page_no,
      pageSize: row.page_size,
      coefficient: row.coefficient,
      maximumPoints: row.maximum_points,
      chargedPoints: row.charged_points,
      total: row.total,
      content: candidates
    };
  }
  async get(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const pageId = id(body, 'pageId');
    const row = (await this.pool.query('SELECT * FROM product_search_pages WHERE id=$1 AND organization_id=$2',
      [pageId, identity.organization_id])).rows[0];
    if (!row) throw new NotFoundException('产品名单页不存在');
    return this.pageResult(this.pool, row);
  }
  async execute(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const pageId = id(body, 'pageId');
    this.assertCountryMapping();
    const reserved = await transaction(this.pool, async db => {
      const row = (await db.query('SELECT * FROM product_search_pages WHERE id=$1 AND organization_id=$2 FOR UPDATE',
        [pageId, identity.organization_id])).rows[0];
      if (!row) throw new NotFoundException('产品名单授权不存在');
      if (row.state === 'expired') throw new ConflictException('报价系数已变化，请重新报价确认');
      if (row.state !== 'quoted') return null;
      const currentCoefficient = (await db.query('SELECT coefficient FROM platform_pricing')).rows[0].coefficient as string;
      if (Number(row.coefficient) !== Number(currentCoefficient)) throw new ConflictException('报价系数已变化，请重新报价确认');
      const account = (await db.query('SELECT * FROM internal_point_accounts WHERE organization_id=$1 FOR UPDATE',
        [identity.organization_id])).rows[0];
      if (!account || Number(account.balance) - Number(account.query_frozen) - Number(account.sales_reserved) < Number(row.maximum_points))
        throw new ConflictException('可用点数不足');
      const after = (await db.query(`UPDATE internal_point_accounts SET query_frozen=query_frozen+$2::numeric
        WHERE organization_id=$1 RETURNING balance,query_frozen`, [identity.organization_id, row.maximum_points])).rows[0];
      await db.query("UPDATE product_search_pages SET state='pending',updated_at=clock_timestamp() WHERE id=$1", [pageId]);
      await db.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'freeze',$4,$5,$6)`,
      [pageId, identity.organization_id, identity.id, row.maximum_points, after.balance, after.query_frozen]);
      return row;
    });
    if (!reserved) return this.get(identity, { pageId });
    let page: ImporterNamePage;
    try {
      page = await this.client!.importerNames({
        catalog: 'imports',
        productDesc: reserved.product_desc,
        buyerCountryCode3: reserved.buyer_country_code3,
        startDate: dateValue(reserved.start_date),
        endDate: dateValue(reserved.end_date),
        pageNo: reserved.page_no,
        pageSize: reserved.page_size
      });
    } catch {
      await this.pool.query(`INSERT INTO tengdao_call_audit(organization_id,actor_id,endpoint,call_class,charge_kind,result)
        VALUES($1,$2,'/v2/trade/importers-name','data','paid','failed')`, [identity.organization_id, identity.id]);
      return this.get(identity, { pageId });
    }
    if (!page || !Array.isArray(page.content) || !Number.isInteger(page.page) || page.page !== reserved.page_no ||
      !Number.isInteger(page.size) || page.size !== reserved.page_size || !Number.isInteger(page.total) || page.total < 0 ||
      page.content.length > page.size || page.content.some(item => !item || typeof item.name !== 'string' || !item.name.trim()))
      return this.get(identity, { pageId });
    const arrivedAfterFailure = await transaction(this.pool, async db => {
      const row = (await db.query('SELECT state FROM product_search_pages WHERE id=$1 FOR UPDATE', [pageId])).rows[0];
      if (row?.state === 'failed') {
        await db.query(`INSERT INTO product_search_late_results(id,page_id,actor_id,trace_id,billing_reference,result,evidence)
          VALUES($1,$2,$3,$4,'unavailable',$5,'原查询异步迟到结果') ON CONFLICT(page_id,trace_id,billing_reference) DO NOTHING`,
        [randomUUID(), pageId, identity.id, page.traceId ?? 'unavailable', JSON.stringify(page)]);
        return true;
      }
      if (row?.state === 'pending') await db.query(`UPDATE product_search_pages SET total=$2,trace_id=$3,result=$4,updated_at=clock_timestamp()
        WHERE id=$1`, [pageId, page.total, page.traceId ?? null, JSON.stringify(page.content)]);
      return false;
    });
    if (arrivedAfterFailure) return this.get(identity, { pageId });
    if (typeof page.actualUpstreamPoints !== 'string' || !/^\d{1,12}(\.\d{1,4})?$/.test(page.actualUpstreamPoints)) {
      return this.get(identity, { pageId });
    }
    try {
      await transaction(this.pool, async db => {
        const row = (await db.query('SELECT * FROM product_search_pages WHERE id=$1 FOR UPDATE', [pageId])).rows[0];
        if (row.state === 'failed') {
          await db.query(`INSERT INTO product_search_late_results(id,page_id,actor_id,trace_id,billing_reference,result,evidence)
            VALUES($1,$2,$3,$4,'unavailable',$5,'原查询异步迟到结果') ON CONFLICT(page_id,trace_id,billing_reference) DO NOTHING`,
          [randomUUID(), pageId, identity.id, page.traceId ?? 'unavailable', JSON.stringify(page)]);
          return;
        }
        if (row.state !== 'pending') return;
        const zero = page.total === 0;
        const charged = zero ? '0.0000' : (await db.query(`SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount`,
          [page.actualUpstreamPoints, row.coefficient, row.maximum_points])).rows[0].amount as string;
        const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,
          query_frozen=query_frozen-$3::numeric WHERE organization_id=$1 RETURNING balance,query_frozen`,
        [row.organization_id, charged, row.maximum_points])).rows[0];
        await db.query(`UPDATE product_search_pages SET state=$2,actual_upstream_points=$3,charged_points=$4,
          total=$5,trace_id=$6,result=$7,updated_at=clock_timestamp() WHERE id=$1`,
        [pageId, zero ? 'zero' : 'settled', page.actualUpstreamPoints, charged, page.total,
          page.traceId ?? null, JSON.stringify(page.content)]);
        await db.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,'settle',$4,$5,$6)`, [pageId, row.organization_id, identity.id, charged, after.balance, after.query_frozen]);
        await db.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,'release',round($4::numeric-$5::numeric,4),$6,$7)`,
        [pageId, row.organization_id, identity.id, row.maximum_points, charged, after.balance, after.query_frozen]);
        if (!zero) for (const [position, item] of page.content.entries())
          await db.query(`INSERT INTO product_search_candidates(id,page_id,organization_id,position,source_name)
            VALUES($1,$2,$3,$4,$5)`, [randomUUID(), pageId, row.organization_id, position, item.name]);
        await db.query(`INSERT INTO tengdao_call_audit(organization_id,actor_id,endpoint,call_class,charge_kind,result,trace_id)
          VALUES($1,$2,'/v2/trade/importers-name','data','paid','success',$3)`,
        [row.organization_id, identity.id, page.traceId ?? null]);
      });
    } catch {
      return this.get(identity, { pageId });
    }
    return this.get(identity, { pageId });
  }
  async checkCandidate(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const candidateId = id(body, 'candidateId');
    const row = (await this.pool.query(`SELECT c.source_name,p.buyer_country_code3 FROM product_search_candidates c
      JOIN product_search_pages p ON p.id=c.page_id WHERE c.id=$1 AND c.organization_id=$2 AND p.state='settled'`,
    [candidateId, identity.organization_id])).rows[0];
    if (!row) throw new NotFoundException('已结算产品候选不存在');
    const search = await this.companySearch.search(identity, {
      name: row.source_name,
      countryCodes: row.buyer_country_code3,
      pageNo: 1,
      pageSize: 20
    });
    await this.pool.query('INSERT INTO product_candidate_checks(product_candidate_id,company_search_id) VALUES($1,$2)',
      [candidateId, search.searchId]);
    return search;
  }
}
