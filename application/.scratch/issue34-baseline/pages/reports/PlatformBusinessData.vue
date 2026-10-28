<template>
  <section class="business-data">
    <header>
      <h1>业务数据查看</h1>
      <RouterLink to="/platform/organizations">返回下级管理</RouterLink>
      <el-button :disabled="loading" @click="load">刷新</el-button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <label for="business-organization">查看组织</label>
      <select id="business-organization" v-model="organizationId">
        <option value="">全部授权组织</option>
        <option v-for="organization in report.organizations" :key="organization.id" :value="organization.id">
          {{ organization.name }}{{ organization.active ? '' : '（已停用）' }}
        </option>
      </select>
      <h2>客户档案</h2>
      <p v-if="!customers.length">暂无客户档案</p>
      <article v-for="customer in customers" :key="customer.id">
        <h3>{{ customer.name }}</h3>
        <p>{{ organizationName(customer.organizationId) }} · {{ customer.countryCode3 }} · {{ customer.customerStatus }}{{ customer.deletedAt ? ' · 已删除' : '' }}</p>
        <p>主营产品：{{ customer.mainProducts || '—' }}；采购需求：{{ customer.purchasingNeeds || '—' }}；合作意向：{{ customer.cooperationIntent || '—' }}</p>
        <details><summary>档案详情</summary><pre>{{ formatDetail(customer.detail) }}</pre></details>
      </article>
      <h2>邮件记录</h2>
      <p v-if="!emails.length">暂无邮件记录</p>
      <article v-for="email in emails" :key="email.recipientId">
        <h3>{{ email.subject }}</h3>
        <p>{{ organizationName(email.organizationId) }} · {{ email.email }} · {{ email.channelKind }} · {{ email.usageDay }} · {{ email.status }}</p>
        <details><summary>邮件内容</summary><pre>{{ email.content }}</pre></details>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { ElButton } from 'element-plus';

type Organization = { id: string; name: string; active: boolean };
type Customer = {
  id: string; organizationId: string; name: string; countryCode3: string; customerStatus: string;
  deletedAt: string | null; mainProducts: string | null; purchasingNeeds: string | null;
  cooperationIntent: string | null; detail: unknown;
};
type Email = {
  id: string; organizationId: string; profileId: string; recipientId: string; channelKind: string;
  usageDay: string; status: string; email: string; subject: string; content: string;
};
type Report = { organizations: Organization[]; customers: Customer[]; emails: Email[] };
const props = defineProps<{ request: (path: string) => Promise<unknown> }>();
const report = shallowRef<Report | null>(null);
const organizationId = shallowRef('');
const loading = shallowRef(false);
const error = shallowRef('');
const customers = computed(() => report.value?.customers.filter(item =>
  !organizationId.value || item.organizationId === organizationId.value) ?? []);
const emails = computed(() => report.value?.emails.filter(item =>
  !organizationId.value || item.organizationId === organizationId.value) ?? []);
function organizationName(id: string) {
  return report.value?.organizations.find(item =>
    item.id === id)?.name ?? id;
}
function formatDetail(detail: unknown) {
  return typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2) ?? '—';
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    report.value = await props.request('reports') as Report;
  } catch (cause) {
    report.value = null;
    error.value = cause instanceof Error ? cause.message : '业务数据加载失败';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.business-data { padding: 24px; background: #fff; border-radius: 12px; }
.business-data header { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.business-data select { margin-left: 12px; max-width: 100%; padding: 8px; }
.business-data article { padding: 12px 0; border-bottom: 1px solid #e5e7f1; overflow-wrap: anywhere; }
.business-data pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
