<template>
  <div class="point-summary" aria-label="内部点数摘要">
    <p v-if="state === 'loading'" role="status">点数读取中…</p>
    <p v-else-if="state === 'error'" role="alert">点数读取失败，请刷新重试。</p>
    <p v-else-if="!account">暂无点数账户数据</p>
    <dl v-else>
      <div v-for="field in fields" :key="field.key">
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
.point-summary dl { display: flex; flex-wrap: wrap; gap: 16px 32px; margin: 16px 0; }
.point-summary dt { color: #606266; font-size: 13px; }
.point-summary dd { margin: 6px 0 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
</style>
