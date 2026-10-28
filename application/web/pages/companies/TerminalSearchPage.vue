<template>
  <div class="terminal-search-page">
    <header class="search-page-heading">
      <p class="search-page-kicker">全球企业探索</p>
      <h1>发现企业，开启下一次合作</h1>
      <p>按公司名称核实目标企业，或从产品词发现采购企业候选。</p>
    </header>
    <CompanySearch :request="request" />
    <ProductSearch :request="request" />
  </div>
</template>

<script setup lang="ts">
import type { CompanyRequest } from '../../api/companyProfiles';
import CompanySearch from './CompanySearch.vue';
import ProductSearch from './ProductSearch.vue';

defineOptions({ name: 'TerminalSearchPage' });
defineProps<{ request: CompanyRequest }>();
</script>

<style scoped>
.terminal-search-page {
  --search-accent: #4356e0;
  --search-line: #e6e9f0;
  --search-muted: #738095;
  display: grid;
  max-width: 1160px;
  gap: 24px;
  margin: 0 auto;
  color: #1c2333;
}
.search-page-heading { padding: 4px 0 0; }
.search-page-heading .search-page-kicker {
  margin: 0 0 10px;
  color: var(--search-accent);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
}
.search-page-heading h1 { margin: 0 0 10px; font-size: 25px; line-height: 1.4; }
.search-page-heading > p:last-child { margin: 0; color: var(--search-muted); font-size: 13px; }
.terminal-search-page :deep(.workspace-card) {
  min-width: 0;
  margin: 0;
  padding: 26px;
  border: 1px solid var(--search-line);
  border-radius: 12px;
  box-shadow: none;
}
.terminal-search-page :deep(.product-search > h2) { margin: 8px 0 12px; font-size: 18px; }
.terminal-search-page :deep(.product-search > .hint) { color: var(--search-muted); font-size: 13px; }
@media (max-width: 760px) {
  .terminal-search-page { gap: 18px; }
  .terminal-search-page :deep(.workspace-card) { padding: 20px 16px; }
  .search-page-heading h1 { font-size: 22px; }
}
</style>
