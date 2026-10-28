<template>
  <section class="organization-section">
    <div class="page-heading">
      <p class="eyebrow">直属组织 / 管理员交付</p>
      <h2>下级管理</h2>
      <p>直属上级：{{ parentName }}。开户后上级固定，最多两级分销。</p>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <section v-if="credentials" class="identity-card" aria-label="开户凭据">
      <h2>{{ credentialAction === 'reset' ? '管理员密码重置成功' : '开户成功' }}</h2>
      <p>请在关闭前交付凭据。临时密码有效期72小时，首次登录必须改密。</p>
      <dl class="handoff-values">
        <dt>登录邮箱</dt><dd data-testid="handoff-email">{{ credentials.email }}</dd>
        <dt>临时密码</dt><dd data-testid="handoff-password">{{ credentials.temporaryPassword }}</dd>
        <dt>有效期至</dt><dd>{{ new Date(credentials.expiresAt).toLocaleString() }}</dd>
      </dl>
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
      <el-button class="primary-button" :disabled="copying" @click="copyCredentials">一键复制账号信息</el-button>
      <el-button @click="closeCredentials">已保存，关闭凭据</el-button>
      <p class="hint">关闭后无法查询本次密码；需要补发时请再次重置。</p>
    </section>
    <el-form
      v-else
      class="identity-card opening-form"
      label-position="top"
      @submit.prevent="openOrganization"
    >
      <h3>开户（直属下级）</h3>
      <el-form-item label="组织名称" for="organization-name">
        <el-input
          id="organization-name"
          v-model="name"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="组织类型" for="organization-kind">
        <select
          id="organization-kind"
          v-model="kind"
          required
          :disabled="busy"
        >
          <option value="terminal">终端企业</option>
          <option v-if="allowedKinds.includes('distributor')" value="distributor">分销组织</option>
        </select>
      </el-form-item>
      <el-form-item label="国家区号" for="country-code">
        <el-input
          id="country-code"
          v-model="countryCode"
          list="country-codes"
          required
          :disabled="busy"
        />
        <datalist id="country-codes">
          <option value="+86">中国大陆</option>
          <option value="+852">中国香港</option>
          <option value="+853">中国澳门</option>
          <option value="+886">中国台湾</option>
          <option value="+1">美国 / 加拿大</option>
          <option value="+44">英国</option>
          <option value="+65">新加坡</option>
        </datalist>
        <p class="hint">默认中国大陆 +86；可选择或输入其他国家区号。</p>
      </el-form-item>
      <el-form-item label="电话号码" for="organization-phone">
        <el-input
          id="organization-phone"
          v-model="phone"
          type="tel"
          required
          :disabled="busy"
        />
        <p class="hint">不能包含空格；不同组织不能使用相同电话。</p>
      </el-form-item>
      <el-form-item label="管理员邮箱（登录账号）" for="administrator-email">
        <el-input
          id="administrator-email"
          v-model="email"
          type="email"
          autocomplete="off"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-button
        class="primary-button"
        native-type="submit"
        :disabled="busy || !allowedKinds.length"
      >{{ busy ? '正在开户…' : '确认开户' }}</el-button>
      <p class="hint">组织与首位管理员同时启用；系统生成临时密码。</p>
    </el-form>
    <div class="workspace-card children-list">
      <h3>直属下级</h3>
      <el-button :disabled="busy" @click="refresh">刷新列表</el-button>
      <p v-if="!children.length">暂无直属下级</p>
      <article v-for="child in children" :key="child.id" class="child-row">
        <h4>{{ child.name }}</h4>
        <p>{{ child.kind === 'terminal' ? '终端企业' : `${child.distributorLevel}级分销` }} · {{ child.active ? '启用' : '停用' }}</p>
        <p>联系号码：{{ child.phoneMasked }} · 管理员：{{ child.email }}</p>
        <details>
          <summary>下级详情</summary>
          <p>组织：{{ child.name }} · 管理员登录邮箱：{{ child.email }}</p>
          <el-button :disabled="busy || !!credentials" @click="resetAdministrator(child.accountId)">重置管理员密码</el-button>
          <el-button :disabled="busy" @click="setActive(child)">{{ child.active ? '停用组织' : '恢复组织' }}</el-button>
          <p class="hint">停用保留余额和历史；已收款未划拨订单暂停且保留预留。在途查询与邮件继续核对，未执行邮件暂停。</p>
        </details>
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
interface Credentials {
  email: string;
  temporaryPassword: string;
  expiresAt: string;
}
interface Child {
  id: string;
  accountId: string;
  name: string;
  kind: string;
  distributorLevel: number;
  active: boolean;
  phoneMasked: string;
  email: string;
}
const props = defineProps<{
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const parentName = ref('');
const allowedKinds = shallowRef<string[]>([]);
const children = shallowRef<Child[]>([]);
const credentials = shallowRef<Credentials | null>(null);
const credentialAction = ref<'open' | 'reset'>('open');
const name = ref('');
const kind = ref('terminal');
const countryCode = ref('+86');
const phone = ref('');
const email = ref('');
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const copying = ref(false);
const error = ref('');
const copyMessage = ref('');
async function refresh() {
  try {
    const result = await props.request('organizations') as { parentName: string; allowedKinds: string[]; children: Child[] };
    parentName.value = result.parentName;
    allowedKinds.value = result.allowedKinds;
    children.value = result.children;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '列表加载失败，可重试刷新';
  }
}
async function openOrganization() {
  if (busy.value || credentials.value) return;
  error.value = '';
  if (!name.value.trim() || !phone.value || /\s/u.test(phone.value)) {
    error.value = '组织名称、电话号码必填，电话号码不能包含空格';
    return;
  }
  if (!/^\+[1-9][0-9]{0,2}$/.test(countryCode.value)) {
    error.value = '请填写有效国家区号，例如 +86';
    return;
  }
  busy.value = true;
  try {
    credentialAction.value = 'open';
    credentials.value = await props.request('organizations', {
      name: name.value,
      kind: kind.value,
      countryCode: countryCode.value,
      phone: phone.value,
      email: email.value,
      requestId: requestId.value
    }) as Credentials;
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '网络异常；可重试本次请求，或刷新列表核实开户结果';
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
    copyMessage.value = '复制失败，可再次点击复制或手动保存；开户已成功，无需重新开户。';
  } finally {
    copying.value = false;
  }
}
function closeCredentials() {
  credentials.value = null;
  copyMessage.value = '';
  name.value = '';
  phone.value = '';
  email.value = '';
  requestId.value = crypto.randomUUID();
}
async function resetAdministrator(accountId: string) {
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
async function setActive(child: Child) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('organizations/state', { organizationId: child.id, active: !child.active });
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '组织状态调整失败，请刷新核对';
  } finally {
    busy.value = false;
  }
}
onMounted(refresh);
</script>

<style scoped>
.organization-section { margin-top: 32px; }
.opening-form { max-width: 640px; }
select { width: 100%; padding: 12px; border: 1px solid #dcdfe6; border-radius: 8px; color: #263052; background: white; }
.children-list { margin-top: 24px; }
.child-row { border-top: 1px solid #e5e7f1; margin-top: 16px; overflow-wrap: anywhere; }
.handoff-values { overflow-wrap: anywhere; }
.handoff-values dd { margin: 8px 0 20px; font-family: monospace; }
</style>
