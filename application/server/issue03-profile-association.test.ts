import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CompanyProfileImportService } from './companies/company-profile-imports.js';
import type { Identity } from './identity/identity.js';
import { testDatabase } from '../tests/helpers.js';

test('票03：同名选择、租户隔离、删除、并发与资料保全', async () => {
  const { pool } = await testDatabase();
  try {
    const parent = randomUUID(), org = randomUUID(), other = randomUUID(), actor = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'parent','platform')", [parent]);
    for (const [id, phone] of [[org, 'phone-a'], [other, 'phone-b']])
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,'terminal',$3,'encrypted',$4,'***')`, [id, phone, parent, phone]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'issue03@example.com','hash','admin',false)`, [actor, org]);
    const identity: Identity = { id: actor, email: 'issue03@example.com', username: null, role: 'admin',
      organization_id: org, must_change: false, csrf_hash: '' };
    const service = new CompanyProfileImportService(pool);
    const search = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'query','USA',1,20,10,'verified')`, [search, org, actor]);
    async function source(name: string) {
      const id = randomUUID();
      await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
        VALUES($1,$2,$3,$4,$5,'USA','pending')`, [id, search, org, `vendor-${randomUUID()}`, name]);
      return id;
    }
    const item = (sourceRecordId: string, decision = 'create', profileId?: string) =>
      ({ sourceKind: 'company_candidate', sourceRecordId, decision, ...(profileId ? { profileId } : {}) });
    const run = (items: ReturnType<typeof item>[], resolving = false) => service.import(identity, { requestId: randomUUID(), items }, resolving);
    const firstId = await source('Same Company');
    const first = (await run([item(firstId)])).items[0];
    assert.equal(first.status, 'created');
    const profileId = first.profileId!;
    assert.notEqual(profileId, firstId);
    await pool.query(`UPDATE company_profiles SET main_products='人工资料',detail_id='detail-data-id',
      detail='{ "id": "detail-data-id" }'::jsonb WHERE id=$1`, [profileId]);
    const secondId = await source('Same Company'), thirdId = await source('Same Company');
    const second = (await run([item(secondId), item(randomUUID())])).items;
    assert.equal(second[0].status, 'needs_resolution');
    assert.equal(second[0].candidates?.[0].profileId, profileId);
    assert.equal(second[1].reasonCode, 'SOURCE_NOT_FOUND');
    const foreign = randomUUID();
    await pool.query(`INSERT INTO company_profiles(id,organization_id,name,identity_state,detail_state)
      VALUES($1,$2,'Same Company','pending','absent')`, [foreign, other]);
    assert.equal((await run([item(secondId, 'link', foreign)], true)).items[0].reasonCode, 'PROFILE_NOT_AVAILABLE');
    assert.equal((await run([item(secondId, 'link', profileId)])).items[0].reasonCode, 'CONFIRMATION_REQUIRED');
    const modeRequest = { requestId: randomUUID(), items: [item(secondId, 'link', profileId)] };
    await service.import(identity, modeRequest);
    await assert.rejects(service.import(identity, modeRequest, true));
    const linked = (await run([item(secondId, 'link', profileId)], true)).items[0];
    assert.equal(linked.status, 'linked');
    assert.equal(linked.profileId, profileId);
    assert.equal((await pool.query('SELECT main_products FROM company_profiles WHERE id=$1', [profileId])).rows[0].main_products, '人工资料');
    const evidence = (await pool.query('SELECT source_payload,search_conditions FROM company_profile_sources WHERE source_record_id=$1', [secondId])).rows[0];
    assert.notEqual(evidence.source_payload.sourceId, secondId);
    assert.notEqual(evidence.source_payload.sourceId, 'detail-data-id');
    assert.notEqual(profileId, 'detail-data-id');
    assert.equal(evidence.search_conditions.association.decision, 'link');
    assert.equal((await run([item(thirdId)])).items[0].status, 'needs_resolution');
    assert.equal((await run([item(thirdId)])).items[0].status, 'needs_resolution');
    const separate = (await run([item(thirdId)], true)).items[0];
    assert.equal(separate.status, 'created');
    assert.notEqual(separate.profileId, profileId);
    assert.equal((await run([item(secondId, 'link', separate.profileId)], true)).items[0].reasonCode, 'SOURCE_ALREADY_LINKED');
    await pool.query('UPDATE company_profiles SET deleted_at=clock_timestamp() WHERE id=$1', [profileId]);
    assert.equal((await run([item(secondId)])).items[0].reasonCode, 'PROFILE_DELETED');
    const fourthId = await source('Same Company');
    assert.equal((await run([item(fourthId, 'link', profileId)], true)).items[0].reasonCode, 'PROFILE_NOT_AVAILABLE');
    const concurrentId = await source('Unique Company');
    const concurrent = await Promise.all([run([item(concurrentId)]), run([item(concurrentId)])]);
    assert.deepEqual(concurrent.map(value => value.items[0].status).sort(), ['created', 'linked']);
    assert.equal(concurrent[0].items[0].profileId, concurrent[1].items[0].profileId);
    const x = await source('Concurrent Company'), y = await source('Concurrent Company');
    const nameRace = await Promise.all([run([item(x)]), run([item(y)])]);
    assert.deepEqual(nameRace.map(value => value.items[0].status).sort(), ['created', 'needs_resolution']);
    const conflictId = await source('Conflict fixture');
    const successId = await source('Success fixture');
    await pool.query(`CREATE OR REPLACE FUNCTION issue03_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source_record_id = '${conflictId}'::uuid THEN RAISE check_violation; END IF; RETURN NEW; END $$`);
    await pool.query('DROP TRIGGER IF EXISTS issue03_conflict ON company_profile_sources');
    await pool.query(`CREATE TRIGGER issue03_conflict BEFORE INSERT ON company_profile_sources
      FOR EACH ROW EXECUTE FUNCTION issue03_conflict()`);
    const partial = (await run([item(conflictId), item(successId)])).items;
    assert.equal(partial[0].reasonCode, 'ASSOCIATION_CONFLICT');
    assert.equal(partial[1].status, 'created');
    const committedId = await source('Committed before failure');
    const interruptedId = await source('Interrupted item');
    const requestId = randomUUID();
    const interruptedRequest = { requestId, items: [item(committedId), item(interruptedId)] };
    await pool.query(`CREATE OR REPLACE FUNCTION issue03_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source_record_id = '${interruptedId}'::uuid THEN RAISE EXCEPTION 'simulated interruption'; END IF; RETURN NEW; END $$`);
    await assert.rejects(service.import(identity, interruptedRequest), /simulated interruption/);
    const saved = (await pool.query('SELECT response FROM company_profile_import_requests WHERE request_id=$1', [requestId])).rows[0].response;
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].status, 'created');
    assert.equal(Number((await pool.query('SELECT count(*) FROM company_profile_sources WHERE source_record_id=$1', [committedId])).rows[0].count), 1);
    await pool.query('DROP TRIGGER issue03_conflict ON company_profile_sources');
    const resumed = await service.import(identity, interruptedRequest);
    assert.equal(resumed.items.length, 2);
    assert.equal(resumed.items[0].profileId, saved.items[0].profileId);
    assert.equal(resumed.items[1].status, 'created');
    assert.deepEqual(await service.import(identity, interruptedRequest), resumed);
    assert.equal(Number((await pool.query('SELECT count(*) FROM query_point_ledger')).rows[0].count), 0);
  } finally { await pool.end(); }
});
