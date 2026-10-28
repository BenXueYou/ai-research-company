<template>
  <div class="app-shell" :class="{ 'workspace-mode': session && !session.mustChange }">
    <ConsoleHeader
      :session="session"
      :busy="busy"
      @settings="openSettings"
      @logout="logout"
    />
    <ConsoleSidebar v-if="session && !session.mustChange" :session="session" />
    <main>
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
        <section v-else-if="session.mustChange || path === '/account/settings'" class="password-layout">
          <div class="page-heading">
            <p class="eyebrow">账号设置 / 修改密码</p>
            <h1>{{ session.mustChange ? '先保护好您的账号' : '修改本人密码' }}</h1>
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
          <KeepAlive include="ReconciliationPage">
            <component
              :is="Component"
              :request="request"
              :role="session.role"
              :confirm-leave="confirmLeave"
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
    </main>
    <footer>安全会话 · 最长8小时 / 空闲30分钟自动失效</footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { defaultPath, isBusinessPath, navigation } from './router';
import { useSessionStore } from './stores/session';
import ConsoleHeader from './layout/ConsoleHeader.vue';
import ConsoleSidebar from './layout/ConsoleSidebar.vue';
import CompatWorkspace from './layout/CompatWorkspace.vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
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
const email = ref('');
const loginPassword = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const menu = computed(() =>
  navigation.filter(item => item.roles.includes(session.value?.role as 'platform' | 'distributor' | 'admin' | 'sales'))
);
const currentTitle = computed(() => route.meta.title ?? '工作台');
const isCompatPath = computed(() => menu.value.some(item =>
  item.path === path.value && item.path !== '/platform/reconciliation'
));
function confirmLeave() {
  if (navigatingAfterLogin.value) return true;
  if (!session.value || session.value.mustChange) return true;
  if (busy.value) return false;
  if (path.value !== '/account/settings' || !(currentPassword.value || newPassword.value || confirmPassword.value)) return true;
  return window.confirm('您有未提交的修改。确定放弃并离开吗？取消将继续编辑。');
}
function navigate(next: string) {
  if (!session.value || session.value.mustChange) return;
  if (!router.resolve(next).matched.some(item => item.meta.roles && (item.meta.roles as string[]).includes(session.value?.role ?? ''))) return;
  if (next === '/account/settings' && path.value !== next) {
    previousPath.value = isBusinessPath(path.value, session.value.role) ? path.value : defaultPath(session.value.role);
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
async function login() {
  await run(async () => {
    try {
      await auth.login(email.value, loginPassword.value);
      if (session.value && !session.value.mustChange) {
        navigatingAfterLogin.value = true;
        try {
          await router.replace(defaultPath(session.value.role));
        } finally {
          navigatingAfterLogin.value = false;
        }
      }
    } finally {
      loginPassword.value = '';
    }
  });
}
async function logout() {
  if (!confirmLeave()) return;
  await run(async () => {
    await request('auth/logout', {});
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
  previousPath.value = isBusinessPath(path.value, session.value.role) ? path.value : defaultPath(session.value.role);
  clearPasswords();
  error.value = '';
  navigate('/account/settings');
}
function closeSettings() {
  if (!session.value) return;
  navigate(isBusinessPath(previousPath.value, session.value.role) ? previousPath.value : defaultPath(session.value.role));
}
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (busy.value || (path.value === '/account/settings' && (currentPassword.value || newPassword.value || confirmPassword.value))) {
    event.preventDefault();
  }
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
    void nextTick(() => {
      const target = menu.value.find(item => item.path === next)?.target;
      if (target) document.getElementById(target)?.scrollIntoView();
    });
  }
}, { immediate: true });
watch(session, value => {
  if (value && isCompatPath.value) workspaceVisited.value = true;
});
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload);
});
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
});
</script>
