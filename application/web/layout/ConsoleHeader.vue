<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import {
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  type DropdownInstance
} from 'element-plus';
import { useRoute } from 'vue-router';
import { defaultPath } from '../router';
import type { Session } from '../stores/session';

const props = defineProps<{ session: Session | null; busy: boolean }>();
const emit = defineEmits<{ settings: []; logout: [] }>();
const route = useRoute();
const dropdown = shallowRef<DropdownInstance>();
const expanded = shallowRef(false);
const avatar = computed(() => props.session?.loginName.slice(0, 1).toUpperCase());
const roleLabels: Record<string, string> = {
  platform: '平台管理员',
  distributor: '分销商',
  admin: '终端企业管理员',
  sales: '业务员'
};
const roleLabel = computed(() => roleLabels[props.session?.role ?? '']);

watch(() => [route.fullPath, props.session], () => dropdown.value?.handleClose());

function onCommand(command: string) {
  if (command === 'settings' && props.session && !props.session.mustChange) emit('settings');
  if (command === 'logout' && !props.busy) emit('logout');
}
</script>

<template>
  <header class="top-bar">
    <div class="header-location">
      <slot name="navigation">
        <RouterLink class="brand" :to="session ? defaultPath(session.role) : '/'">◈ <span>智能获客</span><small>账号中心</small></RouterLink>
      </slot>
    </div>
    <nav v-if="session" class="account-navigation" aria-label="账号导航">
      <RouterLink
        v-if="!session.mustChange"
        class="header-help"
        to="/help"
        :aria-current="route.path === '/help' ? 'page' : undefined"
      >
        <svg class="help-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01" />
        </svg>
        <span>帮助中心</span>
      </RouterLink>
      <el-dropdown
        ref="dropdown"
        trigger="click"
        placement="bottom-end"
        popper-class="account-popover"
        :teleported="false"
        :show-arrow="false"
        :show-timeout="0"
        :hide-timeout="0"
        @command="onCommand"
        @visible-change="expanded = $event"
      >
        <button
          type="button"
          class="account-trigger"
          :class="{ 'is-expanded': expanded }"
          :aria-label="`${session.loginName} 的账号菜单`"
          :aria-expanded="expanded"
        >
          <span class="account-avatar" aria-hidden="true">{{ avatar }}</span>
          <span class="account-name">{{ session.loginName }}</span>
          <svg class="account-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        <template #dropdown>
          <div class="account-identity">
            <span class="account-avatar account-avatar-large" aria-hidden="true">{{ avatar }}</span>
            <div class="account-identity-text">
              <strong>{{ session.loginName }}</strong>
              <span v-if="roleLabel" class="account-role">{{ roleLabel }}</span>
            </div>
          </div>
          <el-dropdown-menu class="account-menu">
            <el-dropdown-item v-if="!session.mustChange" command="settings" class="account-menu-item">
              <svg class="account-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></svg>
              <span>账号设置</span>
              <svg class="account-next" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            </el-dropdown-item>
            <el-dropdown-item
              command="logout"
              class="account-menu-item account-logout"
              :divided="!session.mustChange"
              :disabled="busy"
            >
              <svg class="account-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h10" /></svg>
              <span>退出登录</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </nav>
  </header>
</template>

<style scoped>
.account-navigation { display: flex; align-items: center; gap: 12px; min-width: 0; }
.header-help {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 6px 10px;
  border-radius: 8px;
  color: #66738b;
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
}
.header-help:hover, .header-help[aria-current='page'] { color: #4859db; background: #eef0ff; }
.header-help:focus-visible { outline: 2px solid #4859db; outline-offset: 2px; }
.help-icon {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.account-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  max-width: min(280px, calc(100vw - 60px));
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  color: #263052;
  background: transparent;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.account-trigger:hover, .account-trigger.is-expanded { background: #e9edf7; }
.account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-avatar {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #4859db;
  background: #eef0ff;
  font-size: 13px;
  font-weight: 600;
}
.account-avatar-large { width: 40px; height: 40px; font-size: 16px; }
.account-chevron, .account-next, .account-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: #66738b;
}
.account-chevron { width: 14px; height: 14px; transition: transform 120ms ease; }
.is-expanded .account-chevron { transform: rotate(180deg); }
.account-identity { display: flex; align-items: center; gap: 12px; padding: 20px 16px 17px; }
.account-identity-text { min-width: 0; }
.account-identity strong { display: block; color: #263052; font-size: 14px; overflow-wrap: anywhere; }
.account-role { display: block; margin-top: 4px; color: #66738b; font-size: 12px; }
.account-menu { border-top: 1px solid #e7ebf2; }
.account-navigation :deep(.account-popover) {
  width: min(264px, calc(100vw - 32px));
  border: 1px solid #e7ebf2;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 28px #25345520;
}
.account-navigation :deep(.el-scrollbar__view) { padding: 0; }
.account-navigation :deep(.account-menu) { padding: 7px; }
.account-navigation :deep(.account-menu-item) {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 7px;
  color: #263052;
  font-size: 13px;
  line-height: 20px;
}
.account-next { margin-left: auto; }
.account-navigation :deep(.account-menu-item:not(.is-disabled):hover),
.account-navigation :deep(.account-menu-item:not(.is-disabled):focus) { color: #263052; background: #f4f5fb; }
.account-navigation :deep(.account-logout:not(.is-disabled):hover),
.account-navigation :deep(.account-logout:not(.is-disabled):focus) { color: #b33b45; }
.account-navigation :deep(.account-logout:not(.is-disabled):hover .account-icon),
.account-navigation :deep(.account-logout:not(.is-disabled):focus .account-icon) { color: inherit; }
.account-navigation :deep(.account-menu-item.is-disabled) { color: #a8abb2; cursor: not-allowed; }
.account-navigation :deep(.account-menu-item.is-disabled .account-icon) { color: inherit; }
@media (prefers-reduced-motion: reduce) {
  .account-chevron { transition: none; }
}
@media (max-width: 760px) {
  .account-navigation { gap: 4px; }
  .header-help { padding: 6px; }
}
</style>
