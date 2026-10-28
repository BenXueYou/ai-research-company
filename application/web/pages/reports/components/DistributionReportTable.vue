<template>
  <section class="report-card">
    <h2>{{ title }}</h2>
    <p v-if="!rows.length" role="status">暂无记录。</p>
    <div
      v-else
      class="table-scroll"
      tabindex="0"
      :aria-label="`${title}，可横向滚动`"
    >
      <table>
        <thead><tr><th v-for="column in columns" :key="column.key">{{ column.label }}</th></tr></thead>
        <tbody><tr v-for="(row, index) in rows" :key="index"><td v-for="column in columns" :key="column.key">{{ value(row, column.key) }}</td></tr></tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ReportRow } from '../../../api/distributionProfit';
const props = defineProps<{
  title: string;
  columns: { key: string; label: string }[];
  rows: ReportRow[];
  organizationName: (id: string) => string;
}>();
function value(row: ReportRow, key: string) {
  const item = row[key];
  if (item === undefined || item === null || item === '') return '数据缺失';
  return ['organizationId', 'sellerId', 'buyerId'].includes(key) ? props.organizationName(item) : item;
}
</script>

<style scoped>
.report-card { margin-top: 20px; padding: 20px 24px; border: 1px solid #e5e7f1; border-radius: 12px; background: #fff; }
h2 { margin: 0 0 16px; font-size: 16px; }
p { color: #727d96; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; border-bottom: 1px solid #edf0f6; text-align: left; white-space: nowrap; }
</style>
