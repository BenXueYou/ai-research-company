<template>
  <section class="upstream-page">
    <header class="upstream-page-heading">
      <p>平台运营 · 上游服务</p>
      <h1>上游账号监控</h1>
      <p>查看共享账号的历史快照、调用额度与账户查询记录。</p>
    </header>
    <UpstreamMonitor :request="props.request" :standalone="true" />
  </section>
</template>

<script setup lang="ts">
import UpstreamMonitor from './components/UpstreamMonitor.vue';

const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
</script>

<style scoped>
.upstream-page { display: grid; max-width: 1160px; min-width: 0; gap: 22px; margin: 0 auto; }
.upstream-page-heading { padding: 4px 2px 0; }
.upstream-page-heading > p:first-child { margin: 0 0 9px; color: var(--console-brand); font-size: 11px; font-weight: 700; letter-spacing: 2px; }
.upstream-page-heading h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.4; }
.upstream-page-heading > p:last-child { margin: 0; color: var(--console-muted); font-size: 13px; }
@media (max-width: 760px) {
  .upstream-page { gap: 18px; }
  .upstream-page-heading h1 { font-size: 22px; }
}
</style>
