<template>
  <section class="member-section">
    <template v-if="auth.session?.role === 'admin'">
    <div class="page-heading">
      <h2>成员管理</h2>
      <p>管理本企业成员。停用保留历史，本人和首位管理员不可停用。</p>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <section v-if="credentials" class="identity-card credential-card" aria-label="成员凭据">
      <h3>{{ credentialAction === 'reset' ? '成员密码重置成功' : '成员创建成功' }}</h3>
      <p>临时密码有效期72小时，首次登录必须改密。关闭后无法查询原密码。</p>
      <dl class="handoff-values">
        <dt>登录邮箱</dt><dd data-testid="member-email">{{ credentials.email }}</dd>
        <dt>临时密码</dt><dd data-testid="member-password">{{ credentials.temporaryPassword }}</dd>
        <dt>有效期至</dt><dd>{{ new Date(credentials.expiresAt).toLocaleString() }}</dd>
      </dl>
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
      <el-button class="member-primary" :disabled="copying" @click="copyCredentials">一键复制账号信息</el-button>
      <el-button @click="closeCredentials">已保存，关闭凭据</el-button>
    </section>
    <el-alert
      v-if="pending && !busy"
      type="warning"
      title="操作结果尚未确认。请核实原请求，勿重复发起新操作。"
      :closable="false"
    />
    <el-button v-if="pending" :disabled="busy" @click="verifyPending">核实原请求</el-button>
    <el-form
      v-else-if="!credentials"
      class="identity-card member-form"
      label-position="top"
      @submit.prevent="createMember"
    >
      <div class="card-heading"><h3>创建本企业成员</h3><p>系统生成临时密码，首次登录须修改密码。</p></div>
      <div class="member-fields">
      <el-form-item label="成员姓名" for="member-name">
        <el-input
          id="member-name"
          v-model="name"
          required
          :disabled="busy || !!pending"
        />
      </el-form-item>
      <el-form-item label="成员登录邮箱" for="member-login">
        <el-input
          id="member-login"
          v-model="email"
          type="email"
          required
          :disabled="busy || !!pending"
        />
      </el-form-item>
      <el-form-item label="成员角色" for="member-role">
        <select
          id="member-role"
          v-model="role"
          required
          :disabled="busy || !!pending"
        >
          <option value="sales">业务员</option>
          <option value="admin">终端企业管理员</option>
        </select>
      </el-form-item>
      </div>
      <el-button
        class="member-primary"
        native-type="submit"
        :disabled="busy || !!pending"
      >{{ busy ? '正在创建…' : '确认创建成员' }}</el-button>
    </el-form>
    <div class="workspace-card member-list">
      <div class="list-heading">
        <div><h3>本企业成员 <span class="member-count" aria-hidden="true">{{ members.length }}</span></h3><p>查看成员账号与使用状态，管理本企业协作权限。</p></div>
        <el-button :disabled="busy || !!pending" @click="refresh">刷新成员列表</el-button>
      </div>
      <div class="member-table-heading" aria-hidden="true">
        <span>成员</span><span>登录邮箱</span><span>角色</span><span>状态</span><span>操作</span>
      </div>
      <article v-for="member in members" :key="member.id" class="member-row">
        <div class="member-identity">
          <span class="member-avatar" aria-hidden="true">{{ (member.name || '首').slice(0, 1) }}</span>
          <h4>{{ member.name || '首位管理员' }}<small v-if="member.id === currentAccountId">本人</small></h4>
        </div>
        <p class="member-email">{{ member.email }}</p>
        <span class="member-role">{{ member.role === 'admin' ? '终端企业管理员' : '业务员' }}</span>
        <span class="member-status" :class="{ 'is-inactive': !member.active }">{{ member.active ? '启用' : '停用' }}</span>
        <div class="member-actions">
          <el-button
            v-if="member.id !== currentAccountId"
            :aria-label="`重置 ${member.email} 密码`"
            :disabled="busy || !!pending"
            @click="resetMember(member.id)"
          >重置密码</el-button>
          <el-button
            v-if="member.canDisable"
            class="member-disable"
            :aria-label="`停用 ${member.email}`"
            :disabled="busy || !!pending"
            @click="disableMember(member.id)"
          >停用</el-button>
          <span v-if="member.id === currentAccountId" class="member-protected">当前账号</span>
        </div>
      </article>
    </div>
    </template>
    <div v-else class="page-heading">
      <h2>成员管理</h2>
      <p>仅本企业管理员可查看和管理成员，请联系企业管理员。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useSessionStore } from '../../stores/session';
