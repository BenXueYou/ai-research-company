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
.report-card { min-width: 0; margin-top: 20px; padding: 23px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
h2 { margin: 0 0 16px; color: #1c2333; font-size: 16px; font-weight: 650; }
p { margin: 0; padding: 28px 16px; border-radius: 8px; color: #8a95a6; background: #f8f9fc; font-size: 13px; text-align: center; }
.table-scroll { max-width: 100%; overflow-x: auto; }
.table-scroll:focus-visible { outline: 2px solid #8997ff; outline-offset: 3px; }
table { width: 100%; border-collapse: collapse; color: #465064; font-size: 12.5px; font-variant-numeric: tabular-nums; }
th, td { padding: 15px 13px; border-bottom: 1px solid #edf0f6; text-align: left; vertical-align: top; white-space: nowrap; }
th { color: #8b96a8; background: #f8f9fc; font-weight: 500; }
td:first-child { color: #1c2333; font-weight: 500; }
tbody tr:hover { background: #fafbff; }
@media (max-width: 640px) {
  .report-card { padding: 18px; }
  th, td { padding: 11px 8px; }
}
</style>
