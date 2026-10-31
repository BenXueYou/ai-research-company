import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../database.js';
import type { Identity } from '../identity/identity.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function sourceInput(body: unknown, fields: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('参数无效');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...fields].sort().join(',')) throw new BadRequestException('参数字段无效');
  for (const field of fields) {
    if (field.endsWith('Id') && (typeof input[field] !== 'string' || !uuid.test(input[field] as string)))
      throw new BadRequestException('记录标识无效');
  }
  return input;
}
export async function sourceProfile(db: pg.PoolClient, identity: Identity, profileId: unknown) {
  if (!['admin', 'sales'].includes(identity.role)) throw new ForbiddenException('仅终端企业成员可操作档案');
  const org = (await db.query('SELECT kind,active FROM organizations WHERE id=$1 FOR SHARE', [identity.organization_id])).rows[0];
  if (org?.kind !== 'terminal' || !org.active) throw new ForbiddenException('终端企业不可用');
  const profile = (await db.query('SELECT * FROM company_profiles WHERE id=$1 AND organization_id=$2 FOR UPDATE',
    [profileId, identity.organization_id])).rows[0];
  if (!profile || profile.deleted_at) throw new NotFoundException('本企业有效档案不存在');
  return profile;
}
export async function assertSourceSelection(db: pg.PoolClient, organizationId: string, profile: Record<string, any>, selectionId: string) {
  const selection = (await db.query(`SELECT s.* FROM company_source_selections s
    JOIN company_profile_sources p ON p.id=s.source_id AND p.organization_id=s.organization_id AND p.profile_id=s.profile_id
    JOIN company_candidates c ON c.id=s.candidate_id AND c.organization_id=s.organization_id
    WHERE s.id=$1 AND s.organization_id=$2 AND s.profile_id=$3 AND s.version=$4
      AND c.source_id=s.record_id AND c.source_name=s.name AND c.source_country=s.country_code3`,
  [selectionId, organizationId, profile.id, profile.source_version])).rows[0];
  if (!selection || (profile.country_code3 && profile.country_code3 !== selection.country_code3))
    throw new ConflictException('资料选择已变化或国家不一致，请重新选择');
  return selection;
}
export async function assertCompanyOperation(db: pg.PoolClient, organizationId: string, profileId: string,
  operation: 'contacts' | 'email', expectedVersion?: number | null, production = true) {
  const profile = (await db.query(`SELECT p.* FROM company_profiles p JOIN organizations o ON o.id=p.organization_id
    WHERE p.id=$1 AND p.organization_id=$2 AND p.deleted_at IS NULL AND o.active AND o.kind='terminal' FOR SHARE OF p,o`,
  [profileId, organizationId])).rows[0];
  if (!profile) throw new ForbiddenException('档案不可用');
  if (expectedVersion !== undefined && (expectedVersion === null || expectedVersion !== profile.source_version))
    throw new ConflictException('身份依据已变化，请重新确认');
  if (profile.source_version > 0) {
    const selection = (await db.query(`SELECT id FROM company_source_selections
      WHERE organization_id=$1 AND profile_id=$2 AND version=$3`, [organizationId, profileId, profile.source_version])).rows[0];
    if (!selection) throw new ConflictException('资料选择依据缺失');
    await assertSourceSelection(db, organizationId, profile, selection.id);
  }
  const evidence = (await db.query(`SELECT id FROM company_operation_evidence WHERE organization_id=$1 AND profile_id=$2
    AND source_version=$3 AND operation=$4 AND company_name=$5 AND country_code3=$6 AND revoked_at IS NULL
    AND (NOT $7::boolean OR evidence_kind='supplier_verified') LIMIT 1`,
  [organizationId, profileId, profile.source_version, operation, profile.name, profile.country_code3, production])).rows[0];
  if (!evidence || profile.identity_state === 'conflict') throw new ConflictException('企业身份及联系人归属依据不足，请补充核实');
  return profile.source_version as number;
}

