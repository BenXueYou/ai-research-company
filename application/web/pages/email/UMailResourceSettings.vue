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
    <el-form ref="selectionForm" :model="{ organizationId }"
      class="business-form identity-card umail-form"
      label-position="top"
      :disabled="busy || resultUnknown"
      @submit.prevent="save"
    >
      <el-form-item label="终端企业" for="umail-organization" prop="organizationId" :rules="[{ required: true, message: '请选择终端企业', trigger: 'change' }]">
        <el-select :empty-values="[null, undefined]"
          id="umail-organization"
          v-model="organizationId"
          :disabled="busy || resultUnknown"
        >
          <el-option value="" disabled label="请选择企业" />
          <el-option v-for="item in organizations" :key="item.organizationId" :value="item.organizationId" :label="`${item.name} · ${statusLabel(item.resourceStatus)}`" />
        </el-select>
      </el-form-item>
      <el-form-item label="U-Mail 隔离资源标识" for="umail-resource-id">
        <el-input
          id="umail-resource-id"
          v-model="resourceId"
          required
          :disabled="busy || resultUnknown"
        />
      </el-form-item>
      <div class="form-actions">
        <el-button type="primary" native-type="submit" :disabled="busy || resultUnknown">
          {{ busy ? '正在核验并保存…' : '核验资源并保存' }}
        </el-button>
      </div>
    </el-form>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import {
  ElSelect,
  ElOption,
  type FormInstance,
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
const selectionForm = ref<FormInstance>();
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
  if (!await selectionForm.value?.validate().catch(() => false)) return;
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
.umail-form { max-width: none; padding: 0; border: 0; box-shadow: none; }
@media (max-width: 760px) {
  .settings-heading { display: block; }
  .back-link { display: inline-block; margin-top: 14px; }
  .settings-heading h1 { font-size: 21px; }
  .settings-navigation { gap: 20px; }
  .settings-card { padding: 18px 16px; }
}
</style>
