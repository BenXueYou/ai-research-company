import { createApp, h } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import TeamSendingSettingsPage from '../../../web/pages/email/TeamSendingSettingsPage.vue';
import { provideFormLeave } from '../../../web/router/formLeave';

const calls = [];
Object.assign(window, { issue57Calls: calls });
const request = async (path, body) => {
  calls.push({ path, body });
  if (path === 'sending-channels/smtp') {
    return { channel: body ? {
      id: 'smtp-channel-id',
      host: body.host,
      port: Number(body.port),
      security: body.security,
      username: body.username,
      replyTo: body.replyTo,
      defaultChannel: body.defaultChannel,
      verificationState: 'available',
      verificationDetail: '受控验证'
    } : null };
  }
  return {
    resource: { resourceStatus: 'available', verificationDetail: '受控资源' },
    channel: body ? {
      domain: body.domain,
      senderAddress: body.senderAddress,
      replyAddress: body.replyAddress,
      defaultChannel: body.defaultChannel,
      domainStatus: 'verified',
      accountStatus: 'available',
      verificationDetail: '受控验证'
    } : null
  };
};
const router = createRouter({ history: createMemoryHistory(), routes: [] });
createApp({
  setup() {
    provideFormLeave(router, () => true);
    return () => h(TeamSendingSettingsPage, {
      role: new URLSearchParams(location.search).get('role') ?? 'admin',
      request
    });
  }
}).use(ElementPlus).use(router).mount('#app');


