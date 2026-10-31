import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Identity } from '../identity/identity.js';
import { transaction } from '../database.js';
import type { CompanyListRequestDto, TengdaoCompanyClient } from '../upstream/tengdao.js';

const allowedSearch = new Set(['name', 'countryCodes', 'pageNo', 'pageSize']);
const allowedVerify = new Set(['candidateId']);
function exactObject(value: unknown, allowed: Set<string>): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求参数无效');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.has(key))) throw new BadRequestException('请求包含未支持字段');
  return record;
}
function searchDto(value: unknown): CompanyListRequestDto {
  const input = exactObject(value, allowedSearch);
  if (typeof input.name !== 'string' || input.name.length === 0 || input.name !== input.name.trim() || input.name.length > 200)
    throw new BadRequestException('公司名称必填，且不得包含首尾空格');
  if (typeof input.countryCodes !== 'string' || !/^[A-Z]{3}(,[A-Z]{3})*$/.test(input.countryCodes))
    throw new BadRequestException('国家地区须使用三位大写代码，多个代码以英文逗号分隔');
  const pageNo = input.pageNo ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(pageNo) || Number(pageNo) < 1 || Number(pageNo) > 1000 || !Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 20 || Number(pageNo) * Number(pageSize) > 10_000)
    throw new BadRequestException('分页参数无效');
  return { name: input.name, countryCodes: input.countryCodes, pageNo: Number(pageNo), pageSize: Number(pageSize) };
}

export class CompanySearchService {
  constructor(private readonly pool: pg.Pool, private readonly client: TengdaoCompanyClient) {}
  private async authorize(identity: Identity) {
    if (!['admin', 'sales'].includes(identity.role)) throw new ForbiddenException('仅终端企业成员可找企业');
    const organization = await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id]);
    if (organization.rows[0]?.kind !== 'terminal' || !organization.rows[0]?.active)
      throw new ForbiddenException('仅启用的终端企业可找企业');
  }
  async search(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = searchDto(body);
    let page;
    try {
      page = await this.client.listCompanies(input);
    } catch (error) {
      await this.pool.query(`INSERT INTO tengdao_call_audit(organization_id,actor_id,endpoint,call_class,charge_kind,result)
        VALUES($1,$2,'/v2/company/list','data','free','failed')`, [identity.organization_id, identity.id]);
      throw error;
    }
    const searchId = randomUUID();
    const candidates = page.content.map(item => ({ candidateId: randomUUID(), sourceId: item.id, name: item.name, country: item.country, verificationStatus: 'pending' as const, identityGateBlocksContacts: true, identityGateBlocksEmail: true }));
    await transaction(this.pool, async db => {
      await db.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,trace_id,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_verification')`, [searchId, identity.organization_id, identity.id, input.name, input.countryCodes, input.pageNo, input.pageSize, page.total, page.traceId ?? null]);
      for (const candidate of candidates)
        await db.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country)
          VALUES($1,$2,$3,$4,$5,$6)`, [candidate.candidateId, searchId, identity.organization_id, candidate.sourceId, candidate.name, candidate.country]);
      await db.query(`INSERT INTO tengdao_call_audit(organization_id,actor_id,endpoint,call_class,charge_kind,result,trace_id)
        VALUES($1,$2,'/v2/company/list','data','free','success',$3)`, [identity.organization_id, identity.id, page.traceId ?? null]);
    });
    return { searchId, query: input, ...page, content: candidates, chargedInternalPoints: '0.0000', requiresExplicitVerification: true };
  }
  async verify(identity: Identity, body: unknown) {
    await this.authorize(identity);
    const input = exactObject(body, allowedVerify);
    if (typeof input.candidateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.candidateId)) throw new BadRequestException('候选标识无效');
    return transaction(this.pool, async db => {
      const found = await db.query(`SELECT c.*,s.status AS search_status FROM company_candidates c JOIN company_searches s ON s.id=c.search_id
        WHERE c.id=$1 AND c.organization_id=$2 FOR UPDATE OF c,s`, [input.candidateId, identity.organization_id]);
      const candidate = found.rows[0];
      if (!candidate) throw new NotFoundException('候选不存在');
      const productCountry = (await db.query(`SELECT p.buyer_country_code3 FROM product_candidate_checks pc
        JOIN product_search_candidates c ON c.id=pc.product_candidate_id
        JOIN product_search_pages p ON p.id=c.page_id WHERE pc.company_search_id=$1 LIMIT 1`,
      [candidate.search_id])).rows[0]?.buyer_country_code3;
      if (productCountry && candidate.source_country !== productCountry)
        throw new ConflictException('返回企业国家与所选采购企业所在国不一致');
      if (candidate.verification_status === 'not_selected')
        throw new ConflictException('此线索已选择其他身份候选');
      if (candidate.verification_status !== 'verified') {
        if (productCountry) await db.query(`UPDATE company_candidates SET verification_status='not_selected'
          WHERE search_id=$1 AND id<>$2 AND verification_status='pending'`, [candidate.search_id, candidate.id]);
        await db.query(`UPDATE company_candidates SET verification_status='verified',verified_by=$1,verified_at=clock_timestamp() WHERE id=$2`, [identity.id, candidate.id]);
        await db.query("UPDATE company_searches SET status='verified' WHERE id=$1", [candidate.search_id]);
      }
      return { candidateId: candidate.id, sourceId: candidate.source_id, name: candidate.source_name, country: candidate.source_country, verificationStatus: 'verified', identityGateBlocksContacts: true, identityGateBlocksEmail: true };
    });
  }
  async assertVerifiedCandidate(organizationId: string, candidateId: string) {
    const result = await this.pool.query(`SELECT source_id,source_name,source_country FROM company_candidates
      WHERE id=$1 AND organization_id=$2 AND verification_status='verified'`, [candidateId, organizationId]);
    if (!result.rowCount) throw new ForbiddenException('候选身份尚未核实，不能查询联系人或发信');
    return result.rows[0] as { source_id: string; source_name: string; source_country: string };
  }
}
