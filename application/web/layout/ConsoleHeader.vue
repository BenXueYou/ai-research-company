<script setup lang="ts">
import { ElButton } from 'element-plus';
import { defaultPath } from '../router';
import type { Session } from '../stores/session';

defineProps<{ session: Session | null; busy: boolean }>();
const emit = defineEmits<{ settings: []; logout: [] }>();
</script>

<template>
  <header class="top-bar">
    <RouterLink class="brand" :to="session ? defaultPath(session.role) : '/'">◈ <span>智能获客</span><small>账号中心</small></RouterLink>
    <nav v-if="session" aria-label="账号导航">
      <span class="account-email">{{ session.loginName }}</span>
      <el-button v-if="!session.mustChange" class="quiet-button" @click="emit('settings')">账号设置</el-button>
      <el-button class="quiet-button" :disabled="busy" @click="emit('logout')">退出登录</el-button>
    </nav>
  </header>
</template>
