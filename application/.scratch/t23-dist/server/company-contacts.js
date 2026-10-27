import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { transaction } from './database.js';
import { validPage } from './contact-reconciliation.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tags = new Set(['EXECUTIVE', 'SALE', 'PURCHASING', 'TECHNOLGY', 'FINANCE', 'PRODUCER', 'SHAREHOLDER', 'MANAGEMENT', 'UNSPECIFIED']);
function queryId(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new BadRequestException('请求参数无效');
    const input = body;
    if (Object.keys(input).length !== 1 || !uuid.test(String(input.queryId)))
        throw new BadRequestException('查询标识无效');
    return String(input.queryId);
}
export class CompanyContactService {
    pool;
    vendor;
    production;
    constructor(pool, vendor, production) {
        this.pool = pool;
        this.vendor = vendor;
        this.production = production;
    }
    async authorize(identity) {
        if (!['admin', 'sales'].includes(identity.role))
            throw new ForbiddenException('仅终端企业成员可查看联系人');
        const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
        if (org?.kind !== 'terminal' || !org.active)
            throw new ForbiddenException('终端企业不可用');
    }
    async quote(identity, body) {
        await this.authorize(identity);
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new BadRequestException('请求参数无效');
        const input = body;
        if (Object.keys(input).sort().join(',') !== 'pageNo,pageSize,positionTags,profileId' ||
            !uuid.test(String(input.profileId)) || !Number.isInteger(input.pageNo) || Number(input.pageNo) < 1 ||
            !Number.isInteger(input.pageSize) || Number(input.pageSize) < 1 ||
            !Array.isArray(input.positionTags) || input.positionTags.length > tags.size ||
            !input.positionTags.every(tag => typeof tag === 'string' && tags.has(tag)) ||
            new Set(input.positionTags).size !== input.positionTags.length)
            throw new BadRequestException('联系人页码或职位标签无效');
        const positionTags = input.positionTags;
        return transaction(this.pool, async (db) => {
            const profile = (await db.query(`SELECT p.id,p.name,p.detail_id,p.query_id FROM company_profiles p
        JOIN company_detail_queries q ON q.id=p.query_id AND q.state='settled'
        WHERE p.id=$1 AND p.organization_id=$2 FOR UPDATE OF p`, [input.profileId, identity.organization_id])).rows[0];
            if (!profile)
                throw new NotFoundException('已确认档案不存在');
            const previous = (await db.query(`SELECT q.id AS "queryId",q.state,q.company_name AS "companyName",
        q.position_tags AS "positionTags",q.page_no AS "pageNo",q.page_size AS "pageSize",
        q.coefficient,q.maximum_points AS "maximumPoints" FROM company_contact_queries q
        WHERE q.organization_id=$1 AND q.profile_id=$2 AND q.position_tags=$3 AND q.page_no=$4 AND q.page_size=$5
        AND (q.state='pending' OR (q.state='quoted' AND q.coefficient=(SELECT coefficient FROM platform_pricing)))`, [identity.organization_id, profile.id, positionTags, input.pageNo, input.pageSize])).rows[0];
            if (previous)
                return previous;
            const local = (await db.query(`SELECT q.id AS "queryId",q.state,q.charged_points AS "chargedPoints",q.total
        FROM company_contact_queries q WHERE q.organization_id=$1 AND q.profile_id=$2 AND q.position_tags=$3
        AND q.page_no=$4 AND q.page_size=$5 AND q.state IN ('settled','zero') ORDER BY q.created_at DESC LIMIT 1`, [identity.organization_id, profile.id, positionTags, input.pageNo, input.pageSize])).rows[0];
            if (local)
                return { localPage: await this.pageRows(db, identity.organization_id, local.queryId), chargedPoints: '0.0000' };
            const price = (await db.query(`SELECT upstream_unit_price,maximum_billable_units,version FROM interface_prices
        WHERE interface_path='/v2/contact' AND (NOT $1::boolean OR evidence_type='supplier_verified')`, [this.production])).rows[0];
            if (!price)
                throw new ConflictException('联系人接口尚无已核实单价及本页最高计费量');
            const coefficient = (await db.query('SELECT coefficient FROM platform_pricing FOR SHARE')).rows[0].coefficient;
            const maximum = (await db.query('SELECT round($1::numeric*$2::numeric*$3::numeric,4) AS amount', [price.upstream_unit_price, price.maximum_billable_units, coefficient])).rows[0].amount;
            if (Number(maximum) <= 0)
                throw new ConflictException('联系人本页最高扣点额度不可证明');
            const id = randomUUID();
            await db.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,
        position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'quoted')`, [id, identity.organization_id, identity.id, profile.id, profile.name, positionTags, input.pageNo, input.pageSize, coefficient, maximum, price.version]);
            return { queryId: id, companyName: profile.name, positionTags, pageNo: input.pageNo,
                pageSize: input.pageSize, coefficient, maximumPoints: maximum };
        });
    }
    async pageRows(db, organizationId, id) {
        const contacts = (await db.query(`SELECT c.id,c.mailsou_id AS "mailsouId",c.query_company_name AS "queryCompanyName",
      c.returned_company_name AS "returnedCompanyName",c.ownership_status AS "ownershipStatus",
      c.email,c.personal_email AS "personalEmail",c.position_tag AS "positionTag",c.credibility
      FROM company_contact_page_items i JOIN company_contacts c ON c.id=i.contact_id
      WHERE i.query_id=$1 AND c.organization_id=$2 ORDER BY c.id`, [id, organizationId])).rows;
        const query = (await db.query(`SELECT id AS "queryId",state,charged_points AS "chargedPoints",total,page_no AS "pageNo",
      page_size AS "pageSize",position_tags AS "positionTags" FROM company_contact_queries WHERE id=$1 AND organization_id=$2`, [id, organizationId])).rows[0];
        return { ...query, contacts };
    }
    async get(identity, id) {
        await this.authorize(identity);
        if (!uuid.test(id))
            throw new BadRequestException('查询标识无效');
        const exists = (await this.pool.query('SELECT 1 FROM company_contact_queries WHERE id=$1 AND organization_id=$2', [id, identity.organization_id])).rowCount;
        if (!exists)
            throw new NotFoundException('查询不存在');
        return this.pageRows(this.pool, identity.organization_id, id);
    }
    async execute(identity, body) {
        await this.authorize(identity);
        const id = queryId(body);
        const reserved = await transaction(this.pool, async (db) => {
            const query = (await db.query('SELECT * FROM company_contact_queries WHERE id=$1 AND organization_id=$2 FOR UPDATE', [id, identity.organization_id])).rows[0];
            if (!query)
                throw new NotFoundException('查询授权不存在');
            if (query.state === 'expired')
                throw new ConflictException('报价系数已变化，请重新报价确认');
            if (query.state !== 'quoted')
                return { duplicate: true, query };
            const currentCoefficient = (await db.query('SELECT coefficient FROM platform_pricing')).rows[0].coefficient;
            if (Number(query.coefficient) !== Number(currentCoefficient))
                throw new ConflictException('报价系数已变化，请重新报价确认');
            const profile = (await db.query(`SELECT p.name FROM company_profiles p JOIN company_detail_queries q
        ON q.id=p.query_id AND q.state='settled' WHERE p.id=$1 AND p.organization_id=$2`, [query.profile_id, identity.organization_id])).rows[0];
            if (!profile || profile.name !== query.company_name)
                throw new ConflictException('已确认档案发生变化');
            const account = (await db.query('SELECT * FROM internal_point_accounts WHERE organization_id=$1 FOR UPDATE', [identity.organization_id])).rows[0];
            if (!account || Number(account.balance) - Number(account.query_frozen) - Number(account.sales_reserved) < Number(query.maximum_points))
                throw new ConflictException('可用点数不足');
            const after = (await db.query(`UPDATE internal_point_accounts SET query_frozen=query_frozen+$2::numeric
        WHERE organization_id=$1 RETURNING balance,query_frozen`, [identity.organization_id, query.maximum_points])).rows[0];
            await db.query("UPDATE company_contact_queries SET state='pending',updated_at=clock_timestamp() WHERE id=$1", [id]);
            await db.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'freeze',$4,$5,$6)`, [id, identity.organization_id, identity.id, query.maximum_points, after.balance, after.query_frozen]);
            return { duplicate: false, query };
        });
        if (reserved.duplicate)
            return this.get(identity, id);
        let page;
        try {
            page = await this.vendor.contacts({ companyName: reserved.query.company_name,
                positionTags: reserved.query.position_tags, pageNo: reserved.query.page_no, pageSize: reserved.query.page_size });
        }
        catch {
            return this.get(identity, id);
        }
        const data = page?.data;
        if (validPage(data, reserved.query)) {
            const arrivedAfterFailure = await transaction(this.pool, async (db) => {
                const current = (await db.query('SELECT state FROM company_contact_queries WHERE id=$1 FOR UPDATE', [id])).rows[0];
                if (current?.state === 'failed') {
                    await db.query(`INSERT INTO company_contact_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
            VALUES($1,$2,$3,$4,'unavailable',$5,'原查询异步迟到结果') ON CONFLICT(query_id,trace_id,billing_reference) DO NOTHING`, [randomUUID(), id, identity.id, page.traceId ?? 'unavailable', JSON.stringify(data)]);
                    return true;
                }
                if (current?.state === 'pending')
                    await db.query(`UPDATE company_contact_queries SET trace_id=$2,result_evidence=$3,updated_at=clock_timestamp()
          WHERE id=$1`, [id, page.traceId && page.traceId.length <= 500 ? page.traceId : null, JSON.stringify(data)]);
                return false;
            });
            if (arrivedAfterFailure)
                return this.get(identity, id);
        }
        if (!data || !Array.isArray(data.list) || ![data.pageNo, data.pageSize, data.total].every(Number.isInteger) ||
            data.pageNo !== reserved.query.page_no || data.pageSize !== reserved.query.page_size || data.total < 0 || data.total > 200 ||
            data.list.length > data.pageSize || (data.total === 0 && data.list.length !== 0) ||
            data.list.some(item => !item || typeof item.mailsouId !== 'string' || !item.mailsouId ||
                typeof item.companyName !== 'string' || typeof item.email !== 'string' && item.email != null ||
                typeof item.personalEmail !== 'string' && item.personalEmail != null ||
                typeof item.positionTag !== 'string' && item.positionTag != null ||
                typeof item.credibility !== 'string' && item.credibility != null) ||
            page.actualUpstreamPoints === undefined || !/^\d{1,12}(\.\d{1,4})?$/.test(page.actualUpstreamPoints))
            return this.get(identity, id);
        try {
            await transaction(this.pool, async (db) => {
                const query = (await db.query('SELECT * FROM company_contact_queries WHERE id=$1 FOR UPDATE', [id])).rows[0];
                if (query.state === 'failed') {
                    await db.query(`INSERT INTO company_contact_late_results(id,query_id,actor_id,trace_id,billing_reference,result,evidence)
            VALUES($1,$2,$3,$4,'unavailable',$5,'原查询异步迟到结果') ON CONFLICT(query_id,trace_id,billing_reference) DO NOTHING`, [randomUUID(), id, identity.id, page.traceId ?? 'unavailable', JSON.stringify(data)]);
                    return;
                }
                if (query.state !== 'pending')
                    return;
                const zero = data.total === 0;
                const charge = zero ? '0.0000' : (await db.query(`SELECT least(round($1::numeric*$2::numeric,4),$3::numeric)::numeric(20,4) AS amount`, [page.actualUpstreamPoints, query.coefficient, query.maximum_points])).rows[0].amount;
                for (const item of data.list) {
                    const mailsouId = item.mailsouId;
                    const returnedCompanyName = item.companyName;
                    const contactId = randomUUID();
                    const stored = (await db.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,
            query_company_name,returned_company_name,ownership_status,email,personal_email,position_tag,credibility,source_payload)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT(organization_id,profile_id,mailsou_id) DO UPDATE SET
            query_id=EXCLUDED.query_id,query_company_name=EXCLUDED.query_company_name,
            returned_company_name=EXCLUDED.returned_company_name,ownership_status=EXCLUDED.ownership_status,
            email=EXCLUDED.email,personal_email=EXCLUDED.personal_email,position_tag=EXCLUDED.position_tag,
            credibility=EXCLUDED.credibility,source_payload=EXCLUDED.source_payload,fetched_at=clock_timestamp()
            RETURNING id`, [contactId, query.organization_id, query.profile_id, id, mailsouId, query.company_name,
                        returnedCompanyName, returnedCompanyName === query.company_name ? 'matched' : 'pending',
                        item.email ?? null, item.personalEmail ?? null, item.positionTag ?? null, item.credibility ?? null,
                        JSON.stringify(item)])).rows[0];
                    await db.query('INSERT INTO company_contact_page_items(query_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, stored.id]);
                }
                const after = (await db.query(`UPDATE internal_point_accounts SET balance=balance-$2::numeric,
          query_frozen=query_frozen-$3::numeric WHERE organization_id=$1 RETURNING balance,query_frozen`, [query.organization_id, charge, query.maximum_points])).rows[0];
                await db.query(`UPDATE company_contact_queries SET state=$2,actual_upstream_points=$3,charged_points=$4,
          total=$5,updated_at=clock_timestamp() WHERE id=$1`, [id, zero ? 'zero' : 'settled', page.actualUpstreamPoints, charge, data.total]);
                await db.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,'settle',$4,$5,$6)`, [id, query.organization_id, identity.id, charge, after.balance, after.query_frozen]);
                await db.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,'release',round($4::numeric-$5::numeric,4),$6,$7)`, [id, query.organization_id, identity.id, query.maximum_points, charge, after.balance, after.query_frozen]);
            });
        }
        catch {
            return this.get(identity, id);
        }
        return this.get(identity, id);
    }
    async profile(identity, body) {
        await this.authorize(identity);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1)
            throw new BadRequestException('档案标识无效');
        const profileId = body.profileId;
        if (typeof profileId !== 'string' || !uuid.test(profileId))
            throw new BadRequestException('档案标识无效');
        const profile = (await this.pool.query('SELECT id,name FROM company_profiles WHERE id=$1 AND organization_id=$2', [profileId, identity.organization_id])).rows[0];
        if (!profile)
            throw new NotFoundException('档案不存在');
        const contacts = (await this.pool.query(`SELECT c.id,c.mailsou_id AS "mailsouId",c.query_company_name AS "queryCompanyName",
      c.returned_company_name AS "returnedCompanyName",c.ownership_status AS "ownershipStatus",c.email,
      c.personal_email AS "personalEmail",c.position_tag AS "positionTag",c.credibility,c.unsubscribed,
      x.reason AS "ownershipReason" FROM company_contacts c
      LEFT JOIN contact_ownership_confirmations x ON x.contact_id=c.id
        AND x.source_returned_company_name=c.returned_company_name
      WHERE c.organization_id=$1 AND c.profile_id=$2 ORDER BY c.fetched_at DESC,c.id`, [identity.organization_id, profileId])).rows;
        return { profile, contacts };
    }
    async finalFailure(identity, body) {
        if (identity.role !== 'platform')
            throw new ForbiddenException('仅平台可核对最终失败');
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new BadRequestException('核对参数无效');
        const input = body;
        if (Object.keys(input).sort().join(',') !== 'evidence,queryId' || !uuid.test(String(input.queryId)) ||
            typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 500)
            throw new BadRequestException('须提供查询标识及最终失败依据');
        const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
        if (org?.kind !== 'platform' || !org.active)
            throw new ForbiddenException('平台身份不可用');
        return transaction(this.pool, async (db) => {
            const query = (await db.query('SELECT * FROM company_contact_queries WHERE id=$1 FOR UPDATE', [input.queryId])).rows[0];
            if (!query)
                throw new NotFoundException('查询不存在');
            if (query.state === 'failed')
                return { queryId: query.id, state: 'failed' };
            if (query.state !== 'pending')
                throw new ConflictException('仅结果确认中可核对最终失败');
            const account = (await db.query(`UPDATE internal_point_accounts SET query_frozen=query_frozen-$2::numeric
        WHERE organization_id=$1 RETURNING balance,query_frozen`, [query.organization_id, query.maximum_points])).rows[0];
            await db.query("UPDATE company_contact_queries SET state='failed',charged_points=0,updated_at=clock_timestamp() WHERE id=$1", [query.id]);
            await db.query(`INSERT INTO company_contact_point_ledger(query_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'release',$4,$5,$6)`, [query.id, query.organization_id, identity.id, query.maximum_points, account.balance, account.query_frozen]);
            await db.query('INSERT INTO company_contact_reconciliations(query_id,actor_id,evidence) VALUES($1,$2,$3)', [query.id, identity.id, input.evidence]);
            return { queryId: query.id, state: 'failed' };
        });
    }
}
//# sourceMappingURL=company-contacts.js.map