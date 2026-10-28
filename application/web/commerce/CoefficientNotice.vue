<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { ElAlert } from 'element-plus';

type Notice = {
  previousCoefficient: string;
  proposedCoefficient: string;
  effectiveAt: string;
  activatedAt: string | null;
  notice: string;
};
const props = defineProps<{ request: (path: string) => Promise<unknown> }>();
const notices = shallowRef<Notice[]>([]);
onMounted(async () => {
  try { notices.value = await props.request('coefficient/notices') as Notice[]; }
  catch { notices.value = []; }
});
</script>

<template>
  <div v-for="item in notices" :key="`${item.effectiveAt}-${item.proposedCoefficient}`">
    <ElAlert
      :title="`系数调整通知：X ${item.previousCoefficient} → ${item.proposedCoefficient}；计划生效 ${item.effectiveAt}。${item.notice}${item.activatedAt ? `；实际生效 ${item.activatedAt}` : ''}`"
      type="info"
      :closable="false"
    />
  </div>
</template>
