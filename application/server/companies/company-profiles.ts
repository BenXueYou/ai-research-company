import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from '../database.js';
import type { Identity } from '../identity/identity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ['lead', 'following', 'replied', 'invalid'] as const;
type Status = typeof STATUSES[number];
type Input = Record<string, unknown>;

function object(body: unknown, keys: string[]): Input {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('档案参数无效');
  const value = body as Input;
  if (Object.keys(value).some(key => !keys.includes(key))) throw new BadRequestException('档案参数无效');
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('档案标识无效');
  return value;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new BadRequestException('档案文字无效');
  return value;
}
function snapshot(row: Record<string, unknown>) {
  return {
    mainProducts: row.main_products,
    purchasingNeeds: row.purchasing_needs,
    cooperationIntent: row.cooperation_intent,
    nextFollowUpAt: row.next_follow_up_at,
    customerStatus: row.customer_status,
    starRating: row.star_rating,
    tags: row.tags,
    deletedAt: row.deleted_at
  };
}

export class CompanyProfileService {
  constructor(private readonly pool: pg.Pool) {}
  private async authorize(identity: Identity, admin = false) {
    if (!['admin', 'sales'].includes(identity.role) || (admin && identity.role !== 'admin'))
      throw new ForbiddenException('无权操作档案');
    const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (org?.kind !== 'terminal' || !org.active) throw new ForbiddenException('终端企业不可用');
  }
  async list(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = object(body, ['customerStatus', 'followUpFrom', 'followUpTo', 'deleted']);
    const status = input.customerStatus === undefined ? null : input.customerStatus;
    if (status !== null && !STATUSES.includes(status as Status)) throw new BadRequestException('客户状态无效');
    const date = (value: unknown) => {
      if (value === undefined) return null;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new BadRequestException('跟进日期无效');
      return value;
    };
    const from = date(input.followUpFrom);
    const to = date(input.followUpTo);
    if (from && to && from > to) throw new BadRequestException('跟进日期范围无效');
    if (input.deleted !== undefined && typeof input.deleted !== 'boolean') throw new BadRequestException('删除筛选无效');
    if (input.deleted === true && identity.role !== 'admin') throw new ForbiddenException('仅管理员可查看已删除档案');
    return (await this.pool.query(`SELECT p.id,p.name,p.country_code3 AS "countryCode3",p.detail,p.fetched_at AS "fetchedAt",
      main_products AS "mainProducts",purchasing_needs AS "purchasingNeeds",cooperation_intent AS "cooperationIntent",
      next_follow_up_at AS "nextFollowUpAt",customer_status AS "customerStatus",star_rating AS "starRating",tags,
      deleted_at AS "deletedAt",identity_state AS "identityState",detail_state AS "detailState",source_version AS "sourceVersion",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sourceKind',s.source_kind,'sourceRecordId',s.source_record_id,'sourcePayload',s.source_payload,
        'searchConditions',s.search_conditions,'pageNo',s.page_no,'createdAt',s.created_at
      ) ORDER BY s.created_at,s.id) FROM company_profile_sources s
        WHERE s.organization_id=p.organization_id AND s.profile_id=p.id),'[]'::jsonb) AS sources
      FROM company_profiles p WHERE p.organization_id=$1 AND customer_status=COALESCE($2,customer_status)
      AND deleted_at IS ${input.deleted === true ? 'NOT NULL' : 'NULL'}
      AND ($3::date IS NULL OR (next_follow_up_at AT TIME ZONE 'Asia/Shanghai')::date >= $3::date)
      AND ($4::date IS NULL OR (next_follow_up_at AT TIME ZONE 'Asia/Shanghai')::date <= $4::date)
      ORDER BY p.name,p.id`, [identity.organization_id, status, from, to])).rows;
  }
  async update(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = object(body, ['profileId', 'mainProducts', 'purchasingNeeds', 'cooperationIntent', 'nextFollowUpAt', 'customerStatus', 'starRating', 'tags']);
    const profileId = id(input.profileId);
    if (Object.keys(input).length < 2) throw new BadRequestException('没有需要修改的字段');
    const changes: Record<string, unknown> = {};
    if ('mainProducts' in input) changes.main_products = text(input.mainProducts, 2000);
    if ('purchasingNeeds' in input) changes.purchasing_needs = text(input.purchasingNeeds, 2000);
    if ('cooperationIntent' in input) changes.cooperation_intent = text(input.cooperationIntent, 2000);
    if ('nextFollowUpAt' in input) {
      if (input.nextFollowUpAt !== null && (typeof input.nextFollowUpAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(input.nextFollowUpAt) || Number.isNaN(Date.parse(input.nextFollowUpAt))))
        throw new BadRequestException('下次跟进时间无效');
      changes.next_follow_up_at = input.nextFollowUpAt;
    }
    if ('customerStatus' in input) {
      if (!STATUSES.includes(input.customerStatus as Status)) throw new BadRequestException('客户状态无效');
      changes.customer_status = input.customerStatus;
    }
    if ('starRating' in input) {
      if (input.starRating !== null && (!Number.isInteger(input.starRating) || Number(input.starRating) < 1 || Number(input.starRating) > 5))
        throw new BadRequestException('星级无效');
      changes.star_rating = input.starRating;
    }
    if ('tags' in input) {
      if (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 50) || new Set(input.tags).size !== input.tags.length)
        throw new BadRequestException('标签无效');
      changes.tags = input.tags;
    }
    return transaction(this.pool, async db => {
      const previous = (await db.query('SELECT * FROM company_profiles WHERE id=$1 AND organization_id=$2 FOR UPDATE', [profileId, identity.organization_id])).rows[0];
      if (!previous || previous.deleted_at) throw new NotFoundException('本企业有效档案不存在');
      const names = Object.keys(changes);
      const values = names.map(name => changes[name]);
      const updated = (await db.query(`UPDATE company_profiles SET ${names.map((name, index) => `${name}=$${index + 3}`).join(',')}
        WHERE id=$1 AND organization_id=$2 RETURNING *`, [profileId, identity.organization_id, ...values])).rows[0];
      await db.query(`INSERT INTO company_profile_events(profile_id,organization_id,actor_id,event,before_value,after_value)
        VALUES($1,$2,$3,'update',$4,$5)`, [profileId, identity.organization_id, identity.id, snapshot(previous), snapshot(updated)]);
      return snapshot(updated);
    });
  }
  async setDeleted(identity: Identity, body: unknown, deleted: boolean) {
    await this.authorize(identity, true);
    const input = object(body, ['profileId']);
    if (Object.keys(input).length !== 1) throw new BadRequestException('档案参数无效');
    const profileId = id(input.profileId);
    return transaction(this.pool, async db => {
      const previous = (await db.query('SELECT * FROM company_profiles WHERE id=$1 AND organization_id=$2 FOR UPDATE', [profileId, identity.organization_id])).rows[0];
      if (!previous) throw new NotFoundException('本企业档案不存在');
      if (Boolean(previous.deleted_at) === deleted) return { profileId, deleted };
      const updated = (await db.query(`UPDATE company_profiles SET deleted_at=${deleted ? 'clock_timestamp()' : 'NULL'},
        deleted_by=$3 WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [profileId, identity.organization_id, deleted ? identity.id : null])).rows[0];
      await db.query(`INSERT INTO company_profile_events(profile_id,organization_id,actor_id,event,before_value,after_value)
        VALUES($1,$2,$3,$4,$5,$6)`, [profileId, identity.organization_id, identity.id, deleted ? 'delete' : 'restore', snapshot(previous), snapshot(updated)]);
      return { profileId, deleted };
    });
  }
  async history(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = object(body, ['profileId']);
    if (Object.keys(input).length !== 1) throw new BadRequestException('档案参数无效');
    const profileId = id(input.profileId);
    const exists = await this.pool.query('SELECT 1 FROM company_profiles WHERE id=$1 AND organization_id=$2', [profileId, identity.organization_id]);
    if (!exists.rowCount) throw new NotFoundException('本企业档案不存在');
    return (await this.pool.query(`SELECT event,actor_id AS "actorId",before_value AS "beforeValue",
      after_value AS "afterValue",created_at AS "createdAt" FROM company_profile_events
      WHERE profile_id=$1 AND organization_id=$2 ORDER BY id DESC`, [profileId, identity.organization_id])).rows;
  }
}
