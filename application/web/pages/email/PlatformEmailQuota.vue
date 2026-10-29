<template>
  <section class="platform-email-page quota-page">
    <header class="settings-heading">
      <div>
        <p class="settings-kicker">平台设置 / 邮件资源</p>
        <h1>企业邮件日额度</h1>
        <p>按北京时间每日零点重置；SMTP 与 U-Mail 共用企业额度。</p>
      </div>
      <RouterLink class="back-link" to="/platform/settings">返回平台设置</RouterLink>
    </header>
    <nav class="settings-navigation" aria-label="平台设置">
      <RouterLink to="/platform/settings">计价配置</RouterLink>
      <RouterLink to="/platform/settings/umail">U-Mail 企业资源</RouterLink>
      <span aria-current="page">企业邮件日额度</span>
    </nav>
    <section class="settings-card" aria-labelledby="email-quota-form-title">
      <div class="card-heading">
        <div>
          <p class="card-kicker">额度控制</p>
          <h2 id="email-quota-form-title">设置企业每日封数</h2>
        </div>
        <span class="status-pill">北京时间</span>
      </div>
      <p class="card-hint">默认额度为每企业每日 2000 封。修改只影响后续发送的额度核算。</p>
    <el-form class="business-form quota-form" label-position="top" :disabled="busy || resultUnknown" @submit.prevent="save">
      <el-form-item label="终端企业">
        <el-select v-model="organizationId" placeholder="选择终端企业">
          <el-option
            v-for="item in organizations"
            :key="item.organizationId"
            :label="item.name"
            :value="item.organizationId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="每日封数">
        <el-input
          v-model="dailyLimit"
          type="number"
          min="1"
          max="1000000"
        />
      </el-form-item>
      <div class="form-actions">
        <el-button type="primary" native-type="submit" :disabled="busy || resultUnknown">保存日额度</el-button>
      </div>
    </el-form>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <p v-if="notice" role="status">{{ notice }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect
} from 'element-plus';
import { useFormLeave } from '../../router/formLeave';
import { RouterLink } from 'vue-router';

interface Organization { organizationId: string; name: string }
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const organizations = ref<Organization[]>([]);
const organizationId = ref('');
const dailyLimit = ref('2000');
const committedOrganizationId = ref('');
const committedDailyLimit = ref('2000');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const resultUnknown = ref(false);
function hasUnsavedChanges() {
  return organizationId.value !== committedOrganizationId.value || dailyLimit.value !== committedDailyLimit.value;
}
useFormLeave({
  state: () => busy.value ? 'submitting' : resultUnknown.value ? 'unknown' : hasUnsavedChanges() ? 'dirty' : 'clean',
  retainUnknown: true,
  discard: () => {
    organizationId.value = '';
    dailyLimit.value = '2000';
    committedOrganizationId.value = '';
    committedDailyLimit.value = '2000';
  }
});
async function save() {
  if (busy.value || resultUnknown.value) return;
  busy.value = true;
  error.value = '';
  try {
    const count = Number(dailyLimit.value);
    if (!Number.isInteger(count) || count < 1 || count > 1000000) throw new Error('日额度须为 1 至 1000000 的整数');
    const selected = organizations.value.find(item =>
      item.organizationId === organizationId.value
    );
    if (!selected) throw new Error('请选择终端企业');
    try {
      await props.request('email-quota/configure', { organizationId: selected.organizationId, dailyLimit: count });
    } catch (failure) {
      if (failure instanceof TypeError || failure instanceof SyntaxError) resultUnknown.value = true;
      throw failure;
    }
    committedOrganizationId.value = organizationId.value;
    committedDailyLimit.value = dailyLimit.value;
    notice.value = `${selected.name} 的每日额度已设为 ${count} 封`;
  } catch (failure) {
    error.value = resultUnknown.value ? '额度配置结果尚未确认，请联系平台核实；勿重复提交。' : failure instanceof Error ? failure.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void props.request('umail/resources').then(result => {
    organizations.value = (result as { organizations: Organization[] }).organizations;
  }).catch(failure => { error.value = failure instanceof Error ? failure.message : '加载企业失败'; });
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
[role='status'] { margin: 16px 0 0; color: #16885e; font-size: 13px; }
@media (max-width: 760px) {
  .settings-heading { display: block; }
  .back-link { display: inline-block; margin-top: 14px; }
  .settings-heading h1 { font-size: 21px; }
  .settings-navigation { gap: 20px; }
  .settings-card { padding: 18px 16px; }
}
</style>