import { useFormLeave } from '../../router/formLeave';
import { HttpError } from '../../api/http';
import { membersApi, type Credentials, type Member } from '../../api/members';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
defineOptions({ name: 'MemberManagement' });
const props = defineProps<{ request: (path: string, body?: Record<string, string>) => Promise<unknown> }>();
const auth = useSessionStore();
const api = membersApi(props.request);
const currentAccountId = auth.session?.id;
const pending = shallowRef<{ action: 'create' | 'reset' | 'disable'; body: Record<string, string> } | null>(null);
const members = shallowRef<Member[]>([]);
const credentials = shallowRef<Credentials | null>(null);
const credentialAction = ref<'create' | 'reset'>('create');
const name = ref('');
const email = ref('');
const role = ref('sales');
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const copying = ref(false);
const copyMessage = ref('');
const error = ref('');
async function refresh() {
  try {
    const result = await api.list();
    members.value = result.members;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '成员列表加载失败';
  }
}
async function createMember() {
  if (busy.value || credentials.value || pending.value) return;
  error.value = '';
  if (!name.value.trim()) {
    error.value = '请填写成员姓名';
    return;
  }
  busy.value = true;
  try {
    credentialAction.value = 'create';
    pending.value = {
      action: 'create',
      body: {
        name: name.value,
        email: email.value,
        role: role.value,
        requestId: requestId.value
      }
    };
    credentials.value = await api.create(pending.value.body);
    pending.value = null;
    await refresh();
  } catch (failure) {
    if (failure instanceof HttpError && failure.status < 500) pending.value = null;
    error.value = failure instanceof Error ? failure.message : '网络异常，请核实原请求';
  } finally {
    busy.value = false;
  }
}
async function copyCredentials() {
  if (!credentials.value || copying.value) return;
  copying.value = true;
  try {
    await navigator.clipboard.writeText(`登录邮箱：${credentials.value.email}\n临时密码：${credentials.value.temporaryPassword}`);
    copyMessage.value = '账号信息已复制';
  } catch {
    copyMessage.value = '复制失败，可重试复制或手动保存；成员已创建，无需重复创建。';
  } finally {
    copying.value = false;
  }
}
function closeCredentials() {
  credentials.value = null;
  copyMessage.value = '';
  name.value = '';
  email.value = '';
  requestId.value = crypto.randomUUID();
}
async function resetMember(accountId: string) {
  if (busy.value || credentials.value || pending.value) return;
  busy.value = true;
  error.value = '';
  try {
    pending.value = { action: 'reset', body: { accountId, requestId: crypto.randomUUID() } };
    const result = await api.reset(pending.value.body);
    pending.value = null;
    credentialAction.value = 'reset';
    credentials.value = result;
  } catch (failure) {
    if (failure instanceof HttpError && failure.status < 500) pending.value = null;
    error.value = failure instanceof Error ? failure.message : '重置结果不确定，请先核实账号状态，再决定是否再次重置';
  } finally {
    busy.value = false;
  }
}
async function disableMember(accountId: string) {
  if (busy.value || credentials.value || pending.value) return;
  busy.value = true;
  error.value = '';
  try {
    pending.value = { action: 'disable', body: { accountId } };
    await api.disable(pending.value.body);
    pending.value = null;
    await refresh();
  } catch (failure) {
    if (failure instanceof HttpError && failure.status < 500) pending.value = null;
    error.value = failure instanceof Error ? failure.message : '停用失败，请重试';
  } finally {
    busy.value = false;
  }
}
async function verifyPending() {
  if (busy.value || !pending.value) return;
  const operation = pending.value;
  busy.value = true;
  error.value = '';
  try {
    if (operation.action === 'disable') await api.disable(operation.body);
    else {
      credentialAction.value = operation.action;
      credentials.value = await api[operation.action](operation.body);
    }
    pending.value = null;
    await refresh();
  } catch (failure) {
    if (failure instanceof HttpError && failure.status < 500) {
      pending.value = null;
      if (operation.action === 'create' && failure.status === 409) closeCredentials();
      await refresh();
    }
    error.value = failure instanceof Error ? failure.message : '结果仍未确认，请稍后核实原请求';
  } finally {
    busy.value = false;
  }
}
useFormLeave({
  state: () => {
    if (busy.value) return 'submitting';
    if (pending.value) return 'unknown';
    if (credentials.value || name.value || email.value || role.value !== 'sales') return 'dirty';
    return 'clean';
  },
  discard: () => { closeCredentials(); role.value = 'sales'; },
  retainUnknown: true,
  message: '成员信息或临时凭据尚未保存。确定放弃并离开吗？取消将继续处理。'
});
onMounted(() => { if (auth.session?.role === 'admin') void refresh(); });
</script>

