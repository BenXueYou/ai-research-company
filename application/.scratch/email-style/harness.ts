import { createApp, h } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import '../../web/styles/index';
import EmailRecordsPage from '../../web/pages/email/EmailRecordsPage.vue';
import EmailComposer from '../../web/pages/companies/components/EmailComposer.vue';
import { provideFormLeave } from '../../web/router/formLeave';

const batchId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const profileId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const contactId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const request = async (path: string) => {
  if (path === 'email-batches' && new URLSearchParams(location.search).has('empty')) return { batches: [] };
  if (path === 'email-batches') return { batches: [
    { id: batchId, profileId, channel: 'SMTP', count: 3, usageDay: '2026-10-28', accepted: 1, delivered: 1, uncertain: 1, paused: 1, replyTo: 'reply@example.net' },
    { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', profileId, channel: 'UMAIL', count: 2, usageDay: '2026-10-27', accepted: 2, delivered: 0, uncertain: 0, paused: 0, replyTo: 'team@example.net' }
  ] };
  if (path === 'email-batches/detail') return { batch: { id: batchId, profileId, channel: 'SMTP', replyTo: 'reply@example.net' }, recipients: [
    { id: contactId, email: 'partner@example.com', status: 'accepted', subject: '合作方案', content: '您好，附件是本次合作方案。', detail: '已提交发信服务', checkedAt: null, parentRecipientId: null, usageDay: '2026-10-28', reconfirmedUsageDay: null },
    { id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', email: 'contact@example.com', status: 'uncertain', subject: '产品介绍', content: '您好，期待进一步沟通。', detail: '等待核对', checkedAt: null, parentRecipientId: null, usageDay: '2026-10-28', reconfirmedUsageDay: null }
  ] };
  if (path === 'public-templates') return { templates: [{ id: batchId, name: '初次联系', version: 1, subject: '您好 {{contactName}}', content: '{{companyName}} 合作邀请', attachments: [] }] };
  return {};
};
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/terminal/emails', component: EmailRecordsPage },
  { path: '/terminal/profiles', component: EmailRecordsPage }
] });
const showComposer = new URLSearchParams(location.search).has('composer');
await router.push(new URLSearchParams(location.search).has('empty') ? '/terminal/emails' : showComposer ? '/terminal/profiles' : `/terminal/emails?batchId=${batchId}`);
await router.isReady();
const component = showComposer ? h(EmailComposer, { profile: { id: profileId, name: 'Target Trading' }, contacts: [
  { id: contactId, mailsouId: 'source-333', returnedCompanyName: 'Target Trading', ownershipStatus: 'matched', ownershipReason: null, email: 'partner@example.com', personalEmail: 'private@example.net', unsubscribed: false }
], request }) : h(EmailRecordsPage, { request });
createApp({
  setup() { provideFormLeave(router, () => true); },
  render: () => h('main', { style: 'max-width:1200px;margin:0 auto;padding:32px' }, [component])
}).use(router).use(ElementPlus).mount('#app');
