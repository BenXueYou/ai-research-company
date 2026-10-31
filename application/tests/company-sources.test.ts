import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { testDatabase } from './helpers.js';
import { hashPassword } from '../server/identity/policy.js';
import { createApplication } from '../server/app.js';
import { CompanySourceDetailService } from '../server/companies/company-source-details.js';
import { assertCompanyOperation } from '../server/companies/company-sources.js';
import { transaction } from '../server/database.js';
import { applyUpgrade, CURRENT_VERSION, IMPORT_VERSION, planUpgrade, verifyUpgrade } from '../server/migrations/upgrade.js';

test('来源定位 HTTP：同名资料、人工关联、独立快照、费用未决、准入和历史保全', async () => {
  const { pool } = await testDatabase();
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const calls: unknown[] = [];
  let returnedCountry = 'KOR';
  let wrongId = false;
  let zero = false;
  const records = ['source-A', 'source-B', 'source-C', 'source-D', 'source-E', 'source-F'];
  try {
    const parent = randomUUID(), org = randomUUID(), actor = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'platform','platform')", [parent]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'team','terminal',$2,'enc',$3,'***')`, [org, parent, randomUUID()]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'sources@test.example',$3,'admin',false)`, [actor, org, await hashPassword('Source-test-Password!')]);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,100)', [org]);
    await pool.query('UPDATE platform_pricing SET coefficient=1');
    for (const path of ['/v2/company', '/v2/contact']) await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,
      maximum_billable_units,evidence,evidence_type,version,actor_id) VALUES($1,1,1,'fixture','controlled_test',$2,$3)`, [path, randomUUID(), actor]);
    const portServer = createServer();
    await new Promise<void>(resolve => portServer.listen(0, '127.0.0.1', resolve));
    const port = (portServer.address() as { port: number }).port;
    await new Promise<void>(resolve => portServer.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const detail = {
      async detail() { throw new Error('不得回退名称路径'); },
      recordLookup: {
        interfacePath: '/v2/company', evidenceReference: 'controlled-request-contract', supplierVerified: false,
        async detail(input: { recordId: string; name: string; countryCode3: string }) {
          calls.push(input);
          return { data: { id: zero ? null : wrongId ? 'unselected-record' : input.recordId, countryCode3: returnedCountry,
            name: input.name, ...(input.recordId === 'source-B' ? { website: 'seoulsemicon.com', taxNo: 'controlled-tax' } : {}) } };
        }
      }
    };
    app = await createApplication(pool, origin, false, undefined, { async listCompanies(input) {
      return { content: records.map(id => ({ id, name: 'SEOUL SEMICONDUCTOR', country: 'KOR' })), page: input.pageNo, size: input.pageSize, total: records.length };
    } }, undefined, detail);
    await app.listen(port, '127.0.0.1');
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sources@test.example', password: 'Source-test-Password!' }) });
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]);
    const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookies.join('; '),
      'X-CSRF-Token': cookies.find(value => value.startsWith('identity_csrf='))!.slice(14) };
    async function post(path: string, body: object, status = 200): Promise<any> {
      const response = await fetch(`${origin}/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const result = await response.json();
      assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
      return result;
    }
    const search = await post('company-searches', { name: 'SEOUL', countryCodes: 'KOR', pageNo: 1, pageSize: 20 });
    const csrfRejected = await fetch(`${origin}/api/company-sources/list`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: headers.Cookie },
      body: JSON.stringify({ profileId: randomUUID() })
    });
    assert.equal(csrfRejected.status, 403);
    const first = search.content[0];
    const imported = await post('company-profile-imports', { requestId: randomUUID(), items: [{ sourceKind: 'company_candidate', sourceRecordId: first.candidateId, decision: 'create' }] });
    const profileId = imported.items[0].profileId;
    assert.ok(profileId);
    const foreignProfile = randomUUID();
    await pool.query(`INSERT INTO company_profiles(id,organization_id,name,identity_state,detail_state)
      VALUES($1,$2,'foreign','pending','absent')`, [foreignProfile, parent]);
    await post('company-sources/list', { profileId: foreignProfile }, 404);
    await pool.query("UPDATE company_profiles SET main_products='manual-preserved' WHERE id=$1", [profileId]);
    const historyId = randomUUID();
    await pool.query(`INSERT INTO timeline_manual_records(id,organization_id,company_id,type,event_time,content,created_by)
      VALUES($1,$2,$3,'note',now(),'history-preserved',$4)`, [historyId, org, profileId, actor]);
    for (const candidate of search.content.slice(1)) {
      const item = { sourceKind: 'company_candidate', sourceRecordId: candidate.candidateId, decision: 'create' };
      const ambiguous = await post('company-profile-imports', { requestId: randomUUID(), items: [item] });
      assert.equal(ambiguous.items[0].status, 'needs_resolution');
      await post('company-profile-import-resolutions', { requestId: randomUUID(), items: [{ ...item, decision: 'link', profileId }] });
    }
    let list = await post('company-sources/list', { profileId });
    assert.equal(list.candidates.length, records.length);
    const byRecord = (id: string) => list.candidates.find((row: any) => row.recordId === id);
    const selectBody = (record: string, version: number) => ({ profileId, sourceId: byRecord(record).sourceId,
      candidateId: byRecord(record).candidateId, expectedVersion: version, requestId: randomUUID() });
    const selectionRequest = selectBody('source-A', 0);
    const [selected, duplicateSelection] = await Promise.all([post('company-sources/select', selectionRequest), post('company-sources/select', selectionRequest)]);
    assert.deepEqual(selected, duplicateSelection);
    assert.deepEqual(await post('company-sources/select', selectionRequest), selected);
    await post('company-sources/select', { ...selectionRequest, candidateId: byRecord('source-B').candidateId }, 409);
    await post('company-sources/select', selectBody('source-B', 0), 409);
    const query = await post('company-source-details/quote', { profileId, selectionId: selected.selectionId, refresh: false });
    await post('company-details/execute', { queryId: query.queryId }, 409);
    const ready = await post('company-source-details/execute', { queryId: query.queryId });
    assert.equal(ready.resultState, 'ready'); assert.equal(ready.state, 'pending');
    assert.equal(ready.result.id, 'source-A');
    await post('company-source-details/execute', { queryId: query.queryId });
    assert.equal(calls.length, 1);
    const local = await post('company-source-details/quote', { profileId, selectionId: selected.selectionId, refresh: false });
    assert.equal(local.chargedPoints, '0.0000');
    const b = await post('company-sources/select', selectBody('source-B', 1));
    const qb = await post('company-source-details/quote', { profileId, selectionId: b.selectionId, refresh: false });
    await post('company-source-details/execute', { queryId: qb.queryId });
    assert.deepEqual(calls, [
      { recordId: 'source-A', name: 'SEOUL SEMICONDUCTOR', countryCode3: 'KOR' },
      { recordId: 'source-B', name: 'SEOUL SEMICONDUCTOR', countryCode3: 'KOR' }
    ]);
    assert.equal((await pool.query('SELECT detail_id FROM company_profiles WHERE id=$1', [profileId])).rows[0].detail_id, 'source-A');
    list = await post('company-sources/list', { profileId });
    const bSnapshot = list.snapshots.find((row: any) => row.recordId === 'source-B');
    await post('company-sources/display', { profileId, snapshotId: bSnapshot.id, expectedVersion: 2 });
    const profile = (await pool.query('SELECT * FROM company_profiles WHERE id=$1', [profileId])).rows[0];
    assert.equal(profile.detail_id, 'source-B'); assert.equal(profile.identity_state, 'pending');
    assert.equal(profile.main_products, 'manual-preserved');
    assert.equal((await pool.query('SELECT content FROM timeline_manual_records WHERE id=$1', [historyId])).rows[0].content, 'history-preserved');
    const ledger = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [org])).rows[0];
    assert.deepEqual(ledger, { balance: '100.0000', query_frozen: '2.0000' });
    const contactsBody = { profileId, positionTags: ['EXECUTIVE'], pageNo: 1, pageSize: 20 };
    await post('company-contacts/quote', contactsBody, 409);
    // An independently supplied test evidence admits the no-detail contact path; production rejects it.
    const identity = { id: actor, organization_id: org, role: 'admin' as const, email: 'sources@test.example', username: null, must_change: false, csrf_hash: '' };
    const productionService = new CompanySourceDetailService(pool, detail, true);
    await assert.rejects(productionService.quote(identity, { profileId, selectionId: b.selectionId, refresh: true }), /接口尚待核实/);
    await pool.query(`INSERT INTO company_operation_evidence(id,organization_id,profile_id,source_version,operation,company_name,country_code3,evidence_reference,evidence_kind)
      VALUES($1,$2,$3,2,'contacts','SEOUL SEMICONDUCTOR','KOR','controlled ownership proof','controlled_test')`, [randomUUID(), org, profileId]);
    await transaction(pool, async db => { assert.equal(await assertCompanyOperation(db, org, profileId, 'contacts', 2, false), 2); });
    await assert.rejects(transaction(pool, db => assertCompanyOperation(db, org, profileId, 'contacts', 2, true)), /归属依据不足/);
    const contactQuote = await post('company-contacts/quote', contactsBody);
    const contactId = randomUUID(), templateId = randomUUID(), channelId = randomUUID();
    await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,
      returned_company_name,ownership_status,email,source_payload) VALUES($1,$2,$3,$4,'distinct-mailsou','SEOUL SEMICONDUCTOR',
      'SEOUL SEMICONDUCTOR','matched','selected@example.test','{"id":"different-contact-id","fileId":"different-file-id"}')`,
    [contactId, org, profileId, contactQuote.queryId]);
    await pool.query('INSERT INTO public_templates(id,name,current_version) VALUES($1,$2,1)', [templateId, `template-${templateId}`]);
    await pool.query(`INSERT INTO public_template_versions(template_id,version,subject,content,created_by)
      VALUES($1,1,'Hello','Message',$2)`, [templateId, actor]);
    const draft = await post('email-drafts', { profileId, templateId, templateVersion: 1, subject: 'Hello', content: 'Message',
      selections: [{ contactId, emailKind: 'company', variables: {} }] });
    await post('email-drafts/preview', { draftId: draft.draftId }, 409);
    await pool.query(`INSERT INTO company_operation_evidence(id,organization_id,profile_id,source_version,operation,company_name,
      country_code3,evidence_reference,evidence_kind) VALUES($1,$2,$3,2,'email','SEOUL SEMICONDUCTOR','KOR','controlled email ownership','controlled_test')`,
    [randomUUID(), org, profileId]);
    const preview = await post('email-drafts/preview', { draftId: draft.draftId });
    assert.equal(preview.recipients[0].mailsouId, 'distinct-mailsou');
    assert.equal(preview.recipients[0].email, 'selected@example.test');
    await post('email-previews/confirm', { previewId: preview.previewId });
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,
      credential_encrypted,reply_to,verification_state,verification_detail,verified_at,updated_by)
      VALUES($1,$2,'SMTP','fixture.invalid',465,'ssl','fixture','unused-cipher','reply@example.test','available','controlled',now(),$3)`,
    [channelId, org, actor]);
    const batchBody = { previewId: preview.previewId, channelId, confirmUnsubscribeNotice: true, confirmQuota: true };
    const batch = await post('email-batches/confirm', batchBody, 201);
    wrongId = true;
    const c = await post('company-sources/select', selectBody('source-C', 2));
    await post('company-contacts/execute', { queryId: contactQuote.queryId }, 409);
    await post('email-previews/confirm', { previewId: preview.previewId }, 409);
    await post('email-batches/confirm', batchBody, 409);
    await post('email-batches/execute', { batchId: batch.batchId }, 409);
    assert.equal((await pool.query('SELECT status FROM email_recipients WHERE batch_id=$1', [batch.batchId])).rows[0].status, 'queued');
    const qc = await post('company-source-details/quote', { profileId, selectionId: c.selectionId, refresh: false });
    assert.equal((await post('company-source-details/execute', { queryId: qc.queryId })).resultState, 'conflict');
    wrongId = false; returnedCountry = 'USA';
    const d = await post('company-sources/select', selectBody('source-D', 3));
    const qd = await post('company-source-details/quote', { profileId, selectionId: d.selectionId, refresh: false });
    assert.equal((await post('company-source-details/execute', { queryId: qd.queryId })).resultState, 'conflict');
    returnedCountry = 'KOR'; zero = true;
    const e = await post('company-sources/select', selectBody('source-E', 4));
    const qe = await post('company-source-details/quote', { profileId, selectionId: e.selectionId, refresh: false });
    assert.equal((await post('company-source-details/execute', { queryId: qe.queryId })).resultState, 'zero');
    assert.equal((await pool.query('SELECT detail_id FROM company_profiles WHERE id=$1', [profileId])).rows[0].detail_id, 'source-B');
    const f = await post('company-sources/select', selectBody('source-F', 5));
    const qf = await post('company-source-details/quote', { profileId, selectionId: f.selectionId, refresh: false });
    await post('company-sources/select', selectBody('source-A', 6));
    await post('company-source-details/execute', { queryId: qf.queryId }, 409);
    await pool.query('UPDATE company_profiles SET deleted_at=now() WHERE id=$1', [profileId]);
    await post('company-sources/list', { profileId }, 404);
    await pool.query('UPDATE company_profiles SET deleted_at=NULL WHERE id=$1', [profileId]);
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [org]);
    await post('company-sources/list', { profileId }, 401);
    assert.equal(calls.length, 5);
  } finally { if (app) await app.close(); await pool.end(); }
});

