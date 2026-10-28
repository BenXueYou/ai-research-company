<template>
  <section class="workspace">
    <DetailReconciliation :request="request" />
    <UpstreamMonitor :request="request" />
  </section>
</template>

<script setup lang="ts">
import DetailReconciliation from './components/DetailReconciliation.vue';
import UpstreamMonitor from './components/UpstreamMonitor.vue';

defineOptions({ name: 'ReconciliationPage' });
defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
</script>
