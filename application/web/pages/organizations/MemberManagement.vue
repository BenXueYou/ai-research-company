<template>
  <section class="member-section">
    <div class="page-heading">
      <p class="eyebrow">团队 / 账号交付</p>
      <h2>成员管理</h2>
      <p>管理本企业成员。停用保留历史，本人和首位管理员不可停用。</p>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <section v-if="credentials" class="identity-card" aria-label="成员凭据">
      <h3>{{ credentialAction === 'reset' ? '成员密码重置成功' : '成员创建成功' }}</h3>
      <p>临时密码有效期72小时，首次登录必须改密。关闭后无法查询原密码。</p>
      <dl class="handoff-values">
        <dt>登录邮箱</dt><dd data-testid="member-email">{{ credentials.email }}</dd>
        <dt>临时密码</dt><dd data-testid="member-password">{{ credentials.temporaryPassword }}</dd>
        <dt>有效期至</dt><dd>{{ new Date(credentials.expiresAt).toLocaleString() }}</dd>
      </dl>
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
      <el-button :disabled="copying" @click="copyCredentials">一键复制账号信息</el-button>
      <el-button @click="closeCredentials">已保存，关闭凭据</el-button>
    </section>
    <el-form
      v-else
      class="identity-card"
      label-position="top"
      @submit.prevent="createMember"
    >
      <h3>创建本企业成员</h3>
      <el-form-item label="成员姓名" for="member-name">
        <el-input
          id="member-name"
          v-model="name"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="成员登录邮箱" for="member-login">
        <el-input
          id="member-login"
          v-model="email"
          type="email"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="成员角色" for="member-role">
        <select
          id="member-role"
          v-model="role"
          required
          :disabled="busy"
        >
          <option value="sales">业务员</option>
          <option value="admin">终端企业管理员</option>
        </select>
      </el-form-item>
      <el-button native-type="submit" :disabled="busy">{{ busy ? '正在创建…' : '确认创建成员' }}</el-button>
    </el-form>
    <div class="workspace-card member-list">
      <h3>本企业成员</h3>
      <el-button :disabled="busy" @click="refresh">刷新成员列表</el-button>
      <article v-for="member in members" :key="member.id" class="member-row">
        <h4>{{ member.name || '首位管理员' }}</h4>
        <p>{{ member.email }} · {{ member.role === 'admin' ? '终端企业管理员' : '业务员' }} · {{ member.active ? '启用' : '停用' }}</p>
        <el-button
          v-if="member.id !== currentAccountId"
          :disabled="busy"
          @click="resetMember(member.id)"
        >重置 {{ member.email }} 密码</el-button>
        <el-button
          v-if="member.canDisable"
          :disabled="busy"
          @click="disableMember(member.id)"
        >停用 {{ member.email }}</el-button>
      </article>
    </div>
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
interface Credentials { email: string; temporaryPassword: string; expiresAt: string }
interface Member { id: string; name: string | null; email: string; role: string; active: boolean; canDisable: boolean }
const props = defineProps<{ request: (path: string, body?: Record<string, string>) => Promise<unknown>; currentAccountId: string }>();
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
    const result = await props.request('members') as { members: Member[] };
    members.value = result.members;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '成员列表加载失败';
  }
}
async function createMember() {
  if (busy.value || credentials.value) return;
  error.value = '';
  if (!name.value.trim()) {
    error.value = '请填写成员姓名';
    return;
  }
  busy.value = true;
  try {
    credentialAction.value = 'create';
    credentials.value = await props.request('members', {
      name: name.value,
      email: email.value,
      role: role.value,
      requestId: requestId.value
    }) as Credentials;
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '网络异常，可重试本次请求或刷新成员列表核实结果';
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
  if (busy.value || credentials.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.request('password-resets', { accountId, requestId: crypto.randomUUID() }) as Credentials;
    credentialAction.value = 'reset';
    credentials.value = result;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '重置结果不确定，请先核实账号状态，再决定是否再次重置';
  } finally {
    busy.value = false;
  }
}
async function disableMember(accountId: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('members/disable', { accountId });
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '停用失败，请重试';
  } finally {
    busy.value = false;
  }
}
onMounted(refresh);
</script>

<style scoped>
.member-section { margin-top: 32px; }
.member-list { margin-top: 24px; }
.member-row { border-top: 1px solid #e5e7f1; margin-top: 16px; overflow-wrap: anywhere; }
.handoff-values { overflow-wrap: anywhere; }
.handoff-values dd { margin: 8px 0 20px; font-family: monospace; }
select { width: 100%; padding: 12px; border: 1px solid #dcdfe6; border-radius: 8px; background: white; }
</style>
