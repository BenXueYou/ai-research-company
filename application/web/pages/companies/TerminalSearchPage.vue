<template>
  <div class="terminal-search-page">
    <header class="search-page-heading">
      <p class="search-page-kicker">全球企业探索</p>
      <h1>发现企业，开启下一次合作</h1>
      <p>按公司名称核实目标企业，或从产品词发现采购企业候选。</p>
    </header>
    <div class="discovery-layout">
      <section class="explore-stage" aria-label="市场探索">
        <div class="stage-topline"><span>全球市场探索</span><small>GLOBAL OPPORTUNITIES</small></div>
        <svg class="stage-globe" viewBox="0 0 480 480" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="search-globe-fill" cx="32%" cy="25%" r="80%">
              <stop offset="0%" stop-color="#ffffff" />
              <stop offset="56%" stop-color="#d9eaf8" />
              <stop offset="100%" stop-color="#9cbde0" />
            </radialGradient>
          </defs>
          <ellipse cx="240" cy="235" rx="218" ry="70" fill="none" stroke="#bccbea" stroke-dasharray="5 7" transform="rotate(-19 240 235)" />
          <ellipse cx="240" cy="235" rx="218" ry="70" fill="none" stroke="#d4dff0" stroke-dasharray="5 7" transform="rotate(20 240 235)" />
          <circle cx="240" cy="235" r="174" fill="url(#search-globe-fill)" />
          <ellipse cx="240" cy="235" rx="89" ry="174" fill="none" stroke="#89afd7" opacity=".65" />
          <path d="M72 235h336M93 170h294M93 300h294" fill="none" stroke="#89afd7" opacity=".55" />
          <path d="M145 130q35-34 86-27l25 26-12 28-37 9-24 33-39-8-16-27zM267 127q55-30 101 3l24 42-22 38-49 8-37-30-35-15zM188 247l37 14 22 42-29 64-28 3-16-52-25-24zM307 252l40-16 34 34-9 55-42 19-34-37z" fill="#3d78ce" opacity=".9" />
          <circle cx="358" cy="178" r="8" fill="#4356e0" /><circle cx="358" cy="178" r="18" fill="none" stroke="#4356e0" opacity=".32" />
          <circle cx="155" cy="285" r="7" fill="#4356e0" /><circle cx="155" cy="285" r="16" fill="none" stroke="#4356e0" opacity=".3" />
        </svg>
        <div class="stage-caption">
          <span class="stage-line" aria-hidden="true"></span>
          <h2>从全球市场，找到下一家合作企业</h2>
          <p>先核实企业身份，再决定是否查询详情与联系人。</p>
        </div>
      </section>
      <CompanySearch :request="request" />
    </div>
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
  max-width: 1440px;
  gap: 22px;
  margin: 0 auto;
  color: #1c2333;
}
.search-page-heading { padding: 4px 0 2px; }
.search-page-heading .search-page-kicker {
  margin: 0 0 10px;
  color: var(--search-accent);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
}
.search-page-heading h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.4; }
.search-page-heading > p:last-child { margin: 0; color: var(--search-muted); font-size: 13px; }
.discovery-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 440px);
  align-items: stretch;
  min-width: 0;
  border: 1px solid var(--search-line);
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}
.explore-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 550px;
  padding: 24px;
  background: radial-gradient(ellipse at 52% 43%, #fff 8%, #f3f7fd 66%, #eaf0fb 100%);
  overflow: hidden;
}
.stage-topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 1; }
.stage-topline span { padding: 6px 11px; border: 1px solid #e2e8f5; border-radius: 6px; color: #667693; background: #fff; font-size: 11px; }
.stage-topline small { color: #95a3bb; font-size: 10px; letter-spacing: 1.5px; }
.stage-globe { width: min(100%, 450px); height: auto; margin: auto; filter: drop-shadow(0 24px 24px #4f72bd1b); }
.stage-caption { position: relative; z-index: 1; max-width: 440px; }
.stage-line { display: block; width: 38px; height: 3px; margin-bottom: 14px; border-radius: 2px; background: #4356e0; }
.stage-caption h2 { margin: 0 0 6px; color: #27344c; font-size: 19px; line-height: 1.5; }
.stage-caption p { margin: 0; color: #7f8ca4; font-size: 12px; }
.discovery-layout :deep(.company-search.workspace-card) {
  min-width: 0;
  border: 0;
  border-left: 1px solid var(--search-line);
  border-radius: 0;
}
.discovery-layout :deep(.company-search .company-search-form) { grid-template-columns: minmax(0, 1fr); }
.discovery-layout :deep(.company-search-form .primary-button) { width: 100%; }
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
@media (max-width: 1080px) {
  .discovery-layout { grid-template-columns: minmax(0, 1fr) minmax(310px, 390px); }
  .explore-stage { min-height: 500px; }
}
@media (max-width: 760px) {
  .terminal-search-page { gap: 18px; }
  .discovery-layout { grid-template-columns: 1fr; }
  .explore-stage { min-height: 260px; padding: 18px; }
  .stage-globe { position: absolute; width: 235px; right: -18px; top: 10px; opacity: .9; }
  .stage-caption { max-width: 58%; margin-top: auto; }
  .stage-caption h2 { font-size: 15px; }
  .stage-caption p { font-size: 11px; }
  .discovery-layout :deep(.company-search.workspace-card) { border-top: 1px solid var(--search-line); border-left: 0; }
  .terminal-search-page :deep(.workspace-card) { padding: 20px 16px; }
  .search-page-heading h1 { font-size: 22px; }
}
</style>
