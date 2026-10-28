<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { defaultPath } from '../router';
import type { Session } from '../stores/session';
const props = defineProps<{ session: Session }>();
const route = useRoute();
const router = useRouter();
const expanded = reactive<Record<string, boolean>>({});
const menu = computed(() => router.getRoutes().filter(item =>
  item.meta.navigation && item.meta.roles?.includes(props.session.role as 'platform' | 'distributor' | 'admin' | 'sales')
).sort((a, b) =>
  a.meta.navigation!.order - b.meta.navigation!.order
));
const groups = computed(() => {
  const result: { label: string; path?: string; children: { label: string; path: string }[] }[] = [];
  for (const item of menu.value) {
    const metadata = item.meta.navigation!;
    if (!metadata.group) result.push({ label: metadata.label, path: item.path, children: [] });
    else {
      let group = result.find(entry =>
        entry.label === metadata.group
      );
      if (!group) {
        group = { label: metadata.group, children: [] };
        result.push(group);
      }
      group.children.push({ label: metadata.label, path: item.path });
    }
  }
  return result;
});
const activePath = computed(() => route.path === '/platform/organizations/business-data' ? '/platform/organizations' : route.path);
watch(() => route.fullPath, () => {
  const current = menu.value.find(item =>
    item.path === activePath.value
  )?.meta.navigation;
  if (current?.group) expanded[current.group] = true;
}, { immediate: true });
</script>
<template>
  <div class="workspace-sidebar">
    <RouterLink class="workspace-brand" :to="defaultPath(session.role)">◈ <strong>智能获客</strong><small>SMART ACQUISITION</small></RouterLink>
    <nav class="sidebar-scroll console-scroll" aria-label="主菜单">
      <p class="sidebar-group">工作台</p>
      <template v-for="(item, index) in groups" :key="item.label">
        <RouterLink
          v-if="item.path"
          class="sidebar-link"
          :class="{ active: activePath === item.path }"
          :to="item.path"
          :aria-current="activePath === item.path ? 'page' : undefined"
        >{{ item.label }}</RouterLink>
        <template v-else>
          <button
            type="button"
            class="sidebar-link sidebar-parent"
            :aria-expanded="!!expanded[item.label]"
            :aria-controls="`sidebar-group-${index}`"
            @click="expanded[item.label] = !expanded[item.label]"
          ><span>{{ item.label }}</span><span aria-hidden="true">{{ expanded[item.label] ? '⌄' : '›' }}</span></button>
          <div :id="`sidebar-group-${index}`" v-show="expanded[item.label]">
            <RouterLink
              v-for="child in item.children"
              :key="child.path"
              class="sidebar-link sidebar-child"
              :class="{ active: activePath === child.path }"
              :to="child.path"
              :aria-current="activePath === child.path ? 'page' : undefined"
              >{{ child.label }}</RouterLink>
          </div>
        </template>
      </template>
    </nav>
  </div>
</template>
