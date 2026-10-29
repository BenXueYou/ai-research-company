<template>
  <section class="workspace sending-settings">
    <div class="page-heading sending-heading">
      <h1>团队发信设置</h1>
    </div>
    <div class="sending-channel-grid">
      <TeamSmtpSettings :can-maintain="role === 'admin'" :request="request" />
      <TeamUMailSettings :can-maintain="role === 'admin'" :request="request" />
    </div>
  </section>
</template>

<script setup lang="ts">
import TeamSmtpSettings from './components/TeamSmtpSettings.vue';
import TeamUMailSettings from './components/TeamUMailSettings.vue';

defineOptions({ name: 'TeamSendingSettingsPage' });

defineProps<{
  role: string;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
</script>

<style scoped>
.sending-settings { width: min(1180px, 100%); min-width: 0; }
.sending-heading { margin-bottom: 22px; }
.sending-heading h1 { margin: 0; font-size: 24px; line-height: 1.4; letter-spacing: -.4px; }
.sending-channel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 18px; }
.sending-channel-grid > :deep(section) { min-width: 0; margin-top: 0; }
.sending-channel-grid :deep(.page-heading) { min-height: 105px; margin-bottom: 16px; }
.sending-channel-grid :deep(.page-heading .eyebrow) { margin: 0 0 6px; color: #8793a8; font-size: 10px; letter-spacing: 1px; }
.sending-channel-grid :deep(.page-heading h2) { margin: 0 0 6px; color: #263052; font-size: 17px; }
.sending-channel-grid :deep(.page-heading p:last-child) { margin: 0; color: #738095; font-size: 12px; line-height: 1.7; }
.sending-channel-grid :deep(.workspace-card), .sending-channel-grid :deep(.identity-card) {
  max-width: none;
  padding: 20px;
  border: 1px solid #e2e7f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 5px #19234605;
}
.sending-channel-grid :deep(.workspace-card h3), .sending-channel-grid :deep(.identity-card h3) { margin: 0 0 14px; color: #263052; font-size: 14px; }
.sending-channel-grid :deep(dl) { grid-template-columns: 96px minmax(0, 1fr); gap: 10px; margin: 0; font-size: 12px; line-height: 1.7; }
.sending-channel-grid :deep(dd) { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 1050px) {
  .sending-channel-grid { grid-template-columns: minmax(0, 1fr); }
  .sending-channel-grid :deep(.page-heading) { min-height: 0; }
}
@media (max-width: 760px) {
  .sending-heading h1 { font-size: 21px; }
  .sending-channel-grid :deep(.workspace-card), .sending-channel-grid :deep(.identity-card) { padding: 18px 16px; }
}
</style>
