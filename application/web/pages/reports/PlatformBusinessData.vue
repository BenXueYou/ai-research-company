<template>
  <section class="business-data">
    <header class="business-heading">
      <div>
        <h1>平台业务数据查看</h1>
        <p>查看授权组织的客户档案与邮件内容。</p>
      </div>
      <div class="heading-actions">
        <el-button :disabled="loading" @click="load">刷新</el-button>
      </div>
    </header>
    <div class="readonly-notice">
      <RouterLink class="return-link" to="/platform/organizations"><span aria-hidden="true">←</span> 返回下级管理</RouterLink>
      <span class="notice-divider" aria-hidden="true"></span>
      <div class="readonly-content">
      <span class="readonly-tag">只读查看</span>
      <p>查看不赋予跨企业修改、删除、发信或导出腾道数据权限。</p>
      </div>
    </div>
    <p v-if="loading" class="loading-message" role="status">业务数据加载中…</p>
    <p v-if="error" class="load-error" role="alert">{{ error }}</p>
    <template v-if="report">
      <div class="organization-filter">
        <div class="filter-field">
          <label for="business-organization">查看组织</label>
          <el-select id="business-organization" v-model="organizationId" filterable placeholder="全部授权组织" aria-label="查看组织" popper-class="business-organization-options">
            <el-option label="全部授权组织" value="" />
            <el-option v-for="organization in report.organizations" :key="organization.id" :value="organization.id"
              :label="`${organization.name}${organization.active ? '' : '（已停用）'}`" />
          </el-select>
        </div>
        <p class="filter-summary">当前显示 <strong>{{ customers.length }}</strong> 份客户档案、<strong>{{ emails.length }}</strong> 条邮件记录</p>
      </div>
      <section class="data-panel" aria-labelledby="business-customers-title">
        <div class="panel-heading">
          <h2 id="business-customers-title">客户档案</h2>
          <span class="record-count">{{ customers.length }} 份档案</span>
        </div>
        <div v-if="!customers.length" class="empty-state">
          <span class="empty-mark" aria-hidden="true">▤</span>
          <p>暂无客户档案</p>
          <span>当前组织范围内还没有客户档案。</span>
        </div>
        <article v-for="customer in customers" :key="customer.id" class="data-record">
          <div class="record-heading">
            <h3>{{ customer.name }}</h3>
            <div class="record-tags">
              <span class="record-tag">{{ customer.customerStatus }}</span>
              <span v-if="customer.deletedAt" class="record-tag deleted-tag">已删除</span>
            </div>
          </div>
          <p class="record-meta">{{ organizationName(customer.organizationId) }} <span aria-hidden="true">·</span> {{ customer.countryCode3 }}</p>
          <dl class="customer-fields">
            <div><dt>主营产品</dt><dd>{{ customer.mainProducts || '—' }}</dd></div>
            <div><dt>采购需求</dt><dd>{{ customer.purchasingNeeds || '—' }}</dd></div>
            <div><dt>合作意向</dt><dd>{{ customer.cooperationIntent || '—' }}</dd></div>
          </dl>
          <details class="record-detail"><summary>档案详情</summary><pre>{{ formatDetail(customer.detail) }}</pre></details>
        </article>
      </section>
      <section class="data-panel" aria-labelledby="business-emails-title">
        <div class="panel-heading">
          <h2 id="business-emails-title">邮件记录</h2>
          <span class="record-count">{{ emails.length }} 条记录</span>
        </div>
        <div v-if="!emails.length" class="empty-state">
          <span class="empty-mark" aria-hidden="true">✉</span>
          <p>暂无邮件记录</p>
          <span>当前组织范围内还没有邮件记录。</span>
        </div>
        <article v-for="email in emails" :key="email.recipientId" class="data-record">
          <div class="record-heading">
            <h3>{{ email.subject }}</h3>
            <span class="record-tag">{{ email.status }}</span>
          </div>
          <p class="record-meta">{{ organizationName(email.organizationId) }} <span aria-hidden="true">·</span> {{ email.channelKind }} <span aria-hidden="true">·</span> {{ email.usageDay }}</p>
          <p class="recipient-address"><span>收件邮箱</span>{{ email.email }}</p>
          <details class="record-detail"><summary>邮件内容</summary><pre class="email-content">{{ email.content }}</pre></details>
        </article>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { ElButton, ElOption, ElSelect } from 'element-plus';

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
.business-data { width: min(1180px, 100%); min-width: 0; color: var(--console-text); }
.business-heading, .heading-actions, .panel-heading, .record-heading, .record-tags { display: flex; align-items: center; gap: 12px; }
.business-heading { justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
.business-heading h1 { margin: 0 0 7px; font-size: 24px; font-weight: 700; line-height: 1.4; letter-spacing: -.4px; }
.business-heading p { margin: 0; color: var(--console-muted); font-size: 13px; line-height: 1.8; }
.heading-actions { flex-shrink: 0; padding-top: 3px; gap: 18px; }
.heading-actions :deep(.el-button) { border-radius: 8px; }
.readonly-notice { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border: 1px solid #e2e7fd; border-radius: 8px; margin-bottom: 20px; color: #6372a4; background: #f3f5ff; }
.return-link { flex-shrink: 0; color: var(--console-brand); font-size: 13px; text-decoration: none; }
.return-link:hover { text-decoration: underline; }
.return-link:focus-visible { outline: 2px solid var(--console-brand); outline-offset: 3px; border-radius: 3px; }
.notice-divider { align-self: stretch; width: 1px; flex-shrink: 0; background: #dce2fa; }
.readonly-content { display: flex; align-items: center; gap: 10px; min-width: 0; }
.readonly-tag { flex: none; padding: 3px 8px; border-radius: 5px; color: var(--console-brand); background: #e6eaff; font-size: 11px; font-weight: 600; }
.readonly-notice p { margin: 0; font-size: 12px; line-height: 1.8; }
.organization-filter, .data-panel { min-width: 0; border: 1px solid var(--console-line); border-radius: 12px; background: var(--console-surface); box-shadow: 0 2px 5px #19234605; }
.organization-filter { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 12px 24px; padding: 16px 20px; margin-bottom: 20px; }
.filter-field { width: min(360px, 100%); min-width: 0; }
.filter-field label { display: block; margin-bottom: 8px; color: var(--console-muted); font-size: 12px; }
.filter-field :deep(.el-select) { width: 100%; --el-color-primary: var(--console-brand); --el-border-color: var(--console-line-strong); }
.filter-field :deep(.el-select__wrapper) { min-height: 40px; border-radius: 8px; font-size: 13px; }
.filter-field :deep(.el-select__input:focus-visible) { outline: none; }
.filter-summary { margin: 0 0 10px; color: var(--console-muted); font-size: 12px; line-height: 1.8; }
.filter-summary strong { color: var(--console-brand); font-weight: 600; font-variant-numeric: tabular-nums; }
.data-panel { margin-bottom: 20px; overflow: hidden; }
.panel-heading { justify-content: space-between; padding: 19px 22px; border-bottom: 1px solid var(--console-line); }
.panel-heading h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.5; }
.record-count { color: var(--console-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.data-record { min-width: 0; padding: 20px 22px; overflow-wrap: anywhere; }
.data-record + .data-record { border-top: 1px solid #edf0f6; }
.record-heading { justify-content: space-between; align-items: flex-start; }
.record-heading h3 { min-width: 0; margin: 0; color: var(--console-text); font-size: 14px; font-weight: 600; line-height: 1.7; }
.record-tags { flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.record-tag { flex: none; max-width: 100%; padding: 3px 8px; border-radius: 5px; color: #5365c5; background: #eef1ff; font-size: 11px; line-height: 1.6; }
.deleted-tag { color: var(--console-muted); background: #edf0f5; }
.record-meta { margin: 7px 0 16px; color: var(--console-muted); font-size: 12px; line-height: 1.8; }
.record-meta > span { margin: 0 7px; color: #b0b8c7; }
.customer-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px; padding: 15px 17px; border: 1px solid #edf0f6; border-radius: 8px; margin: 0 0 14px; background: #f8f9fc; }
.customer-fields dt { margin-bottom: 6px; color: var(--console-muted); font-size: 12px; }
.customer-fields dd { margin: 0; color: #46536a; font-size: 13px; line-height: 1.8; }
.recipient-address { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0 0 14px; color: #46536a; font-size: 13px; line-height: 1.8; }
.recipient-address > span { color: var(--console-muted); font-size: 12px; }
.record-detail summary { width: fit-content; padding: 4px 0; color: var(--console-brand); font-size: 12px; cursor: pointer; }
.record-detail summary:hover { color: var(--console-brand-deep); }
.record-detail summary:focus-visible { outline: 2px solid var(--console-brand); outline-offset: 3px; border-radius: 3px; }
.record-detail pre { max-width: 100%; padding: 16px; border: 1px solid #e9edf5; border-radius: 8px; margin: 10px 0 0; color: #5f6c87; background: #f5f7fc; font: 12px/1.8 Consolas, 'Microsoft YaHei', monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.record-detail .email-content { color: #46536a; background: #fafbfe; font: 13px/1.9 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.empty-state { padding: 34px 20px 38px; text-align: center; }
.empty-mark { display: block; margin-bottom: 12px; color: #a5b0df; font-size: 30px; line-height: 1.3; }
.empty-state p { margin: 0 0 8px; color: #53617e; font-size: 14px; }
.empty-state > span:last-child { color: var(--console-muted); font-size: 12px; }
.loading-message { margin: 0 0 18px; color: var(--console-muted); font-size: 13px; }
.load-error { padding: 14px 16px; border: 1px solid #f0d2d6; border-radius: 8px; margin: 0 0 20px; color: var(--console-danger); background: #fff4f4; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .business-heading { flex-direction: column; gap: 13px; }
  .heading-actions { flex-wrap: wrap; padding: 0; }
  .readonly-notice { flex-wrap: wrap; align-items: flex-start; gap: 12px; }
  .notice-divider { display: none; }
  .readonly-content { flex-basis: 100%; align-items: flex-start; }
  .organization-filter, .panel-heading, .data-record { padding: 17px; }
  .organization-filter { align-items: stretch; gap: 12px; }
  .filter-field { width: 100%; }
  .filter-summary { margin: 0; }
  .customer-fields { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 14px; }
  .record-heading { flex-wrap: wrap; gap: 8px; }
  .record-tags { justify-content: flex-start; }
}
</style>

<style>
.business-organization-options { --el-color-primary: #4356e0; }
.business-organization-options .el-select-dropdown__item { font-size: 13px; }
</style>
