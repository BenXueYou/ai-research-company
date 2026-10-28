<script setup lang="ts">
import { provide } from 'vue';
import CoefficientNotice from '../components/CoefficientNotice.vue';
import { consoleCoefficientNoticeKey } from './coefficientNotice';

defineProps<{ request: (path: string) => Promise<unknown> }>();
provide(consoleCoefficientNoticeKey, true);
</script>

<template>
  <CoefficientNotice :request="request" />
  <slot />
</template>
