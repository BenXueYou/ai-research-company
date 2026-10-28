<template>
  <section class="workspace">
    <div class="page-heading">
      <h1>上游与对账</h1>
    </div>
    <DetailReconciliation :request="request" />
    <UpstreamMonitor :request="request" />
  </section>
</template>

<script setup lang="ts">
import DetailReconciliation from '../companies/DetailReconciliation.vue';
import UpstreamMonitor from './components/UpstreamMonitor.vue';

defineOptions({ name: 'ReconciliationPage' });
defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
</script>
