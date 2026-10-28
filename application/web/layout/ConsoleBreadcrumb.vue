<script setup lang="ts">
import { computed } from 'vue';
import { ElBreadcrumb } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useBreadcrumbTitle } from './breadcrumb';

const route = useRoute();
const router = useRouter();
const auth = useSessionStore();
const objectTitle = useBreadcrumbTitle();
const crumbs = computed(() => {
  const items = (route.meta.breadcrumbs ?? [{ label: route.meta.title ?? '工作台' }]).map(item =>
    ({ ...item })
  );
  if (['/platform/organizations', '/distribution/organizations'].includes(route.path) &&
    (route.query.id || route.query.view === 'new' || route.query.view === 'accounts')) {
    items[items.length - 1].path = route.path;
    items.push({ label: route.query.view === 'new' ? '开户' : route.query.view === 'accounts' ? '下级账户' : objectTitle() || '下级详情' });
  }
  return items.map((item, index) =>
    ({
      label: item.label,
      path: index < items.length - 1 && item.path && router.resolve(item.path).meta.roles?.includes(auth.session?.role as 'platform' | 'distributor' | 'admin' | 'sales')
        ? item.path : undefined
    })
  );
});
</script>

<template>
  <el-breadcrumb class="console-breadcrumb" aria-label="面包屑" separator="/">
    <span v-for="(item, index) in crumbs" :key="index" class="console-crumb">
      <RouterLink
        v-if="item.path"
        :to="item.path"
        aria-current-value="false"
        :title="item.label"
        class="crumb-label"
      >{{ item.label }}</RouterLink>
      <span
        v-else
        class="crumb-label"
        :title="item.label"
        :aria-current="index === crumbs.length - 1 ? 'page' : undefined"
        tabindex="0"
      >{{ item.label }}</span>
      <span v-if="index < crumbs.length - 1" class="crumb-separator" aria-hidden="true">/</span>
    </span>
  </el-breadcrumb>
</template>
