import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type pg from 'pg';
import type { Identity } from '../identity/identity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = ['company_candidate', 'product_candidate'] as const;
type SourceKind = typeof SOURCE_KINDS[number];
type ImportItem = { sourceKind: SourceKind; sourceRecordId: string; decision: 'create' | 'link'; profileId?: string };
type ImportResult = ImportItem & { status: 'created' | 'linked' | 'rejected' | 'needs_resolution'; reasonCode?: string; candidates?: Array<{ profileId: string; name: string; countryCode3: string | null }> };

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
    const decision = record.decision;
    if (!SOURCE_KINDS.includes(record.sourceKind as SourceKind) ||
      !['create', 'link'].includes(decision as string) ||
      typeof record.sourceRecordId !== 'string' || !UUID.test(record.sourceRecordId) ||
      Object.keys(record).some(key => !['decision', 'sourceKind', 'sourceRecordId', 'profileId'].includes(key)) ||
      (decision === 'link' ? typeof record.profileId !== 'string' || !UUID.test(record.profileId) : record.profileId !== undefined))
      throw new BadRequestException('入库项目无效');
    return {
      sourceKind: record.sourceKind as SourceKind,
      sourceRecordId: record.sourceRecordId,
      decision: decision as ImportItem['decision'],
      ...(decision === 'link' ? { profileId: record.profileId as string } : {})
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

  async import(identity: Identity, body: unknown, resolving = false) {
    await this.authorize(identity);
    const request = input(body);
    const hash = resolving ? createHash('sha256').update(`resolution:${requestHash(request.items)}`).digest('hex') : requestHash(request.items);
    const db = await this.pool.connect();
    try {
      // Keep the organization lock across item commits, including recovery of interrupted requests.
      await db.query('SELECT pg_advisory_lock(hashtext($1),hashtext($2))',
        [identity.organization_id, 'profile-import-association']);
      const previous = (await db.query(`SELECT request_hash,response FROM company_profile_import_requests
        WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3`,
      [identity.organization_id, identity.id, request.requestId])).rows[0];
      if (previous && previous.request_hash !== hash)
        throw new ConflictException('相同请求标识不能更改入库内容');
      const results: ImportResult[] = previous?.response.items ?? [];
      if (!previous) await db.query(`INSERT INTO company_profile_import_requests
        (organization_id,actor_id,request_id,request_hash,response) VALUES($1,$2,$3,$4,$5)`,
      [identity.organization_id, identity.id, request.requestId, hash, { requestId: request.requestId, items: [] }]);
      for (const item of request.items.slice(results.length)) {
        await db.query('BEGIN');
        let failed = false;
        await db.query('SAVEPOINT import_item');
        try {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
          [identity.organization_id, `${item.sourceKind}:${item.sourceRecordId}`]);
        const existing = (await db.query(`SELECT s.profile_id,p.deleted_at FROM company_profile_sources s
          JOIN company_profiles p ON p.organization_id=s.organization_id AND p.id=s.profile_id
          WHERE s.organization_id=$1 AND s.source_kind=$2 AND s.source_record_id=$3 FOR UPDATE OF p`,
        [identity.organization_id, item.sourceKind, item.sourceRecordId])).rows[0];
        if (existing) {
          if (existing.deleted_at) results.push({ ...item, status: 'rejected', reasonCode: 'PROFILE_DELETED' });
          else if (item.decision === 'link' && item.profileId !== existing.profile_id)
            results.push({ ...item, status: 'rejected', reasonCode: 'SOURCE_ALREADY_LINKED' });
          else results.push({ ...item, status: 'linked', profileId: existing.profile_id });
          continue;
        }
        const source = await this.source(db, identity.organization_id, item);
        if (!source) {
          results.push({ ...item, status: 'rejected', reasonCode: 'SOURCE_NOT_FOUND' });
          continue;
        }
        if (item.decision === 'link' && !resolving) {
          results.push({ ...item, status: 'rejected', reasonCode: 'CONFIRMATION_REQUIRED' });
          continue;
        }
        const candidates = (await db.query(`SELECT id AS "profileId",name,country_code3 AS "countryCode3"
          FROM company_profiles WHERE organization_id=$1 AND deleted_at IS NULL AND lower(name)=lower($2)
          ORDER BY id`, [identity.organization_id, source.name])).rows;
        const previouslyResolved = resolving && item.decision === 'create' && candidates.length && (await db.query(`
          SELECT 1 FROM company_profile_import_requests r, jsonb_array_elements(r.response->'items') entry
          WHERE r.organization_id=$1 AND r.actor_id=$2 AND entry->>'status'='needs_resolution'
            AND entry->>'sourceKind'=$3 AND entry->>'sourceRecordId'=$4 LIMIT 1`,
        [identity.organization_id, identity.id, item.sourceKind, item.sourceRecordId])).rowCount;
        if (item.decision === 'create' && candidates.length && !previouslyResolved) {
          results.push({ ...item, status: 'needs_resolution', candidates });
          continue;
        }
        let profileId: string;
        if (item.decision === 'link') {
          const shown = (await db.query(`SELECT 1 FROM company_profile_import_requests r,
            jsonb_array_elements(r.response->'items') entry,
            jsonb_array_elements(COALESCE(entry->'candidates','[]'::jsonb)) candidate
            WHERE r.organization_id=$1 AND r.actor_id=$2 AND entry->>'status'='needs_resolution'
              AND entry->>'sourceKind'=$3 AND entry->>'sourceRecordId'=$4 AND candidate->>'profileId'=$5 LIMIT 1`,
          [identity.organization_id, identity.id, item.sourceKind, item.sourceRecordId, item.profileId])).rowCount;
          if (!shown) {
            results.push({ ...item, status: 'rejected', reasonCode: 'PROFILE_NOT_AVAILABLE' });
            continue;
          }
          const target = (await db.query(`SELECT id FROM company_profiles
            WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE`,
          [item.profileId, identity.organization_id])).rows[0];
          if (!target) {
            results.push({ ...item, status: 'rejected', reasonCode: 'PROFILE_NOT_AVAILABLE' });
            continue;
          }
          profileId = target.id;
        } else {
          profileId = randomUUID();
          await db.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id,
            identity_state,detail_state) VALUES($1,$2,NULL,$3,$4,NULL,NULL,'pending','absent')`,
          [profileId, identity.organization_id, source.name, source.countryCode3]);
        }
        await db.query(`INSERT INTO company_profile_sources(id,organization_id,profile_id,source_kind,source_record_id,
          source_payload,search_conditions,page_no,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(), identity.organization_id, profileId, item.sourceKind, item.sourceRecordId,
          source.sourcePayload, item.decision === 'create' && !previouslyResolved ? source.searchConditions :
            { ...source.searchConditions, association: { decision: item.decision, candidates } }, source.pageNo, identity.id]);
        results.push({ ...item, status: item.decision === 'link' ? 'linked' : 'created', profileId });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (!['23503', '23505', '23514'].includes(code ?? '')) { failed = true; await db.query('ROLLBACK'); throw error; }
          await db.query('ROLLBACK TO SAVEPOINT import_item');
          results.push({ ...item, status: 'rejected', reasonCode: 'ASSOCIATION_CONFLICT' });
        } finally {
          if (!failed) {
            try {
              await db.query('RELEASE SAVEPOINT import_item');
              await db.query(`UPDATE company_profile_import_requests SET response=$4
                WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3`,
              [identity.organization_id, identity.id, request.requestId, { requestId: request.requestId, items: results }]);
              await db.query('COMMIT');
            } catch (error) {
              await db.query('ROLLBACK');
              throw error;
            }
          }
        }
      }
      return { requestId: request.requestId, items: results };
    } finally {
      try {
        await db.query('SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',
          [identity.organization_id, 'profile-import-association']);
      } finally {
        db.release();
      }
    }
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
