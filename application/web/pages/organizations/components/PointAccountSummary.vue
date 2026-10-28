<template>
  <div class="point-summary" aria-label="内部点数摘要">
    <p v-if="state === 'loading'" role="status">点数读取中…</p>
    <p v-else-if="state === 'error'" role="alert">点数读取失败，请刷新重试。</p>
    <p v-else-if="!account">暂无点数账户数据</p>
    <dl v-else>
      <div v-for="field in fields" :key="field.key" :class="{ 'available-value': field.key === 'available' }">
        <dt>{{ field.label }}（内部点数）</dt>
        <dd>{{ account[field.key] ?? '数据缺失' }}</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
export interface PointAccount {
  organizationId: string;
  balance: string | null;
  queryFrozen: string | null;
  salesReserved: string | null;
  available: string | null;
}
defineProps<{
  account?: PointAccount;
  state: 'loading' | 'ready' | 'error';
}>();
const fields = [
  { key: 'balance', label: '余额' },
  { key: 'queryFrozen', label: '查询冻结' },
  { key: 'salesReserved', label: '销售预留' },
  { key: 'available', label: '可用余额' }
] as const;
</script>

<style scoped>
.point-summary { min-width: 0; }
.point-summary > p { margin: 8px 0; padding: 12px; border-radius: 8px; background: #f7f8fc; color: #647087; font-size: 12px; line-height: 1.7; }
.point-summary > p[role="alert"] { color: #b45335; background: #fff4ef; }
.point-summary dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px; margin: 0; }
.point-summary dt { color: #647087; font-size: 11px; line-height: 1.6; }
.point-summary dd { margin: 4px 0 0; color: #26344e; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.5; overflow-wrap: anywhere; }
.available-value dd { color: #4356e0; }
@media (max-width: 600px) { .point-summary dl { gap: 12px 16px; padding: 14px; border-radius: 8px; background: #f8f9fc; } }
</style>