export class CompanySourceService {
  constructor(private readonly pool: pg.Pool) {}
  async list(identity: Identity, body: unknown) {
    const input = sourceInput(body, ['profileId']);
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const profile = await sourceProfile(db, identity, input.profileId);
      const candidates = (await db.query(`SELECT s.id AS "sourceId",s.source_kind AS "sourceKind",c.id AS "candidateId",
        c.source_id AS "recordId",c.source_name AS name,c.source_country AS "countryCode3"
        FROM company_profile_sources s JOIN company_candidates c ON c.organization_id=s.organization_id AND (
          (s.source_kind='company_candidate' AND c.id=s.source_record_id) OR
          (s.source_kind='product_candidate' AND EXISTS (SELECT 1 FROM product_candidate_checks pc
            WHERE pc.product_candidate_id=s.source_record_id AND pc.company_search_id=c.search_id)))
        WHERE s.organization_id=$1 AND s.profile_id=$2 ORDER BY s.created_at,c.id`, [identity.organization_id, profile.id])).rows;
      const selection = (await db.query(`SELECT id,source_id AS "sourceId",candidate_id AS "candidateId",version,
        record_id AS "recordId",name,country_code3 AS "countryCode3" FROM company_source_selections
        WHERE organization_id=$1 AND profile_id=$2 AND version=$3`, [identity.organization_id, profile.id, profile.source_version])).rows[0] ?? null;
      const snapshots = (await db.query(`SELECT d.id,d.state,d.reason,d.payload,d.created_at AS "createdAt",s.record_id AS "recordId"
        FROM company_detail_snapshots d JOIN company_source_selections s ON s.id=d.selection_id
        WHERE d.organization_id=$1 AND d.profile_id=$2 ORDER BY d.created_at DESC,d.id`, [identity.organization_id, profile.id])).rows;
      return { version: profile.source_version, selection, candidates, snapshots, displayedSnapshotId: profile.displayed_snapshot_id };
    });
  }
  async select(identity: Identity, body: unknown) {
    const input = sourceInput(body, ['profileId', 'sourceId', 'candidateId', 'expectedVersion', 'requestId']);
    if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) throw new BadRequestException('选择版本无效');
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const profile = await sourceProfile(db, identity, input.profileId);
      const previous = (await db.query(`SELECT * FROM company_source_selections WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3`,
        [identity.organization_id, identity.id, input.requestId])).rows[0];
      if (previous) {
        if (previous.profile_id !== profile.id || previous.source_id !== input.sourceId || previous.candidate_id !== input.candidateId || previous.version !== Number(input.expectedVersion) + 1)
          throw new ConflictException('同一请求不能改变选择');
        return { selectionId: previous.id, version: previous.version };
      }
      if (profile.source_version !== input.expectedVersion) throw new ConflictException('资料选择已变化，请刷新后重试');
      const source = (await db.query(`SELECT * FROM company_profile_sources WHERE id=$1 AND organization_id=$2 AND profile_id=$3 FOR SHARE`,
        [input.sourceId, identity.organization_id, profile.id])).rows[0];
      const candidate = (await db.query(`SELECT * FROM company_candidates WHERE id=$1 AND organization_id=$2 FOR SHARE`,
        [input.candidateId, identity.organization_id])).rows[0];
      if (!source || !candidate) throw new NotFoundException('档案来源不存在');
      let valid = source.source_kind === 'company_candidate' && source.source_record_id === candidate.id;
      if (source.source_kind === 'product_candidate') {
        valid = !!(await db.query(`SELECT 1 FROM product_candidate_checks pc
          JOIN product_search_candidates c ON c.id=pc.product_candidate_id
          JOIN product_search_pages p ON p.id=c.page_id WHERE pc.product_candidate_id=$1 AND pc.company_search_id=$2
          AND p.organization_id=$3 AND p.buyer_country_code3=$4`,
        [source.source_record_id, candidate.search_id, identity.organization_id, candidate.source_country])).rowCount;
      }
      if (!valid || !candidate.source_id || !/^[A-Z]{3}$/.test(candidate.source_country) ||
        (profile.country_code3 && profile.country_code3 !== candidate.source_country)) throw new ConflictException('候选与来源或国家不一致');
      const selectionId = randomUUID();
      const version = profile.source_version + 1;
      await db.query(`UPDATE company_detail_queries SET state='expired' WHERE organization_id=$1 AND target_profile_id=$2 AND state='quoted'`,
        [identity.organization_id, profile.id]);
      await db.query(`INSERT INTO company_source_selections(id,organization_id,profile_id,source_id,candidate_id,version,
        request_id,record_id,name,country_code3,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [selectionId, identity.organization_id, profile.id, source.id, candidate.id, version, input.requestId,
        candidate.source_id, candidate.source_name, candidate.source_country, identity.id]);
      await db.query(`UPDATE company_profiles SET source_version=$3,identity_state='pending' WHERE id=$1 AND organization_id=$2`,
        [profile.id, identity.organization_id, version]);
      return { selectionId, version };
    });
  }
  async display(identity: Identity, body: unknown) {
    const input = sourceInput(body, ['profileId', 'snapshotId', 'expectedVersion']);
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const profile = await sourceProfile(db, identity, input.profileId);
      if (profile.source_version !== input.expectedVersion) throw new ConflictException('资料选择已变化，请刷新后重试');
      const snapshot = (await db.query(`SELECT * FROM company_detail_snapshots WHERE id=$1 AND organization_id=$2 AND profile_id=$3 AND state='ready'`,
        [input.snapshotId, identity.organization_id, profile.id])).rows[0];
      if (!snapshot) throw new NotFoundException('可展示资料不存在');
      if (profile.displayed_snapshot_id === snapshot.id) return { snapshotId: snapshot.id };
      const collision = (await db.query('SELECT id FROM company_profiles WHERE organization_id=$1 AND detail_id=$2 AND id<>$3',
        [identity.organization_id, snapshot.payload.id, profile.id])).rowCount;
      if (collision) throw new ConflictException('该资料已关联其他档案，请核实归属');
      if (profile.country_code3 && snapshot.payload.countryCode3 !== profile.country_code3)
        throw new ConflictException('资料国家与档案不一致');
      await db.query(`UPDATE company_profiles SET displayed_snapshot_id=$3,detail_id=$4,detail=$5,query_id=$6,
        detail_state='ready',fetched_at=$7 WHERE id=$1 AND organization_id=$2`,
      [profile.id, identity.organization_id, snapshot.id, snapshot.payload.id, snapshot.payload, snapshot.query_id, snapshot.created_at]);
      await db.query(`INSERT INTO company_detail_display_events(organization_id,profile_id,snapshot_id,actor_id) VALUES($1,$2,$3,$4)`,
        [identity.organization_id, profile.id, snapshot.id, identity.id]);
      return { snapshotId: snapshot.id };
    });
  }
}
