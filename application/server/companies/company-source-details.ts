import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../database.js';
import type { Identity } from '../identity/identity.js';
import type { CompanyDetailClient } from './company-detail.js';
import { assertSourceSelection, sourceInput, sourceProfile } from './company-sources.js';

// Shared by the immediate response and later billing/result reconciliation.
export async function publishSourceDetail(db: pg.PoolClient, query: Record<string, any>, data: Record<string, unknown>) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [query.organization_id, 'source-detail-publication']);
  const existing = (await db.query('SELECT state FROM company_detail_snapshots WHERE query_id=$1', [query.id])).rows[0];
  if (existing) return existing.state as string;
  const profile = (await db.query('SELECT * FROM company_profiles WHERE id=$1 AND organization_id=$2 FOR UPDATE',
    [query.target_profile_id, query.organization_id])).rows[0];
  const selection = (await db.query('SELECT * FROM company_source_selections WHERE id=$1 AND organization_id=$2',
    [query.selection_id, query.organization_id])).rows[0];
  const active = (await db.query('SELECT active FROM organizations WHERE id=$1 FOR SHARE', [query.organization_id])).rows[0]?.active;
  let reason: string | null = null;
  let state = data.id === null ? 'zero' : 'ready';
  if (!active || !profile || profile.deleted_at || !selection || profile.source_version !== selection.version) reason = '档案或资料选择已变化';
  else if (data.id !== null && (data.id !== selection.record_id || data.countryCode3 !== selection.country_code3)) reason = '返回记录或国家与所选资料不一致';
  if (!reason) {
    try { await assertSourceSelection(db, query.organization_id, profile, query.selection_id); }
    catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      reason = '所选来源或国家已变化';
    }
  }
  if (!reason && data.id !== null) {
    const collision = (await db.query(`SELECT id FROM company_profiles WHERE organization_id=$1 AND detail_id=$2 AND id<>$3
      UNION ALL SELECT profile_id FROM company_detail_snapshots WHERE organization_id=$1 AND payload->>'id'=$2
      AND profile_id<>$3 AND state='ready' LIMIT 1`, [query.organization_id, data.id, profile.id])).rowCount;
    if (collision) reason = '该资料已归入其他档案，请核实关联';
  }
  if (reason) state = 'conflict';
  const id = randomUUID();
  await db.query(`INSERT INTO company_detail_snapshots(id,organization_id,profile_id,selection_id,query_id,state,payload,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, query.organization_id, query.target_profile_id, query.selection_id, query.id, state, data, reason]);
  await db.query(`UPDATE company_detail_queries SET result=$2,detail_id=$3,result_state=$4,updated_at=clock_timestamp() WHERE id=$1`,
    [query.id, data, typeof data.id === 'string' ? data.id : null, state]);
  if (state === 'ready') {
    const displayed = profile.displayed_snapshot_id && (await db.query(`SELECT s.source_id FROM company_detail_snapshots d
      JOIN company_source_selections s ON s.id=d.selection_id WHERE d.id=$1`, [profile.displayed_snapshot_id])).rows[0];
    if (!profile.detail || (displayed?.source_id === selection.source_id && profile.detail_id === selection.record_id)) {
      await db.query(`UPDATE company_profiles SET displayed_snapshot_id=$3,detail_id=$4,detail=$5,query_id=$6,
        detail_state='ready',fetched_at=clock_timestamp() WHERE id=$1 AND organization_id=$2`,
      [profile.id, query.organization_id, id, data.id, data, query.id]);
    }
  }
  return state;
}

export class CompanySourceDetailService {
  constructor(private readonly pool: pg.Pool, private readonly vendor: CompanyDetailClient, private readonly production: boolean) {}
  private capability() {
    const lookup = this.vendor.recordLookup;
    if (!lookup || !lookup.evidenceReference || (this.production && !lookup.supplierVerified))
      throw new ConflictException('按所选资料查询详情的接口尚待核实，暂不能发起查询');
    return lookup;
  }
  async quote(identity: Identity, body: unknown) {
    const input = sourceInput(body, ['profileId', 'selectionId', 'refresh']);
    if (typeof input.refresh !== 'boolean') throw new ConflictException('更新选择无效');
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const profile = await sourceProfile(db, identity, input.profileId);
      const selection = await assertSourceSelection(db, identity.organization_id, profile, String(input.selectionId));
      if (!input.refresh) {
        const local = (await db.query(`SELECT d.id,d.payload FROM company_detail_snapshots d
          JOIN company_source_selections s ON s.id=d.selection_id
          WHERE d.organization_id=$1 AND d.profile_id=$2 AND s.source_id=$3 AND s.candidate_id=$4
          AND d.state='ready' ORDER BY d.created_at DESC LIMIT 1`, [identity.organization_id, profile.id, selection.source_id, selection.candidate_id])).rows[0];
        if (local) return { localSnapshot: local, chargedPoints: '0.0000', resultState: 'ready' };
      }
      const lookup = this.capability();
      const active = (await db.query(`SELECT * FROM company_detail_queries WHERE organization_id=$1 AND candidate_id=$2
        AND state IN ('quoted','pending')`, [identity.organization_id, selection.candidate_id])).rows[0];
      if (active) {
        if (active.selection_id !== selection.id || active.target_profile_id !== profile.id)
          throw new ConflictException('此来源已有其他查询，请先处理原查询');
        return this.response(active);
      }
      const price = (await db.query(`SELECT * FROM interface_prices WHERE interface_path=$1
        AND (NOT $2::boolean OR evidence_type='supplier_verified')`, [lookup.interfacePath, this.production])).rows[0];
      if (!price) throw new ConflictException('该详情接口尚无已核实单价及最高计费量');
      const coefficient = (await db.query('SELECT coefficient FROM platform_pricing FOR SHARE')).rows[0].coefficient;
      const maximum = (await db.query('SELECT round($1::numeric*$2::numeric*$3::numeric,4) AS amount',
        [price.upstream_unit_price, price.maximum_billable_units, coefficient])).rows[0].amount;
      if (Number(maximum) <= 0) throw new ConflictException('最高扣点额度不可证明');
      const request = { recordId: selection.record_id, name: selection.name, countryCode3: selection.country_code3,
        version: selection.version, interfacePath: lookup.interfacePath, evidenceReference: lookup.evidenceReference };
      const row = (await db.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,
        coefficient,maximum_points,price_version,state,target_profile_id,selection_id,request_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'quoted',$10,$11,$12) RETURNING *`,
      [randomUUID(), identity.organization_id, identity.id, selection.candidate_id, selection.name, selection.country_code3,
        coefficient, maximum, price.version, profile.id, selection.id, request])).rows[0];
      return this.response(row);
    });
  }
  private response(query: Record<string, any>) {
    const result = query.result_state === 'ready' ? query.result : null;
    return { queryId: query.id, profileId: query.target_profile_id, state: query.state, resultState: query.result_state,
      result, name: query.name, countryCode3: query.country_code3,
      maximumPoints: query.maximum_points, coefficient: query.coefficient, chargedPoints: query.charged_points };
  }
  async status(identity: Identity, body: unknown) {
    const input = sourceInput(body, ['queryId']);
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 AND organization_id=$2 AND target_profile_id IS NOT NULL',
        [input.queryId, identity.organization_id])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      await sourceProfile(db, identity, query.target_profile_id);
      return this.response(query);
    });
  }
  async execute(identity: Identity, body: unknown) {
    const input = sourceInput(body, ['queryId']);
    const reserved = await transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 AND organization_id=$2 AND target_profile_id IS NOT NULL FOR UPDATE',
        [input.queryId, identity.organization_id])).rows[0];
      if (!query) throw new NotFoundException('查询不存在');
      const profile = await sourceProfile(db, identity, query.target_profile_id);
      if (query.state === 'expired') throw new ConflictException('报价已过期，请重新确认');
      if (query.state !== 'quoted') return { query, duplicate: true };
      const selection = await assertSourceSelection(db, identity.organization_id, profile, query.selection_id);
      const lookup = this.capability();
      if (lookup.interfacePath !== query.request_snapshot.interfacePath || lookup.evidenceReference !== query.request_snapshot.evidenceReference ||
        selection.version !== query.request_snapshot.version) throw new ConflictException('查询依据已变化，请重新报价');
      const coefficient = (await db.query('SELECT coefficient FROM platform_pricing FOR SHARE')).rows[0].coefficient;
      if (Number(coefficient) !== Number(query.coefficient)) throw new ConflictException('报价系数已变化，请重新报价');
      const account = (await db.query('SELECT * FROM internal_point_accounts WHERE organization_id=$1 FOR UPDATE', [identity.organization_id])).rows[0];
      if (!account || Number(account.balance) - Number(account.query_frozen) - Number(account.sales_reserved) < Number(query.maximum_points))
        throw new ConflictException('可用点数不足');
      const after = (await db.query(`UPDATE internal_point_accounts SET query_frozen=query_frozen+$2::numeric
        WHERE organization_id=$1 RETURNING *`, [identity.organization_id, query.maximum_points])).rows[0];
      await db.query("UPDATE company_detail_queries SET state='pending' WHERE id=$1", [query.id]);
      await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'freeze',$4,$5,$6)`, [query.id, identity.organization_id, identity.id, query.maximum_points, after.balance, after.query_frozen]);
      return { query, duplicate: false };
    });
    if (reserved.duplicate) return this.response(reserved.query);
    const request = reserved.query.request_snapshot;
    let result;
    try { result = await this.capability().detail({ recordId: request.recordId, name: request.name, countryCode3: request.countryCode3 }); }
    catch { return this.status(identity, input); }
    const data = result?.data;
    if (!data || !Object.hasOwn(data, 'id') || (data.id !== null && (typeof data.id !== 'string' || !data.id))) return this.status(identity, input);
    await transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [identity.organization_id, 'company-source-operations']);
      const query = (await db.query('SELECT * FROM company_detail_queries WHERE id=$1 FOR UPDATE', [reserved.query.id])).rows[0];
      if (query.state !== 'pending') {
        await db.query(`INSERT INTO company_detail_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
          VALUES($1,$2,$3,$4,'unavailable',$5,'精确记录查询迟到结果') ON CONFLICT DO NOTHING`,
        [randomUUID(), query.id, identity.id, result.traceId ?? 'unavailable', data]);
        return;
      }
      const state = await publishSourceDetail(db, query, data);
      await db.query('UPDATE company_detail_queries SET trace_id=$2 WHERE id=$1', [query.id, result.traceId ?? null]);
      if (state === 'conflict' || result.actualUpstreamPoints === undefined || !/^\d{1,12}(\.\d{1,4})?$/.test(result.actualUpstreamPoints)) return;
      const charge = state === 'zero' ? '0.0000' : (await db.query('SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount',
        [result.actualUpstreamPoints, query.coefficient, query.maximum_points])).rows[0].amount;
      const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,query_frozen=query_frozen-$3::numeric
        WHERE organization_id=$1 RETURNING *`, [query.organization_id, charge, query.maximum_points])).rows[0];
      await db.query(`UPDATE company_detail_queries SET state=$2,actual_upstream_points=$3,charged_points=$4 WHERE id=$1`,
        [query.id, state === 'zero' ? 'zero' : 'settled', result.actualUpstreamPoints, charge]);
      await db.query(`INSERT INTO query_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',$4,$5,$6),($1,$2,$3,'release',$7::numeric-$4::numeric,$5,$6)`,
      [query.id, query.organization_id, identity.id, charge, after.balance, after.query_frozen, query.maximum_points]);
    });
    return this.status(identity, input);
  }
}
