<template>
  <section class="workspace">
    <div class="page-heading">
      <h1>团队发信设置</h1>
    </div>
    <TeamSmtpSettings :can-maintain="role === 'admin'" :request="request" />
    <TeamUMailSettings :can-maintain="role === 'admin'" :request="request" />
  </section>
</template>

<script setup lang="ts">
import TeamSmtpSettings from './TeamSmtpSettings.vue';
import TeamUMailSettings from './TeamUMailSettings.vue';

defineProps<{
  role: string;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
</script>