test('来源版本迁移：票02库升级、数据保全、重复执行和未知版本拒绝', async () => {
  const { pool } = await testDatabase();
  try {
    await pool.query(`ALTER TABLE company_profiles DROP CONSTRAINT profile_display_tenant_fk;
      ALTER TABLE company_detail_queries DROP CONSTRAINT detail_selection_tenant_fk,DROP CONSTRAINT detail_target_tenant_fk;
      DROP TABLE company_detail_display_events,company_detail_snapshots,company_operation_evidence,company_source_selections;
      ALTER TABLE company_profiles DROP COLUMN source_version,DROP COLUMN displayed_snapshot_id;
      ALTER TABLE company_detail_queries DROP COLUMN target_profile_id,DROP COLUMN selection_id,DROP COLUMN result_state,DROP COLUMN request_snapshot;
      ALTER TABLE company_contact_queries DROP COLUMN identity_version;
      ALTER TABLE email_previews DROP COLUMN identity_version;
      ALTER TABLE email_batches DROP COLUMN identity_version;
      DROP TABLE IF EXISTS schema_migrations,upgrade_snapshots;`);
    const org = randomUUID(), actor = randomUUID(), profile = randomUUID(), source = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'legacy','platform')", [org]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'migration@test.example','fixture','platform',false)`, [actor, org]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,name,country_code3,detail_id,detail,main_products)
      VALUES($1,$2,'Legacy','KOR','legacy-record','{"id":"legacy-record","countryCode3":"KOR"}','preserved manual')`, [profile, org]);
    await pool.query(`INSERT INTO company_profile_sources(id,organization_id,profile_id,source_kind,source_record_id,
      source_payload,search_conditions,page_no,actor_id) VALUES($1,$2,$3,'legacy_detail',$4,'{"legacy":true}','{}',1,$5)`,
    [source, org, profile, randomUUID(), actor]);
    const before = (await pool.query('SELECT row_to_json(o) AS data FROM organizations o ORDER BY id')).rows;
    const beforeSource = (await pool.query('SELECT row_to_json(s) AS data FROM company_profile_sources s')).rows;
    const plan = await planUpgrade(pool);
    assert.deepEqual(plan.pending, [IMPORT_VERSION, CURRENT_VERSION]);
    await applyUpgrade(pool);
    assert.deepEqual((await planUpgrade(pool)).pending, []);
    assert.equal((await verifyUpgrade(pool)).unchanged, true);
    await applyUpgrade(pool);
    assert.deepEqual((await pool.query('SELECT row_to_json(o) AS data FROM organizations o ORDER BY id')).rows, before);
    assert.deepEqual((await pool.query('SELECT row_to_json(s) AS data FROM company_profile_sources s')).rows, beforeSource);
    const preserved = (await pool.query('SELECT id,main_products,detail,source_version FROM company_profiles WHERE id=$1', [profile])).rows[0];
    assert.equal(preserved.id, profile); assert.equal(preserved.main_products, 'preserved manual');
    assert.equal(preserved.detail.id, 'legacy-record'); assert.equal(preserved.source_version, 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM company_operation_evidence')).rows[0].n, 0);
    await pool.query("UPDATE schema_migrations SET checksum='wrong' WHERE version=$1", [CURRENT_VERSION]);
    await assert.rejects(applyUpgrade(pool), /校验和/);
  } finally { await pool.end(); }
});
