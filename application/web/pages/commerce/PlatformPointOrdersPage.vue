<template>
  <PointOrders ref="orders" :request="request" platform-lifecycle />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import PointOrders from './PointOrders.vue';
import { useFormLeave } from '../../router/formLeave';

defineOptions({ name: 'PlatformPointOrdersPage' });
defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const orders = ref<InstanceType<typeof PointOrders>>();
useFormLeave({
  retainUnknown: true,
  state: () => orders.value?.leaveState() ?? 'clean',
  discard: () => orders.value?.discardDraft(),
  message: '订单信息尚未提交。确定放弃并离开吗？取消将继续编辑。'
});
</script>
