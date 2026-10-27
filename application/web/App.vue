<template>
  <div class="app-shell">
    <header class="top-bar">
      <a class="brand" href="#">◈ <span>智能获客</span><small>账号中心</small></a>
      <nav v-if="session" aria-label="账号导航">
        <span class="account-email">{{ session.loginName }}</span>
        <el-button v-if="!session.mustChange" class="quiet-button" @click="openSettings">账号设置</el-button>
        <el-button class="quiet-button" :disabled="busy" @click="logout">退出登录</el-button>
      </nav>
    </header>
    <main>
      <p v-if="loading" role="status">正在验证会话…</p>
      <template v-else>
        <el-alert
          v-if="notice"
          class="notice"
          role="status"
          type="success"
          :title="notice"
          :closable="false"
        />
        <el-alert
          v-if="error"
          class="error-message"
          type="error"
          :title="error"
          :closable="false"
        />
        <section v-if="!session" class="identity-layout">
          <div class="intro-panel">
            <p class="eyebrow">安全访问 · 真实身份</p>
            <h1>从可信连接，<br>开启每一次机会。</h1>
            <p>使用平台账号或组织分配的登录邮箱访问工作空间。首次登录，请先设置属于自己的密码。</p>
            <div class="security-note">◇ 账号由授权管理员交付，不开放自助注册。</div>
          </div>
          <el-form class="identity-card" label-position="top" @submit.prevent="login">
            <p class="eyebrow">WELCOME BACK</p>
            <h2>登录工作空间</h2>
            <p class="hint">平台使用 super_admin，其他账号使用登录邮箱</p>
            <el-form-item label="登录账号" for="email">
              <el-input
                id="email"
                v-model="email"
                :type="email === 'super_admin' ? 'text' : 'email'"
                autocomplete="username"
                required
                :disabled="busy"
              />
            </el-form-item>
            <el-form-item label="密码" for="login-password">
              <el-input
                id="login-password"
                v-model="loginPassword"
                type="password"
                autocomplete="current-password"
                required
                :disabled="busy"
              />
            </el-form-item>
            <el-button class="primary-button" native-type="submit" :disabled="busy">{{ busy ? '正在登录…' : '登录' }}</el-button>
            <p class="hint">忘记密码？请联系授权管理员。临时密码有效期为72小时。</p>
          </el-form>
        </section>
        <section v-else-if="session.mustChange || settings" class="password-layout">
          <div class="page-heading">
            <p class="eyebrow">账号设置 / 修改密码</p>
            <h1>{{ session.mustChange ? '先保护好您的账号' : '修改本人密码' }}</h1>
            <p>{{ session.mustChange ? '当前使用临时凭据，完成改密前无法访问工作台。' : '更新密码后，所有设备将退出登录。' }}</p>
          </div>
          <el-form class="identity-card" label-position="top" @submit.prevent="changePassword">
            <h2>{{ session.mustChange ? '设置新密码' : '更新登录密码' }}</h2>
            <p class="hint">12～128个Unicode字符，允许空格；不要求字符组合，不得与当前密码相同。</p>
            <el-form-item label="当前密码" for="current-password">
              <el-input
                id="current-password"
                v-model="currentPassword"
                type="password"
                autocomplete="current-password"
                required
                :disabled="busy"
              />
            </el-form-item>
            <el-form-item label="新密码" for="new-password">
              <el-input
                id="new-password"
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                required
                :disabled="busy"
              />
            </el-form-item>
            <el-form-item label="确认新密码" for="confirm-password">
              <el-input
                id="confirm-password"
                v-model="confirmPassword"
                type="password"
                autocomplete="new-password"
                required
                :disabled="busy"
              />
            </el-form-item>
            <el-button class="primary-button" native-type="submit" :disabled="busy">{{ busy ? '正在更新…' : '确认修改并重新登录' }}</el-button>
            <el-button v-if="!session.mustChange" native-type="button" @click="closeSettings">返回工作台</el-button>
          </el-form>
        </section>
        <section v-else class="workspace">
          <div class="page-heading">
            <p class="eyebrow">WORKSPACE</p>
            <h1>工作台</h1>
            <p>欢迎回来，{{ session.loginName }}</p>
          </div>
          <div class="workspace-card">
            <span class="status-pill">身份验证已完成</span>
            <h2>您的安全工作空间已就绪</h2>
            <p>{{ workspaceMessage }}</p>
            <el-button class="primary-button" @click="openSettings">账号设置 → 修改密码</el-button>
          </div>
          <OrganizationOpening v-if="['platform', 'distributor'].includes(session.role)" :request="request" />
          <MemberManagement v-if="session.role === 'admin'" :request="request" />
          <PlatformProcurement v-if="session.role === 'platform'" :request="request" />
        </section>
      </template>
    </main>
    <footer>安全会话 · 最长8小时 / 空闲30分钟自动失效</footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import OrganizationOpening from './OrganizationOpening.vue';
import MemberManagement from './MemberManagement.vue';
import PlatformProcurement from './PlatformProcurement.vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
interface Session {
  email: string | null;
  loginName: string;
  role: string;
  mustChange: boolean;
}
const session = ref<Session | null>(null);
const loading = ref(true);
const busy = ref(false);
const settings = ref(false);
const error = ref('');
const notice = ref('');
const email = ref('');
const loginPassword = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const workspaceMessage = ref('');
function clearPasswords() {
  loginPassword.value = '';
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
}
async function request(path: string, body?: Record<string, string>) {
  const csrf = document.cookie.split('; ').find(item =>
    item.startsWith('identity_csrf=')
  )?.slice(14) ?? '';
  const response = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      session.value = null;
      clearPasswords();
    }
    throw new Error(typeof data.message === 'string' ? data.message : '请求失败，请稍后重试');
  }
  return data;
}
async function loadSession() {
  session.value = await request('auth/session') as Session;
  settings.value = false;
  if (!session.value.mustChange) {
    const workspace = await request('workspace');
    workspaceMessage.value = workspace.message as string;
  }
}
async function run(action: () => Promise<void>) {
  if (busy.value)
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '网络异常，请重试';
  } finally {
    busy.value = false;
  }
}
async function login() {
  await run(async () => {
    try {
      await request('auth/login', { email: email.value, password: loginPassword.value });
      await loadSession();
    } finally {
      loginPassword.value = '';
    }
  });
}
async function logout() {
  await run(async () => {
    await request('auth/logout', {});
    session.value = null;
    clearPasswords();
    notice.value = '您已安全退出';
  });
}
async function changePassword() {
  await run(async () => {
    const length = [...newPassword.value].length;
    if (length < 12 || length > 128 || newPassword.value !== confirmPassword.value)
      throw new Error('新密码须为12～128个Unicode字符，且两次输入一致');
    await request('auth/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      confirmPassword: confirmPassword.value
    });
    session.value = null;
    clearPasswords();
    notice.value = '密码已更新，所有设备已退出。请使用新密码重新登录。';
  });
}
function openSettings() {
  clearPasswords();
  error.value = '';
  settings.value = true;
}
function closeSettings() {
  clearPasswords();
  error.value = '';
  settings.value = false;
}
onMounted(async () => {
  try {
    await loadSession();
  } catch (failure) {
    if (!(failure instanceof Error) || failure.message !== '请重新登录')
      error.value = failure instanceof Error ? failure.message : '加载失败';
  } finally {
    loading.value = false;
  }
});
</script>
