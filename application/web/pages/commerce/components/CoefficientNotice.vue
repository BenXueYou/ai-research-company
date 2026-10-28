<script setup lang="ts">
import { inject } from 'vue';
import CoefficientNotice from '../../../components/CoefficientNotice.vue';
import { consoleCoefficientNoticeKey } from '../../../layout/coefficientNotice';

defineProps<{ request: (path: string) => Promise<unknown> }>();
const consoleOwnsNotice = inject(consoleCoefficientNoticeKey, false);
</script>

<template>
  <CoefficientNotice v-if="!consoleOwnsNotice" :request="request" />
</template>
