<template>
  <section class="platform-email-page umail-section">
    <header class="settings-heading">
      <div>
        <p class="settings-kicker">平台设置 / 邮件资源</p>
        <h1>U-Mail 企业资源</h1>
        <p>为终端企业配置隔离资源，平台承担第一阶段费用。</p>
      </div>
      <RouterLink class="back-link" to="/platform/settings">返回平台设置</RouterLink>
    </header>
    <nav class="settings-navigation" aria-label="平台设置">
      <RouterLink to="/platform/settings">计价配置</RouterLink>
      <span aria-current="page">U-Mail 企业资源</span>
      <RouterLink to="/platform/settings/email-quota">企业邮件日额度</RouterLink>
    </nav>
    <section class="settings-card" aria-labelledby="umail-resource-form-title">
      <div class="card-heading">
        <div>
          <p class="card-kicker">资源核验</p>
          <h2 id="umail-resource-form-title">绑定终端企业</h2>
        </div>
        <span class="status-pill">平台维护</span>
      </div>
      <p class="card-hint">选择目标企业并填写供应商资源标识，保存前会先进行受控核验。</p>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <el-alert
      v-if="notice"
      role="status"
      type="success"
      :title="notice"
      :closable="false"
    />
    <el-form
      class="identity-card umail-form"
      label-position="top"
      :disabled="busy || resultUnknown"
      @submit.prevent="save"
    >
      <el-form-item label="终端企业" for="umail-organization">
        <select
          id="umail-organization"
          v-model="organizationId"
          required
          :disabled="busy || resultUnknown"
        >
          <option value="" disabled>请选择企业</option>
          <option v-for="item in organizations" :key="item.organizationId" :value="item.organizationId">
            {{ item.name }} · {{ statusLabel(item.resourceStatus) }}
          </option>
        </select>
      </el-form-item>
      <el-form-item label="U-Mail 隔离资源标识" for="umail-resource-id">
        <el-input
          id="umail-resource-id"
          v-model="resourceId"
          required
          :disabled="busy || resultUnknown"
        />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :disabled="busy || resultUnknown">
        {{ busy ? '正在核验并保存…' : '核验资源并保存' }}
      </el-button>
    </el-form>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
import { useFormLeave } from '../../router/formLeave';
import { RouterLink } from 'vue-router';

interface OrganizationResource {
  organizationId: string;
  name: string;
  resourceStatus: string | null;
}
const props = defineProps<{
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const organizations = shallowRef<OrganizationResource[]>([]);
const organizationId = ref('');
const resourceId = ref('');
const committedOrganizationId = ref('');
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const error = ref('');
const notice = ref('');
const resultUnknown = ref(false);
function hasUnsavedChanges() {
  return organizationId.value !== committedOrganizationId.value || !!resourceId.value;
}
useFormLeave({
  state: () => busy.value ? 'submitting' : resultUnknown.value ? 'unknown' : hasUnsavedChanges() ? 'dirty' : 'clean',
  retainUnknown: true,
  discard: () => {
    organizationId.value = '';
    committedOrganizationId.value = '';
    resourceId.value = '';
    requestId.value = crypto.randomUUID();
  }
});
function statusLabel(value: string | null) {
  if (value === 'available') return '受控验证可用';
  if (value === 'unavailable') return '受控验证不可用';
  return value ? '尚未真实联调' : '未配置';
}
async function refresh() {
  const result = await props.request('umail/resources') as { organizations: OrganizationResource[] };
  organizations.value = result.organizations;
}
async function save() {
  if (busy.value || resultUnknown.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    try {
      await props.request('umail/resources', {
        organizationId: organizationId.value,
        resourceId: resourceId.value,
        requestId: requestId.value
      });
    } catch (failure) {
      if (failure instanceof TypeError || failure instanceof SyntaxError) resultUnknown.value = true;
      throw failure;
    }
    requestId.value = crypto.randomUUID();
    resourceId.value = '';
    committedOrganizationId.value = organizationId.value;
    notice.value = '企业 U-Mail 资源已保存；第一阶段费用由平台承担';
    await refresh();
  } catch (failure) {
    error.value = resultUnknown.value ? '资源配置结果尚未确认，请联系平台核实；勿重复提交。' : failure instanceof Error ? failure.message : '资源保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try { await refresh(); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '企业资源加载失败'; }
});
</script>

<style scoped>
.platform-email-page {
  --email-accent: #4356e0;
  --email-line: #e6e9f0;
  --email-muted: #738095;
  width: 100%;
  min-width: 0;
  color: #1c2333;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif;
}
.settings-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.settings-kicker, .card-kicker { margin: 0 0 7px; color: #9ba6bd; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; }
.settings-heading h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.4; letter-spacing: -.4px; }
.settings-heading p:last-child, .card-hint { margin: 0; color: var(--email-muted); font-size: 13px; line-height: 1.8; }
.back-link { flex: none; margin-top: 8px; color: var(--email-accent); font-size: 13px; text-decoration: none; }
.back-link::before { content: '← '; }
.settings-navigation { display: flex; gap: 26px; margin: 22px 0; border-bottom: 1px solid var(--email-line); overflow-x: auto; }
.settings-navigation > * { flex: none; padding: 12px 2px; border-bottom: 2px solid transparent; color: var(--email-muted); font-size: 13px; text-decoration: none; }
.settings-navigation [aria-current] { border-bottom-color: var(--email-accent); color: var(--email-accent); font-weight: 600; }
.settings-navigation a:hover { color: var(--email-accent); }
.settings-card { max-width: 920px; padding: 24px; border: 1px solid var(--email-line); border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
.card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #edf0f6; }
.card-heading h2 { margin: 0; font-size: 17px; font-weight: 650; }
.status-pill { padding: 4px 9px; border-radius: 5px; color: #5365c5; background: #eef1ff; font-size: 11px; white-space: nowrap; }
.card-hint { margin: 16px 0 20px; }
.settings-card :deep(.el-alert) { margin-bottom: 16px; }
.umail-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 0 18px; max-width: none; padding: 0; border: 0; box-shadow: none; }
.umail-form :deep(.el-form-item) { min-width: 0; margin-bottom: 0; }
.umail-form :deep(.el-form-item__label) { height: auto; margin-bottom: 8px; color: #647087; font-size: 12px; line-height: 1.6; }
.umail-form :deep(.el-input__wrapper) { min-height: 42px; border-radius: 8px; box-shadow: 0 0 0 1px #dfe4ee inset; }
.umail-form :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--email-accent) inset; }
select { box-sizing: border-box; width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid #dfe4ee; border-radius: 8px; color: #1c2333; background: #fff; font: inherit; font-size: 13px; }
select:focus-visible { outline: 2px solid #4356e040; outline-offset: 2px; border-color: var(--email-accent); }
.umail-form :deep(.el-button) { min-height: 42px; margin: 0; padding: 10px 18px; border-color: var(--email-accent); border-radius: 8px; color: #fff; background: var(--email-accent); font-size: 13px; font-weight: 600; box-shadow: 0 3px 7px #4356e017; }
.umail-form :deep(.el-button:not(:disabled):hover) { border-color: #3343c9; background: #3343c9; }
@media (max-width: 760px) {
  .settings-heading { display: block; }
  .back-link { display: inline-block; margin-top: 14px; }
  .settings-heading h1 { font-size: 21px; }
  .settings-navigation { gap: 20px; }
  .settings-card { padding: 18px 16px; }
  .umail-form { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .umail-form :deep(.el-form-item) { margin-bottom: 0; }
  .umail-form :deep(.el-button) { width: 100%; }
}
</style>