<style scoped>
.member-section {
  --member-accent: #4356e0;
  --member-line: #e6e9f0;
  --member-muted: #738095;
  color: #1c2333;
  padding: 4px 0 24px;
}
.page-heading { margin: 0 0 24px; }
.page-heading h2 { margin: 0 0 8px; font-size: 24px; font-weight: 650; letter-spacing: -.5px; }
.page-heading p, .card-heading p, .list-heading p { margin: 0; color: var(--member-muted); font-size: 13px; line-height: 1.7; }
.member-section .identity-card, .member-section .workspace-card {
  width: 100%;
  max-width: none;
  margin: 0 0 22px;
  padding: 24px;
  border: 1px solid var(--member-line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 3px 14px #1c233303;
}
.card-heading { margin-bottom: 22px; }
.card-heading h3, .list-heading h3, .credential-card h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
.member-fields { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 20px; }
.member-fields :deep(.el-form-item) { min-width: 0; margin-bottom: 22px; }
.member-fields :deep(.el-form-item__label) { color: #46516a; font-size: 13px; }
.member-fields :deep(.el-input__wrapper) { min-height: 40px; border-radius: 7px; box-shadow: 0 0 0 1px var(--member-line) inset; }
.member-fields :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--member-accent) inset; }
select { width: 100%; min-height: 40px; padding: 0 12px; border: 1px solid var(--member-line); border-radius: 7px; background: #fff; color: #1c2333; font: inherit; }
select:focus-visible { outline: 2px solid #4356e040; outline-offset: 2px; border-color: var(--member-accent); }
.member-section :deep(.el-button) { min-height: 36px; padding: 8px 14px; border-radius: 7px; font-weight: 500; }
.member-section :deep(.member-primary) { width: fit-content; min-height: 40px; padding-inline: 20px; border-color: var(--member-accent); background: var(--member-accent); color: #fff; }
.member-section :deep(.member-primary:hover:not(:disabled)) { background: #3547cc; }
.member-section :deep(.member-primary:disabled) { opacity: .5; }
.list-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.member-count { display: inline-block; min-width: 24px; margin-left: 6px; padding: 1px 7px; border-radius: 5px; background: #eff1ff; color: var(--member-accent); font-size: 12px; text-align: center; vertical-align: middle; }
.member-table-heading, .member-row { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(180px, 1.5fr) minmax(125px, .9fr) 64px 170px; align-items: center; gap: 16px; }
.member-table-heading { padding: 12px 16px; border-radius: 7px; background: #f6f7fb; color: var(--member-muted); font-size: 12px; }
.member-row { min-height: 78px; padding: 16px; border-bottom: 1px solid var(--member-line); font-size: 13px; }
.member-row:last-child { border-bottom: 0; }
.member-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.member-avatar { display: grid; flex: 0 0 34px; height: 34px; place-items: center; border-radius: 9px; background: #eef0fd; color: var(--member-accent); font-size: 14px; font-weight: 600; }
.member-identity h4 { margin: 0; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.member-identity small { display: block; margin-top: 3px; color: var(--member-muted); font-size: 11px; font-weight: 400; }
.member-email { margin: 0; color: #536078; overflow-wrap: anywhere; }
.member-role { color: #536078; }
.member-status { justify-self: start; padding: 3px 9px; border-radius: 5px; background: #eaf7f0; color: #16885e; font-size: 12px; white-space: nowrap; }
.member-status.is-inactive { background: #f0f1f4; color: #8891a2; }
.member-actions { display: flex; align-items: center; gap: 8px; }
.member-actions :deep(.el-button) { margin: 0; min-height: 30px; padding: 5px 10px; font-size: 12px; }
.member-actions :deep(.member-disable:not(:disabled)) { border-color: #f1d7d7; color: #d14646; }
.member-protected { color: #97a0b0; font-size: 12px; }
.handoff-values { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 16px; padding: 20px; border: 1px solid #e1e5fd; border-radius: 8px; background: #f7f8ff; overflow-wrap: anywhere; }
.handoff-values dt { color: var(--member-muted); font-size: 13px; }
.handoff-values dd { margin: 0; font-family: Consolas, monospace; }
.credential-card > p { color: var(--member-muted); font-size: 13px; line-height: 1.7; }
.member-section > :deep(.el-alert) { margin-bottom: 16px; }
@media (max-width: 1100px) {
  .member-fields { grid-template-columns: 1fr 1fr; }
  .member-table-heading { display: none; }
  .member-row { grid-template-columns: minmax(0, 1fr) auto; gap: 10px 16px; }
  .member-email { grid-column: 1; }
  .member-role { grid-column: 1; }
  .member-status { grid-column: 2; grid-row: 1; justify-self: end; }
  .member-actions { grid-column: 2; grid-row: 2 / 4; justify-content: flex-end; flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .member-section .identity-card, .member-section .workspace-card { padding: 18px 16px; }
  .member-fields { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .member-form :deep(.member-primary) { width: 100%; }
  .list-heading { align-items: flex-start; }
  .list-heading p { max-width: 190px; }
  .list-heading :deep(.el-button) { flex-shrink: 0; padding-inline: 10px; }
  .member-row { padding: 16px 0; }
  .member-actions { grid-column: 1 / -1; grid-row: auto; justify-content: flex-start; }
  .handoff-values { grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 16px; }
  .handoff-values dd { margin-bottom: 8px; }
  .credential-card :deep(.el-button) { margin: 6px 8px 0 0; }
}
</style>
