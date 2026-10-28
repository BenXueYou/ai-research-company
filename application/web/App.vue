<template>
  <ConsoleFrame :workspace="!!session && !session.mustChange" :generation="generation">
    <template #header="{ sidebarOpen, toggleSidebar }">
    <ConsoleHeader
      :session="session"
      :busy="busy"
      @settings="openSettings"
      @logout="logout"
    >
      <template v-if="session && !session.mustChange" #navigation>
        <button
          type="button"
          class="sidebar-toggle"
          aria-controls="console-sidebar"
          :aria-expanded="sidebarOpen"
          :aria-label="sidebarOpen ? '收起菜单' : '展开菜单'"
          @click="toggleSidebar"
        ><span aria-hidden="true">☰</span><span class="sidebar-toggle-label">{{ sidebarOpen ? '收起菜单' : '展开菜单' }}</span></button>
        <ConsoleBreadcrumb />
      </template>
    </ConsoleHeader>
    </template>
    <template #sidebar>
      <ConsoleSidebar v-if="session && !session.mustChange" :session="session" />
    </template>
      <p v-if="loading" role="status">正在验证会话…</p>
      <template v-else>
        <section v-if="sessionStatus === 'error'" class="identity-layout">
          <p role="alert">会话读取失败：{{ sessionLoadError }}</p>
          <el-button @click="retrySession">重试</el-button>
        </section>
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
        <LoginPage
          v-if="!session"
          v-model:email="email"
          v-model:login-password="loginPassword"
          :busy="busy"
          @submit="login"
        />
        <section v-else-if="session.mustChange || path === '/account/settings'" class="password-layout">
          <div class="page-heading">
            <h1 v-if="session.mustChange">先保护好您的账号</h1>
            <p>{{ session.mustChange ? '当前使用临时凭据，完成改密前无法访问工作台。' : '更新密码后，所有设备将退出登录。' }}</p>
          </div>
          <el-form class="identity-card" label-position="top" @submit.prevent="changePassword">
            <h2>{{ session.mustChange ? '设置新密码' : '更新登录密码' }}</h2>
            <p v-if="passwordResultUnknown" class="error-message">改密结果尚未确认，请重新登录核实，勿重复提交。</p>
            <p class="hint">12～128位英文、数字或常见符号，不允许空格；不得与当前密码相同。</p>
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
            <el-button class="primary-button" native-type="submit" :disabled="busy || passwordResultUnknown">{{ busy ? '正在更新…' : '确认修改并重新登录' }}</el-button>
            <el-button v-if="!session.mustChange" native-type="button" :disabled="busy" @click="closeSettings">返回工作台</el-button>
          </el-form>
        </section>
        <RouterView v-if="session && !session.mustChange" v-slot="{ Component }">
          <KeepAlive :key="generation" include="ReconciliationPage,PlatformPointOrdersPage,PlatformProcurement,PlatformSettingsPage,PlatformOrganizationsPage,UMailResourceSettings,PlatformEmailQuota">
            <component
              :is="Component"
              :request="request"
              :role="session.role"
              @navigate="navigate"
            />
          </KeepAlive>
        </RouterView>
        <CompatWorkspace
          v-if="session && !session.mustChange && workspaceVisited"
          v-show="isCompatPath"
          :session="session"
          :request="request"
          :title="currentTitle"
        />
        </template>
      </template>
    <footer>安全会话 · 最长8小时 / 空闲30分钟自动失效</footer>
  </ConsoleFrame>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { defaultPath, isBusinessPath, navigation } from './router';
