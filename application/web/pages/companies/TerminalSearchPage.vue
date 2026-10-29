<template>
  <div class="terminal-search-page">
    <header class="search-page-heading">
      <div class="search-page-intro">
        <h1>找到目标企业，发现合作机会</h1>
        <p>已知公司名称，查找并核实企业；只有产品线索，发现采购企业候选。</p>
        <nav class="search-shortcuts" aria-label="查询方式">
          <a href="#company-search">按公司名查找</a>
          <a href="#product-search">按产品词发现</a>
        </nav>
      </div>
      <svg
        class="discovery-globe"
        viewBox="0 0 160 120"
        aria-hidden="true"
        focusable="false"
      >
        <ellipse
          cx="80"
          cy="62"
          rx="75"
          ry="26"
          fill="none"
          stroke="#b9c9e8"
          stroke-dasharray="3 5"
          transform="rotate(-20 80 62)"
        />
        <circle
          cx="80"
          cy="60"
          r="48"
          fill="#dcebf8"
        />
        <ellipse
          cx="80"
          cy="60"
          rx="24"
          ry="48"
          fill="none"
          stroke="#b3cfe9"
        />
        <path d="M34 47h92M34 75h92M80 12v96" fill="none" stroke="#b3cfe9" />
        <path d="M51 29q16-10 30 4l-7 14-17 6-10-9zM90 56l19 2 6 13-15 17-12-8zM62 71l12 4 5 15-10 8-9-14z" fill="#6091d9" />
        <circle
          cx="116"
          cy="31"
          r="5"
          fill="#4356e0"
        />
        <circle
          cx="116"
          cy="31"
          r="10"
          fill="none"
          stroke="#4356e0"
          opacity=".2"
        />
      </svg>
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
.search-page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 156px; box-sizing: border-box; padding: 24px 28px; border: 1px solid #e6ebf7; border-radius: 12px; background: #f5f7fd; }
.search-page-intro { min-width: 0; }
.search-page-heading h1 { margin: 0 0 8px; color: #3d4963; font-size: 24px; line-height: 1.4; }
.search-page-heading p { margin: 0; color: #647087; font-size: 13px; line-height: 1.7; }
.discovery-globe { flex: 0 0 140px; width: 140px; height: 105px; }
.search-shortcuts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.search-shortcuts a { padding: 8px 14px; border: 1px solid #dce2ff; border-radius: 8px; color: #4356e0; background: #fff; font-size: 13px; line-height: 1.5; text-decoration: none; }
.search-shortcuts a:hover { border-color: #4356e0; background: #eef1ff; }
.search-shortcuts a:focus-visible { outline: 2px solid #4356e0; outline-offset: 3px; }
.terminal-search-page :deep(.workspace-card) { min-width: 0; margin: 0; padding: 26px; border: 1px solid var(--search-line); border-radius: 12px; box-shadow: none; scroll-margin-top: 90px; }
@media (max-width: 760px) {
  .terminal-search-page { gap: 18px; }
  .search-page-heading { gap: 16px; padding: 20px; }
  .search-page-heading h1 { font-size: 22px; }
  .discovery-globe { flex-basis: 100px; width: 100px; height: 75px; }
  .terminal-search-page :deep(.workspace-card) { padding: 20px 16px; }
}
@media (max-width: 600px) {
  .search-page-heading { padding: 20px 16px; }
  .search-page-heading h1 { font-size: 20px; }
  .discovery-globe { display: none; }
}
</style>
