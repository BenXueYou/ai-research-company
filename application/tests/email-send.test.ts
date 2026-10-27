import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createCipheriv, randomBytes } from 'node:crypto';
import { EmailSendService, type DomesticSmtpSender, type UMailMessage, type UMailSender } from '../server/email-send.js';
import { testDatabase } from './helpers.js';
import type { Identity } from '../server/identity.js';

test('T22 snapshot identifiers, atomic quota, outcomes, idempotence and overnight pause', async () => {
  const { pool } = await testDatabase();
  const platformOrg = randomUUID();
  const platformId = randomUUID();
  const org = randomUUID();
  const actor = randomUUID();
  const otherActor = randomUUID();
  const profileId = randomUUID();
  const templateId = randomUUID();
  const draftId = randomUUID();
  const previewId = randomUUID();
  const channelId = randomUUID();
  const contacts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const platform: Identity = { id: platformId, organization_id: platformOrg, role: 'platform',
    email: null, username: 'super_admin', csrf_hash: '', must_change: false };
  const identity: Identity = { ...platform, id: actor, organization_id: org, role: 'admin',
    email: 'actor@example.com', username: null };
  const senderCalls: Array<{ to: string; content: string; replyTo: string }> = [];
  const sender: DomesticSmtpSender = { async send(settings, message) {
    senderCalls.push({ to: message.to, content: message.content, replyTo: settings.replyTo });
    return { state: senderCalls.length === 1 ? 'accepted' : senderCalls.length === 2 ? 'not_submitted' : 'uncertain',
      detail: 'controlled-result' };
  } };
  try {
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'Platform','platform')", [platformOrg]);
    await pool.query("INSERT INTO accounts(id,organization_id,username,password_hash,role,must_change) VALUES($1,$2,'super_admin','test','platform',false)",
      [platformId, platformOrg]);
    await pool.query("INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,'Target','terminal',$2,'enc','key','***')",
      [org, platformOrg]);
    for (const [id, email] of [[actor, 'actor@example.com'], [otherActor, 'other@example.com']]) {
      await pool.query("INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,'test','admin',false)",
        [id, org, email]);
    }
    const searchId = randomUUID();
    const candidateId = randomUUID();
    const detailId = randomUUID();
    await pool.query("INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status) VALUES($1,$2,$3,'Source','TUR',1,20,1,'verified')",
      [searchId, org, actor]);
    await pool.query("INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status) VALUES($1,$2,$3,'list-111','Target','TUR','verified')",
      [candidateId, searchId, org]);
    await pool.query("INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Target','TUR',1,1,$5,'settled')",
      [detailId, org, actor, candidateId, randomUUID()]);
    await pool.query("INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id) VALUES($1,$2,'detail-222','Target','TUR','{}',$3)",
      [profileId, org, detailId]);
    const contactQueryId = randomUUID();
    await pool.query("INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Target','{}',1,20,1,1,$5,'settled')",
      [contactQueryId, org, actor, profileId, randomUUID()]);
    for (let i = 0; i < contacts.length; i++) {
      await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,
        returned_company_name,ownership_status,email,source_payload) VALUES($1,$2,$3,$4,$5,'Target','Target','matched',$6,$7)`,
      [contacts[i], org, profileId, contactQueryId, `mailsou-${i}`, i < 2 ? 'Dup@Example.com' : `unique-${i}@example.com`,
        JSON.stringify({ id: `source-id-${i}`, fileId: `file-id-${i}` })]);
    }
    await pool.query("INSERT INTO public_templates(id,name,current_version) VALUES($1,'Intro',1)", [templateId]);
    await pool.query("INSERT INTO public_template_versions(template_id,version,subject,content,attachment_ids,created_by) VALUES($1,1,'Subject','Body','{}',$2)",
      [templateId, platformId]);
    await pool.query(`INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,selections)
      VALUES($1,$2,$3,$4,$5,1,'Subject','Body','[]')`, [draftId, org, actor, profileId, templateId]);
    const recipients = [
      { email: 'dup@example.com', emailKey: 'dup@example.com', contactId: contacts[1], mailsouId: 'mailsou-1',
        subject: 'Chosen source', content: 'selected mailsou-1', unsubscribedContactIds: [] },
      ...[2, 3].map(i => ({ email: `unique-${i}@example.com`, emailKey: `unique-${i}@example.com`,
        contactId: contacts[i], mailsouId: `mailsou-${i}`, subject: `Subject ${i}`, content: `Body ${i}`,
        unsubscribedContactIds: [] }))
    ];
    await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,
      subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
      VALUES($1,$2,$3,$4,$5,$6,1,'Subject','Body','{}','[]',$7,clock_timestamp())`,
    [previewId, draftId, org, actor, profileId, templateId, JSON.stringify(recipients)]);
    const key = Buffer.from(process.env.SMTP_CREDENTIAL_KEY!, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${org}:SMTP`));
    const encrypted = Buffer.concat([cipher.update('credential'), cipher.final()]);
    const secret = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,
      credential_encrypted,reply_to,verification_state,verification_detail,verified_at,updated_by)
      VALUES($1,$2,'SMTP','smtp.example.com',465,'tls','smtp-user',$3,'reply@example.net','available','controlled',clock_timestamp(),$4)`,
    [channelId, org, secret, actor]);
    const service = new EmailSendService(pool, key, sender);
    assert.equal((await service.quota(identity)).dailyLimit, 2000);
    await service.configureLimit(platform, { organizationId: org, dailyLimit: 3 });
    const body = { previewId, channelId, confirmUnsubscribeNotice: true, confirmQuota: true };
    await assert.rejects(service.confirm({ ...identity, id: otherActor }, body));
    await assert.rejects(service.confirm(identity, { ...body, confirmQuota: false }));
    const queued = await service.confirm(identity, body);
    assert.equal(queued.count, 3);
    assert.equal((await service.confirm(identity, body)).batchId, queued.batchId);
    assert.equal((await service.quota(identity)).reserved, 3);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_recipients WHERE batch_id=$1', [queued.batchId])).rows[0].n, 3);
    const executed = await service.execute(identity, { batchId: queued.batchId });
    assert.deepEqual(executed.recipients.map(item => item.status).sort(), ['accepted', 'not_submitted', 'uncertain']);
    assert.equal(senderCalls.length, 3);
    assert.ok(senderCalls.some(item => item.to === 'dup@example.com' && item.content === 'selected mailsou-1'));
    assert.ok(senderCalls.every(item => item.replyTo === 'reply@example.net'));
    const usage = await service.quota(identity);
    assert.deepEqual([usage.reserved, usage.used, usage.remaining], [1, 1, 1]);
    await service.execute(identity, { batchId: queued.batchId });
    assert.equal(senderCalls.length, 3);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_usage_events WHERE event='reserved'")).rows[0].n, 3);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_usage_events WHERE event='used'")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_usage_events WHERE event='released'")).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contact_point_ledger')).rows[0].n, 0);
    assert.equal((await service.list(identity)).batches.length, 1);
    const extraPreviews = [randomUUID(), randomUUID()];
    for (const id of extraPreviews) {
      await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,
        template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
        SELECT $1,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,
          attachment_ids,recipient_snapshot,$2,clock_timestamp() FROM email_previews WHERE id=$3`,
      [id, JSON.stringify([recipients[0]]), previewId]);
    }
    const competing = await Promise.allSettled(extraPreviews.map(id => service.confirm(identity, { ...body, previewId: id })));
    assert.equal(competing.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(competing.filter(item => item.status === 'rejected').length, 1);
    const nextBatch = competing.find(item => item.status === 'fulfilled')!.value.batchId;
    assert.equal((await service.quota(identity)).remaining, 0);
    const queuedRecipient = (await pool.query('SELECT id FROM email_recipients WHERE batch_id=$1', [nextBatch])).rows[0].id;
    await pool.query("UPDATE email_batches SET usage_day=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE id=$1", [nextBatch]);
    await pool.query('UPDATE email_daily_usage SET reserved=reserved-1 WHERE organization_id=$1 AND usage_day=(CURRENT_TIMESTAMP AT TIME ZONE $2)::date',
      [org, 'Asia/Shanghai']);
    await pool.query(`INSERT INTO email_daily_usage(organization_id,usage_day,reserved)
      VALUES($1,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1,1)`, [org]);
    await pool.query("UPDATE email_usage_events SET usage_day=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE recipient_id=$1", [queuedRecipient]);
    await service.execute(identity, { batchId: nextBatch });
    assert.equal((await pool.query('SELECT status FROM email_recipients WHERE id=$1', [queuedRecipient])).rows[0].status, 'paused');
    assert.equal((await pool.query(`SELECT reserved FROM email_daily_usage WHERE organization_id=$1
      AND usage_day=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1`, [org])).rows[0].reserved, 0);
    assert.equal(senderCalls.length, 3);
    const timeline = (await pool.query(`SELECT count(*)::int AS n FROM email_recipients WHERE profile_id=$1 AND organization_id=$2`,
      [profileId, org])).rows[0].n;
    assert.equal(timeline, 4);
    const resourceId = 'resource-for-target-only';
    const umailChannelId = randomUUID();
    const attachmentId = randomUUID();
    await pool.query(`INSERT INTO umail_resources(organization_id,external_resource_id,resource_status,verification_detail,
      checked_at,configured_by) VALUES($1,$2,'available','controlled',clock_timestamp(),$3)`, [org, resourceId, platformId]);
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,reply_to,verification_state,
      verification_detail,verified_at,updated_by,umail_domain,umail_sender_address,umail_domain_status,
      umail_account_status,umail_dns_records) VALUES($1,$2,'UMAIL','umail-reply@example.net','available',
      'controlled',clock_timestamp(),$3,'send.example.com','sender@send.example.com','verified','available','[]')`,
    [umailChannelId, org, actor]);
    await pool.query(`INSERT INTO public_template_attachments(id,sha256,file_name,mime_type,byte_size,content,scanned_at,created_by)
      VALUES($1,'test-hash','approved.pdf','application/pdf',3,$2,clock_timestamp(),$3)`,
    [attachmentId, Buffer.from('PDF'), platformId]);
    const umailPreviewId = randomUUID();
    await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,
      template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
      SELECT $1,draft_id,organization_id,actor_id,profile_id,template_id,template_version,
        'edited subject','edited content',ARRAY[$2]::uuid[],recipient_snapshot,$3,clock_timestamp()
      FROM email_previews WHERE id=$4`, [umailPreviewId, attachmentId, JSON.stringify([recipients[0]]), previewId]);
    const calls: UMailMessage[] = [];
    const umailSender: UMailSender = { async send(message) {
      calls.push(message);
      return { state: 'accepted', detail: 'controlled accepted', organizationId: message.organizationId,
        resourceId: message.resourceId, recipientId: message.recipientId };
    } };
    const shared = new EmailSendService(pool, key, sender, umailSender);
    await shared.configureLimit(platform, { organizationId: org, dailyLimit: 3 });
    const umailBatch = await shared.confirm(identity, { ...body, previewId: umailPreviewId, channelId: umailChannelId });
    assert.equal((await shared.quota(identity)).remaining, 0);
    const overLimitPreviewId = randomUUID();
    await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,
      template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
      SELECT $1,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,
        attachment_ids,recipient_snapshot,$2,clock_timestamp() FROM email_previews WHERE id=$3`,
    [overLimitPreviewId, JSON.stringify([recipients[0]]), previewId]);
    await assert.rejects(shared.confirm(identity, { ...body, previewId: overLimitPreviewId, channelId }));
    const umailResult = await shared.execute(identity, { batchId: umailBatch.batchId });
    assert.equal(umailResult.batch.channel, 'UMAIL');
    assert.equal(umailResult.recipients[0].status, 'accepted');
    assert.equal(calls.length, 1);
    assert.deepEqual({ organizationId: calls[0].organizationId, resourceId: calls[0].resourceId,
      to: calls[0].to, subject: calls[0].subject, content: calls[0].content,
      reply: calls[0].relpy_to, attachmentId: calls[0].attachments[0].id },
    { organizationId: org, resourceId, to: 'dup@example.com', subject: 'Chosen source',
      content: 'selected mailsou-1', reply: 'umail-reply@example.net', attachmentId });
    assert.equal('tpl_id' in calls[0], false);
    assert.equal(calls[0].attachments[0].bytes.toString(), 'PDF');
    await shared.execute(identity, { batchId: umailBatch.batchId });
    assert.equal(calls.length, 1);
    assert.deepEqual([(await shared.quota(identity)).reserved, (await shared.quota(identity)).used], [1, 2]);
    const otherIdentity = { ...identity, id: otherActor, email: 'other@example.com' };
    const otherDraftId = randomUUID();
    await pool.query(`INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,
      subject,content,selections) SELECT $1,organization_id,$2,profile_id,template_id,template_version,
      subject,content,selections FROM email_drafts WHERE id=$3`, [otherDraftId, otherActor, draftId]);
    const memberPreviews = [randomUUID(), randomUUID()];
    for (const id of memberPreviews) {
      await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,
        template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
        SELECT $1,$2,organization_id,$3,profile_id,template_id,template_version,subject,content,
          ARRAY[$4]::uuid[],recipient_snapshot,$5,clock_timestamp() FROM email_previews WHERE id=$6`,
      [id, otherDraftId, otherActor, attachmentId, JSON.stringify([recipients[0]]), previewId]);
    }
    await shared.configureLimit(platform, { organizationId: org, dailyLimit: 4 });
    const competition = await Promise.allSettled([
      shared.confirm(otherIdentity, { ...body, previewId: memberPreviews[0], channelId }),
      shared.confirm(otherIdentity, { ...body, previewId: memberPreviews[1], channelId: umailChannelId })
    ]);
    assert.equal(competition.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(competition.filter(item => item.status === 'rejected').length, 1);
    assert.equal((await shared.quota(identity)).remaining, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contact_point_ledger')).rows[0].n, 0);
    const foreignOrg = randomUUID();
    const foreignChannel = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,'Other team','terminal',$2,'enc','other-key','***')",
      [foreignOrg, platformOrg]);
    await pool.query(`INSERT INTO umail_resources(organization_id,external_resource_id,resource_status,verification_detail,
      checked_at,configured_by) VALUES($1,'foreign-resource','available','controlled',clock_timestamp(),$2)`,
    [foreignOrg, platformId]);
    await pool.query(`INSERT INTO team_sending_channels(id,organization_id,kind,reply_to,verification_state,
      verification_detail,verified_at,updated_by,umail_domain,umail_sender_address,umail_domain_status,
      umail_account_status,umail_dns_records) VALUES($1,$2,'UMAIL','foreign-reply@example.net','available',
      'controlled',clock_timestamp(),$3,'foreign.example.com','sender@foreign.example.com','verified','available','[]')`,
    [foreignChannel, foreignOrg, platformId]);
    await assert.rejects(shared.confirm(identity, { ...body, previewId: overLimitPreviewId, channelId: foreignChannel }));
    await shared.configureLimit(platform, { organizationId: org, dailyLimit: 6 });
    const outcomePreviews = [randomUUID(), randomUUID()];
    for (const id of outcomePreviews) {
      await pool.query(`INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,
        template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot,confirmed_at)
        SELECT $1,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,
          attachment_ids,recipient_snapshot,$2,clock_timestamp() FROM email_previews WHERE id=$3`,
      [id, JSON.stringify([recipients[0]]), previewId]);
    }
    let resultCount = 0;
    const outcomes = new EmailSendService(pool, key, sender, { async send(message) {
      resultCount++;
      return { state: resultCount === 1 ? 'not_submitted' : 'accepted', detail: 'controlled',
        organizationId: message.organizationId, resourceId: resultCount === 1 ? message.resourceId : 'foreign-resource',
        recipientId: message.recipientId };
    } });
    const firstOutcome = await outcomes.confirm(identity, { ...body, previewId: outcomePreviews[0], channelId: umailChannelId });
    const secondOutcome = await outcomes.confirm(identity, { ...body, previewId: outcomePreviews[1], channelId: umailChannelId });
    assert.equal((await outcomes.execute(identity, { batchId: firstOutcome.batchId })).recipients[0].status, 'not_submitted');
    assert.equal((await outcomes.execute(identity, { batchId: secondOutcome.batchId })).recipients[0].status, 'uncertain');
    assert.equal((await outcomes.quota(identity)).reserved, 3);
    assert.equal((await outcomes.quota(identity)).used, 2);
    assert.equal(resultCount, 2);
  } finally {
    await pool.end();
  }
});
