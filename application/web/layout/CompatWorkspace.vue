<template>
  <section class="workspace">
    <CoefficientNotice :request="request" />
    <OrganizationOpening
      id="compat-organizations"
      v-if="session.role === 'distributor'"
      :request="request"
    />
    <MemberManagement
      id="compat-members"
      v-if="session.role === 'admin'"
      :request="request"
      :current-account-id="session.id"
    />
    <CompanySearch
      id="company-search"
      v-if="['admin', 'sales'].includes(session.role)"
      :key="profileRefresh"
      :current-account-id="session.id"
      :can-delete-timeline="session.role === 'admin'"
      :request="request"
    />
    <ProductSearch
      v-if="['admin', 'sales'].includes(session.role)"
      :request="request"
      @profile-created="profileRefresh += 1"
    />
    <TeamSmtpSettings
      id="compat-sending"
      v-if="['admin', 'sales'].includes(session.role)"
      :can-maintain="session.role === 'admin'"
      :request="request"
    />
    <EmailSendRecords
      id="compat-emails"
      v-if="['admin', 'sales'].includes(session.role)"
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
    <UsageReports v-if="session.role !== 'platform'" id="compat-usage" :request="request" />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Session } from '../stores/session';
import OrganizationOpening from '../pages/organizations/OrganizationOpening.vue';
import MemberManagement from '../pages/organizations/MemberManagement.vue';
import CompanySearch from '../pages/companies/CompanySearch.vue';
import ProductSearch from '../pages/companies/ProductSearch.vue';
import CoefficientNotice from '../pages/commerce/components/CoefficientNotice.vue';
import PointOrders from '../pages/commerce/PointOrders.vue';
import UsageReports from '../pages/reports/UsageReports.vue';
import TeamSmtpSettings from '../pages/email/TeamSmtpSettings.vue';
import EmailSendRecords from '../pages/email/EmailSendRecords.vue';
import TeamUMailSettings from '../pages/email/TeamUMailSettings.vue';

defineProps<{
  session: Session;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  title: string;
}>();
const profileRefresh = ref(0);
</script>
