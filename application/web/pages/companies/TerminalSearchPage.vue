<template>
  <div class="terminal-search-page">
    <header class="search-page-heading">
      <div>
        <p class="search-page-kicker">全球企业探索</p>
        <h1>发现企业，开启下一次合作</h1>
        <p>先核实企业身份，再决定是否查询详情与联系人。</p>
      </div>
      <nav class="search-shortcuts" aria-label="查询方式">
        <a href="#company-search">按公司名查找</a>
        <a href="#product-search">按产品词发现</a>
      </nav>
    </header>
    <CompanySearch id="company-search" :request="request" />
    <ProductSearch id="product-search" :request="request" />
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
  max-width: 1440px;
  min-width: 0;
  gap: 22px;
  margin: 0 auto;
  color: #1c2333;
}
.search-page-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; padding: 8px 0; }
.search-page-kicker { margin: 0 0 8px; color: var(--search-accent); font-size: 11px; letter-spacing: 2px; }
.search-page-heading h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.4; }
.search-page-heading p:last-child { margin: 0; color: var(--search-muted); font-size: 13px; }
.search-shortcuts { display: flex; flex-wrap: wrap; gap: 12px; }
.search-shortcuts a { padding: 10px 14px; border: 1px solid #dce2ff; border-radius: 8px; color: #4356e0; background: #fff; font-size: 13px; text-decoration: none; }
.search-shortcuts a:hover { background: #f4f6ff; }
.search-shortcuts a:focus-visible { outline: 2px solid #4356e0; outline-offset: 3px; }
.terminal-search-page :deep(.workspace-card) { min-width: 0; margin: 0; padding: 26px; border: 1px solid var(--search-line); border-radius: 12px; box-shadow: none; scroll-margin-top: 90px; }
@media (max-width: 760px) {
  .terminal-search-page { gap: 18px; }
  .search-page-heading h1 { font-size: 22px; }
  .terminal-search-page :deep(.workspace-card) { padding: 20px 16px; }
}
</style>
