<template>
  <section class="distribution-orders" aria-label="分销点数订单">
    <CoefficientNotice :request="request" />
    <PointOrders ref="orders" :request="request" distribution-lifecycle />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import PointOrders from './PointOrders.vue';
import CoefficientNotice from './components/CoefficientNotice.vue';
import { useFormLeave } from '../../router/formLeave';

defineOptions({ name: 'DistributionPointOrdersPage' });
defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const orders = ref<InstanceType<typeof PointOrders>>();
useFormLeave({
  retainUnknown: true,
  state: () => orders.value?.leaveState() ?? 'clean',
  discard: () => orders.value?.discardDraft(),
  message: '订单信息尚未提交。确定放弃并离开吗？取消将继续编辑。'
});
</script>

<style scoped>
.distribution-orders { min-width: 0; color: #1c2333; }
.distribution-orders :deep(.order-page) { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.distribution-orders :deep(.order-page-header) { align-items: center; padding: 0; border: 0; }
.distribution-orders :deep(.eyebrow) { margin: 0 0 9px; color: #9ba6bd; font-size: 10px; font-weight: 400; letter-spacing: 1.5px; }
.distribution-orders :deep(.order-page h1) { font-size: 24px; line-height: 1.4; }
.distribution-orders :deep(.order-header-mark) { display: none; }
.distribution-orders :deep(.order-page > p) { margin: 7px 0 20px; font-size: 13px; line-height: 1.8; }
.distribution-orders :deep(.inventory-strip) { gap: 14px; margin: 20px 0; border: 0; border-radius: 0; }
.distribution-orders :deep(.inventory-strip > div) { padding: 18px 20px; border: 1px solid #e6e9f0; border-radius: 11px; background: #fff; }
.distribution-orders :deep(.inventory-strip strong) { font: 600 24px/1.4 'Segoe UI', Consolas, monospace; font-variant-numeric: tabular-nums; }
.distribution-orders :deep(.order-create-form), .distribution-orders :deep(.order-card) { margin-top: 20px; padding: 23px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
.distribution-orders :deep(.order-create-form) { gap: 18px; }
.distribution-orders :deep(.el-form-item__label) { height: auto; margin: 0 0 7px; color: #647087; font-size: 12px; line-height: 1.65; }
.distribution-orders :deep(.order-create-form .el-input__wrapper) { min-height: 42px; }
.distribution-orders :deep(.order-create-form select) { min-height: 42px; color: #1c2333; font-size: 14px; }
.distribution-orders :deep(.order-create-form > .primary-button) { min-height: 42px; margin: 0; padding: 8px 20px; border: 1px solid #4356e0; color: #fff; background: #4356e0; font-weight: 600; }
.distribution-orders :deep(.primary-button:hover:not(:disabled)) { border-color: #3343c9; background: #3343c9; }
.distribution-orders :deep(.primary-button:disabled) { opacity: .45; }
.distribution-orders :deep(.order-card p) { font-size: 13px; }
.distribution-orders :deep(.order-card .order-reference) { color: #8a95a6; font-size: 11px; }
.distribution-orders :deep(.order-page > .el-form:not(.order-create-form)) { padding: 23px; background: #fff; }
.distribution-orders :deep(.el-button:focus-visible) { outline: 2px solid #8997ff; outline-offset: 3px; }
@media (max-width: 1000px) {
  .distribution-orders :deep(.inventory-strip) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .distribution-orders :deep(.order-create-form) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .distribution-orders :deep(.order-page h1) { font-size: 21px; }
  .distribution-orders :deep(.inventory-strip) { gap: 10px; }
  .distribution-orders :deep(.inventory-strip > div) { padding: 14px 12px; }
  .distribution-orders :deep(.inventory-strip strong) { font-size: 20px; }
  .distribution-orders :deep(.order-create-form) { grid-template-columns: minmax(0, 1fr); }
  .distribution-orders :deep(.order-create-form), .distribution-orders :deep(.order-card), .distribution-orders :deep(.order-page > .el-form:not(.order-create-form)) { padding: 18px; }
}
</style>
