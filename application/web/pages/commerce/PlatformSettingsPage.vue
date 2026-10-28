<script setup lang="ts">
import CoefficientChanges from './CoefficientChanges.vue';
import PricingSettings from './components/PricingSettings.vue';
import { RouterLink } from 'vue-router';

type SettingsRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

defineOptions({ name: 'PlatformSettingsPage' });

defineProps<{ request: SettingsRequest }>();
</script>

<template>
  <div class="platform-settings-page">
    <div class="page-heading">
      <p>维护接口单价、最低加价率和换算系数；既有余额及已确认查询按原规则保留。</p>
    </div>
    <PricingSettings :request="request" />
    <CoefficientChanges :request="request" />
    <nav aria-label="邮件设置">
      <RouterLink to="/platform/settings/umail">U-Mail 企业资源</RouterLink> ·
      <RouterLink to="/platform/settings/email-quota">企业邮件日额度</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.platform-settings-page {
  width: 100%;
}
</style>
