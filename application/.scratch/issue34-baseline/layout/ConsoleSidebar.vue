<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { defaultPath, navigation } from '../router';
import type { Session } from '../stores/session';

const props = defineProps<{ session: Session }>();
const route = useRoute();
const menu = computed(() => navigation.filter(item =>
  item.roles.includes(props.session.role as 'platform' | 'distributor' | 'admin' | 'sales')
));
const active = (value: string) => route.path === value ||
  (value === '/platform/reconciliation' && route.path === '/platform/reconciliation/upstream') ||
  (value === '/platform/ledger' && route.path.startsWith('/platform/ledger/')) ||
  (value === '/platform/settings' && route.path.startsWith('/platform/settings/'));
</script>

<template>
  <aside class="workspace-sidebar" aria-label="工作台导航">
    <RouterLink class="workspace-brand" :to="defaultPath(session.role)">◈ <strong>智能获客</strong><small>SMART ACQUISITION</small></RouterLink>
    <p class="sidebar-group">工作台</p>
    <RouterLink
      v-for="item in menu"
      :key="item.path"
      class="sidebar-link"
      :class="{ active: active(item.path) }"
      :to="item.path"
      :aria-current="active(item.path) ? 'page' : undefined"
    ><span>{{ item.label }}</span></RouterLink>
    <RouterLink
      class="sidebar-link"
      :class="{ active: route.path === '/help', 'sidebar-help': session.role !== 'platform' }"
      to="/help"
      :aria-current="route.path === '/help' ? 'page' : undefined"
    >帮助中心</RouterLink>
  </aside>
</template>
