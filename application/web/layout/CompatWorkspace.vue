<template>
  <section class="workspace">
    <CoefficientNotice :request="request" />
    <OrganizationOpening
      id="compat-organizations"
      v-if="session.role === 'distributor'"
      :request="request"
    />
    <TeamSmtpSettings
      id="compat-sending"
      v-if="['admin', 'sales'].includes(session.role)"
      :can-maintain="session.role === 'admin'"
      :request="request"
    />
    <TeamUMailSettings
      v-if="['admin', 'sales'].includes(session.role)"
      :can-maintain="session.role === 'admin'"
      :request="request"
    />
    <PointOrders
      id="compat-orders"
      v-if="session.role === 'distributor'"
      :request="request"
    />
    <UsageReports v-if="session.role === 'distributor'" id="compat-usage" :request="request" />
  </section>
</template>

<script setup lang="ts">
import type { Session } from '../stores/session';
import OrganizationOpening from '../pages/organizations/OrganizationOpening.vue';
import CoefficientNotice from '../pages/commerce/components/CoefficientNotice.vue';
import PointOrders from '../pages/commerce/PointOrders.vue';
import UsageReports from '../pages/reports/UsageReports.vue';
import TeamSmtpSettings from '../pages/email/TeamSmtpSettings.vue';
import TeamUMailSettings from '../pages/email/TeamUMailSettings.vue';

defineProps<{
  session: Session;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  title: string;
}>();
</script>
