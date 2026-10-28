<script setup lang="ts">
import {
  nextTick,
  onMounted,
  onScopeDispose,
  ref,
  watch
} from 'vue';
import {
  ElAside,
  ElContainer,
  ElHeader,
  ElMain
} from 'element-plus';
import { useRoute } from 'vue-router';

const props = defineProps<{ workspace: boolean; generation: number }>();
const route = useRoute();
const narrow = ref(window.matchMedia('(max-width: 760px)').matches);
const sidebarOpen = ref(!narrow.value);
const aside = ref<HTMLElement>();
let returnFocus: HTMLElement | null = null;
const media = window.matchMedia('(max-width: 760px)');
function resize() {
  narrow.value = media.matches;
  sidebarOpen.value = !media.matches;
}
function closeSidebar() {
  sidebarOpen.value = false;
  if (narrow.value) void nextTick(() => returnFocus?.focus({ preventScroll: true }));
}
async function toggleSidebar() {
  returnFocus = document.activeElement as HTMLElement;
  sidebarOpen.value = !sidebarOpen.value;
  if (sidebarOpen.value && narrow.value) {
    await nextTick();
    aside.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
}
function onMenuClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a');
  if (narrow.value && link && link.pathname + link.search + link.hash === route.fullPath) closeSidebar();
}
function trapFocus(event: KeyboardEvent) {
  if (!narrow.value || !sidebarOpen.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSidebar();
  }
  if (event.key !== 'Tab') return;
  const focusable = Array.from(aside.value?.querySelectorAll<HTMLElement>('a[href], button') ?? []).filter(item =>
    item.getClientRects().length > 0
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
watch(() => route.fullPath, () => {
  if (narrow.value && sidebarOpen.value) closeSidebar();
});
watch(() => props.generation, () => { sidebarOpen.value = !narrow.value; });
onMounted(() => media.addEventListener('change', resize));
onScopeDispose(() => media.removeEventListener('change', resize));
</script>

<template>
  <el-container class="app-shell" :class="{ 'workspace-mode': workspace }">
    <el-aside
      v-if="workspace"
      v-show="sidebarOpen"
      class="console-aside"
      width="224px"
    >
      <div
        id="console-sidebar"
        ref="aside"
        class="sidebar-panel"
        :role="narrow ? 'dialog' : undefined"
        :aria-modal="narrow ? true : undefined"
        aria-label="工作台导航"
        @keydown="trapFocus"
        @click="onMenuClick"
      >
        <button
          v-if="narrow"
          class="sidebar-close"
          type="button"
          @click="closeSidebar"
        >关闭菜单</button>
        <slot name="sidebar" />
      </div>
    </el-aside>
    <button
      v-if="workspace && narrow && sidebarOpen"
      class="sidebar-backdrop"
      aria-label="关闭菜单"
      tabindex="-1"
      @click="closeSidebar"
    />
    <el-container class="console-column" direction="vertical" :inert="workspace && narrow && sidebarOpen">
      <el-header class="console-header" height="auto">
        <slot
          name="header"
          :sidebar-open="sidebarOpen"
          :toggle-sidebar="toggleSidebar"
        />
      </el-header>
      <el-main id="console-main" class="console-main" tabindex="-1">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>
