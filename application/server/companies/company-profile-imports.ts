import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from '../database.js';
import type { Identity } from '../identity/identity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = ['company_candidate', 'product_candidate'] as const;
type SourceKind = typeof SOURCE_KINDS[number];
type ImportItem = { sourceKind: SourceKind; sourceRecordId: string; decision: 'create' };

function input(body: unknown): { requestId: string; items: ImportItem[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('入库参数无效');
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !['requestId', 'items'].includes(key)) ||
    typeof value.requestId !== 'string' || !UUID.test(value.requestId) ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 20)
    throw new BadRequestException('入库参数无效');
  const items = value.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('入库项目无效');
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'decision,sourceKind,sourceRecordId' ||
      !SOURCE_KINDS.includes(record.sourceKind as SourceKind) || record.decision !== 'create' ||
      typeof record.sourceRecordId !== 'string' || !UUID.test(record.sourceRecordId))
      throw new BadRequestException('入库项目无效');
    return {
      sourceKind: record.sourceKind as SourceKind,
      sourceRecordId: record.sourceRecordId,
      decision: 'create' as const
    };
  });
  const unique = new Set(items.map(item => `${item.sourceKind}:${item.sourceRecordId}`));
  if (unique.size !== items.length) throw new BadRequestException('同一来源不能重复提交');
  return { requestId: value.requestId, items };
}

function requestHash(items: ImportItem[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}

function dateValue(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  throw new Error('名单来源日期无效');
}

export class CompanyProfileImportService {
  constructor(private readonly pool: pg.Pool) {}

  private async authorize(identity: Identity): Promise<void> {
    if (!['admin', 'sales'].includes(identity.role)) throw new ForbiddenException('仅终端企业成员可保存企业档案');
    const organization = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1',
      [identity.organization_id])).rows[0];
    if (organization?.kind !== 'terminal' || !organization.active) throw new ForbiddenException('终端企业不可用');
  }

  async import(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const request = input(body);
    const hash = requestHash(request.items);
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
        [identity.organization_id, `${identity.id}:${request.requestId}`]);
      const previous = (await db.query(`SELECT request_hash,response FROM company_profile_import_requests
        WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3`,
      [identity.organization_id, identity.id, request.requestId])).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new ConflictException('相同请求标识不能更改入库内容');
        return previous.response;
      }
      const results = [];
      for (const item of request.items) {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
          [identity.organization_id, `${item.sourceKind}:${item.sourceRecordId}`]);
        const existing = (await db.query(`SELECT profile_id FROM company_profile_sources
          WHERE organization_id=$1 AND source_kind=$2 AND source_record_id=$3`,
        [identity.organization_id, item.sourceKind, item.sourceRecordId])).rows[0];
        if (existing) {
          results.push({ ...item, status: 'linked', profileId: existing.profile_id });
          continue;
        }
        const source = await this.source(db, identity.organization_id, item);
        if (!source) {
          results.push({ ...item, status: 'rejected', reasonCode: 'SOURCE_NOT_FOUND' });
          continue;
        }
        const profileId = randomUUID();
        await db.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id,
          identity_state,detail_state) VALUES($1,$2,NULL,$3,$4,NULL,NULL,'pending','absent')`,
        [profileId, identity.organization_id, source.name, source.countryCode3]);
        await db.query(`INSERT INTO company_profile_sources(id,organization_id,profile_id,source_kind,source_record_id,
          source_payload,search_conditions,page_no,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(), identity.organization_id, profileId, item.sourceKind, item.sourceRecordId,
          source.sourcePayload, source.searchConditions, source.pageNo, identity.id]);
        results.push({ ...item, status: 'created', profileId });
      }
      const response = { requestId: request.requestId, items: results };
      await db.query(`INSERT INTO company_profile_import_requests(organization_id,actor_id,request_id,request_hash,response)
        VALUES($1,$2,$3,$4,$5)`, [identity.organization_id, identity.id, request.requestId, hash, response]);
      return response;
    });
  }

  private async source(db: pg.PoolClient, organizationId: string, item: ImportItem) {
    if (item.sourceKind === 'company_candidate') {
      const row = (await db.query(`SELECT c.source_id,c.source_name,c.source_country,s.name,s.country_codes,s.page_no,s.page_size
        FROM company_candidates c JOIN company_searches s ON s.id=c.search_id
        WHERE c.id=$1 AND c.organization_id=$2`, [item.sourceRecordId, organizationId])).rows[0];
      if (!row) return null;
      return {
        name: row.source_name as string,
        countryCode3: row.source_country as string,
        sourcePayload: { sourceId: row.source_id, name: row.source_name, country: row.source_country },
        searchConditions: { name: row.name, countryCodes: row.country_codes, pageSize: row.page_size },
        pageNo: row.page_no as number
      };
    }
    const row = (await db.query(`SELECT c.source_name,p.product_desc,p.buyer_country_code3,p.start_date,p.end_date,p.page_no,p.page_size
      FROM product_search_candidates c JOIN product_search_pages p ON p.id=c.page_id
      WHERE c.id=$1 AND c.organization_id=$2 AND p.state='settled'`, [item.sourceRecordId, organizationId])).rows[0];
    if (!row) return null;
    return {
      name: row.source_name as string,
      countryCode3: null,
      sourcePayload: { name: row.source_name },
      searchConditions: {
        productDesc: row.product_desc,
        buyerCountryCode3: row.buyer_country_code3,
        startDate: dateValue(row.start_date),
        endDate: dateValue(row.end_date),
        pageSize: row.page_size
      },
      pageNo: row.page_no as number
    };
  }
}
