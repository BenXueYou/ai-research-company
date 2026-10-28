<template>
  <UpstreamMonitor :request="props.request" :standalone="true" />
</template>

<script setup lang="ts">
import UpstreamMonitor from './components/UpstreamMonitor.vue';

const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
</script>