import { useSessionStore } from './stores/session';
import { provideFormLeave } from './router/formLeave';
import ConsoleHeader from './layout/ConsoleHeader.vue';
import ConsoleFrame from './layout/ConsoleFrame.vue';
import ConsoleBreadcrumb from './layout/ConsoleBreadcrumb.vue';
import { provideBreadcrumbTitle } from './layout/breadcrumb';
import ConsoleSidebar from './layout/ConsoleSidebar.vue';
import CompatWorkspace from './layout/CompatWorkspace.vue';
import LoginPage from './pages/login/LoginPage.vue';
import { useLogin } from './pages/login/useLogin';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
provideBreadcrumbTitle();
const router = useRouter();
const route = useRoute();
const auth = useSessionStore();
const { session, status: sessionStatus, loadError: sessionLoadError, generation } = storeToRefs(auth);
const loading = computed(() => sessionStatus.value === 'idle' || sessionStatus.value === 'loading');
const busy = ref(false);
const navigatingAfterLogin = ref(false);
const path = computed(() => route.path);
const previousPath = ref('/');
const workspaceVisited = ref(false);
const passwordResultUnknown = ref(false);
const error = ref('');
const notice = ref('');
const { email, loginPassword, login } = useLogin(run, navigatingAfterLogin);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const menu = computed(() =>
  navigation.filter(item => item.roles.includes(session.value?.role as 'platform' | 'distributor' | 'admin' | 'sales'))
);
const currentTitle = computed(() => route.meta.title ?? '工作台');
const isCompatPath = computed(() => menu.value.some(item =>
  item.path === path.value && !['/platform/overview', '/platform/reconciliation', '/platform/organizations', '/platform/ledger', '/platform/settings'].includes(item.path)
));
const formLeave = provideFormLeave(router, () =>
  !!session.value && !session.value.mustChange && !navigatingAfterLogin.value
);
formLeave.register({
  active: () => path.value === '/account/settings',
  state: () => {
    if (busy.value && path.value === '/account/settings') return 'submitting';
    if (passwordResultUnknown.value) return 'unknown';
    return currentPassword.value || newPassword.value || confirmPassword.value ? 'dirty' : 'clean';
  },
  discard: clearPasswords,
  retainUnknown: true
});
function navigate(next: string) {
  if (!session.value || session.value.mustChange) return;
  if (!router.resolve(next).matched.some(item => item.meta.roles && (item.meta.roles as string[]).includes(session.value?.role ?? ''))) return;
  if (next === '/account/settings' && path.value !== next) {
    previousPath.value = isBusinessPath(path.value, session.value.role) ? route.fullPath : defaultPath(session.value.role);
  }
  void router.push(next);
}
function clearPasswords() {
  loginPassword.value = '';
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
}
const request = auth.request;
async function retrySession() {
  await auth.initialize(true);
  if (session.value && !session.value.mustChange) {
    const allowed = route.meta.roles?.includes(session.value.role as 'platform' | 'distributor' | 'admin' | 'sales') === true;
    if (!allowed) await router.replace(defaultPath(session.value.role));
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
async function logout() {
  const commitLeave = formLeave.prepareLeave();
  if (!commitLeave) return;
  if (!window.dispatchEvent(new Event('organization-before-logout', { cancelable: true }))) return;
  await run(async () => {
    await request('auth/logout', {});
    commitLeave();
    auth.clear();
    notice.value = '您已安全退出';
  });
}
async function changePassword() {
  if (passwordResultUnknown.value) return;
  await run(async () => {
    if (!/^[\x21-\x7E]{12,128}$/.test(newPassword.value) || newPassword.value !== confirmPassword.value)
      throw new Error('新密码须为12～128位英文、数字或常见符号，且两次输入一致');
    try {
      await request('auth/password', {
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
        confirmPassword: confirmPassword.value
      });
    } catch (failure) {
      if (failure instanceof TypeError || failure instanceof SyntaxError) {
        passwordResultUnknown.value = true;
        throw new Error('改密结果尚未确认，请重新登录核实，勿重复提交。');
      }
      throw failure;
    }
    auth.clear();
    notice.value = '密码已更新，所有设备已退出。请使用新密码重新登录。';
  });
}
function openSettings() {
  if (path.value === '/account/settings' || busy.value || !session.value) return;
  previousPath.value = isBusinessPath(path.value, session.value.role) ? route.fullPath : defaultPath(session.value.role);
  clearPasswords();
  error.value = '';
  navigate('/account/settings');
}
function closeSettings() {
  if (!session.value) return;
  navigate(isBusinessPath(previousPath.value, session.value.role) ? previousPath.value : defaultPath(session.value.role));
}
watch(generation, () => {
  workspaceVisited.value = false;
  previousPath.value = '/';
  passwordResultUnknown.value = false;
  clearPasswords();
});
watch(path, (next, previous) => {
  if (previous === '/account/settings' && next !== previous) {
    clearPasswords();
    error.value = '';
  }
  if (session.value && isCompatPath.value) {
    workspaceVisited.value = true;

  }
}, { immediate: true });
watch(session, value => {
  if (value && isCompatPath.value) workspaceVisited.value = true;
});
</script>
