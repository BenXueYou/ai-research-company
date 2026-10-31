<template>
  <div class="terminal-search-page">
    <section class="market-exploration" aria-labelledby="market-exploration-title">
      <div class="market-label"><span>全球市场探索</span><b>GLOBAL OPPORTUNITIES</b></div>
      <div class="market-caption">
        <h1 id="market-exploration-title">让下一次连接，从这里开始</h1>
        <p>用产品与贸易记录发现候选企业，再逐步核实身份、建立联系。</p>
      </div>
      <ol class="search-journey" aria-label="企业开发流程">
        <li aria-current="step">搜索候选</li>
        <li>核对身份 / 建档</li>
        <li>档案内找联系人</li>
        <li>预览并发送</li>
      </ol>
      <div class="globe-art" aria-hidden="true">
        <svg viewBox="0 0 640 640" xmlns="http://www.w3.org/2000/svg">
        <defs>               <radialGradient id="search-market-sphere" cx="35%" cy="28%" r="80%">                 <stop offset="0%" stop-color="#ffffff"/>                 <stop offset="45%" stop-color="#dcebf8"/>                 <stop offset="80%" stop-color="#b3cfe9"/>                 <stop offset="100%" stop-color="#93b7dc"/>               </radialGradient>
        </defs>
        <ellipse cx="320" cy="320" rx="300" ry="96" fill="none" stroke="#b9c9e8" stroke-width="1" stroke-dasharray="4 6" transform="rotate(-16 320 320)"/>
        <ellipse cx="320" cy="320" rx="286" ry="120" fill="none" stroke="#cdd9ef" stroke-width="1" stroke-dasharray="3 7" transform="rotate(22 320 320)"/>
        <path d="M210 90 q60 -34 120 -10 q30 14 22 40 q-50 8 -84 26 q-46 22 -70 -6 q-16 -26 12 -50z" fill="none" stroke="#5b83d6" stroke-width="1.4"/>
        <circle cx="320" cy="320" r="252" fill="url(#search-market-sphere)"/>
        <g fill="#2f6fd0" opacity="0.9">               <path d="M196 168 q34 -26 78 -18 q40 8 52 34 q-8 26 -40 30 q-30 4 -44 22 q-16 20 -38 10 q-26 -12 -26 -38 q0 -24 18 -40z"/>               <path d="M330 132 q44 -16 84 4 q34 18 30 44 q-24 18 -58 12 q-40 -6 -60 -22 q-16 -20 4 -38z"/>               <path d="M392 214 q30 -6 46 12 q14 18 2 34 q-18 14 -40 6 q-24 -8 -24 -28 q0 -18 16 -24z"/>               <path d="M238 262 q22 -10 40 4 q16 14 8 34 q-10 22 -34 20 q-26 -2 -30 -26 q-4 -22 16 -32z"/>               <path d="M286 356 q18 -8 32 2 q14 12 8 28 q-8 18 -28 16 q-22 -2 -24 -22 q-2 -16 12 -24z"/>               <path d="M420 330 q16 -6 28 4 q10 10 4 22 q-8 14 -24 10 q-16 -4 -16 -18 q0 -12 8 -18z"/>
        </g>
        <g stroke="#2f6fd0" stroke-width="3" stroke-dasharray="10 8" fill="none" opacity="0.75">               <path d="M150 420 q60 60 150 74"/>               <path d="M360 470 q70 -10 118 -52"/>               <path d="M188 210 q-30 60 -22 130"/>
        </g>
        <path d="M120 250 q-24 60 -6 120" fill="none" stroke="#4d78cf" stroke-width="1.6"/>
        <path d="M520 200 q30 70 10 140" fill="none" stroke="#4d78cf" stroke-width="1.6"/>           </svg>
      </div>
      <span class="market-note"><i aria-hidden="true"></i>选择市场，开始发现</span>
    </section>
    <section class="search-workbench" aria-label="找企业">
      <div class="search-mode-tabs">
        <el-tabs v-model="searchMode" aria-label="搜索方式">
          <el-tab-pane name="product" label="按产品词" />
          <el-tab-pane name="company" label="按公司名" />
        </el-tabs>
      </div>
      <CompanySearch v-show="searchMode === 'company'" id="company-search" :request="request" />
      <ProductSearch v-show="searchMode === 'product'" id="product-search" :request="request" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ElTabPane, ElTabs } from 'element-plus';
import { ref } from 'vue';
import type { CompanyRequest } from '../../api/companyProfiles';
import CompanySearch from './CompanySearch.vue';
import ProductSearch from './ProductSearch.vue';

defineOptions({ name: 'TerminalSearchPage' });
defineProps<{ request: CompanyRequest }>();
const searchMode = ref<'product' | 'company'>('product');
</script>

<style scoped>
.terminal-search-page { --search-accent: #4356e0; --search-line: #e3e7f1; display: grid; gap: 24px; max-width: 1440px; min-width: 0; margin: 0 auto; color: #1c2333; }
.search-journey { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 14px 24px; margin: 42px 0 0; padding: 0; list-style: none; color: #8b97ad; font-size: 12px; }
.search-journey li { display: flex; align-items: center; gap: 8px; }
.search-journey li + li::before { content: ''; width: 24px; height: 1px; background: #d9dfed; }
.search-journey [aria-current] { color: var(--search-accent); font-weight: 600; }
.search-journey [aria-current]::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--search-accent); box-shadow: 0 0 0 4px #4356e00d; }
.search-workbench { min-width: 0; }
.search-mode-tabs { padding: 8px 26px 0; border: 1px solid var(--search-line); border-bottom: 0; border-radius: 12px 12px 0 0; background: #fff; }
.market-exploration { position: relative; min-height: 240px; overflow: hidden; padding: 26px 32px; box-sizing: border-box; border: 1px solid var(--search-line); border-radius: 12px; background: radial-gradient(ellipse at 48% 55%, #fff 10%, #f4f7fc 65%, #ecf0fa 100%); }
.market-label { position: relative; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 20px; color: #8394b4; font-size: 11px; }
.market-label > span { padding: 6px 10px; border: 1px solid #e2e7f2; border-radius: 6px; background: #fff; }
.market-label > b { font-size: 10px; font-weight: 500; letter-spacing: 1.5px; }
.market-caption { position: relative; z-index: 1; width: 55%; margin-top: 28px; }
.market-caption h1 { margin: 0 0 6px; font-size: 26px; font-weight: 600; line-height: 1.5; }
.market-caption p { max-width: 360px; margin: 0; color: #8b99b1; font-size: 12px; line-height: 1.7; }
.globe-art { position: absolute; top: -34px; right: 3%; width: 350px; filter: drop-shadow(0 20px 25px #4f72bd13); }
.globe-art svg { display: block; width: 100%; height: auto; }
.market-note { position: absolute; top: 46%; right: 6%; display: flex; align-items: center; gap: 8px; padding: 12px 15px; border: 1px solid #fff; border-radius: 10px; color: #596a87; background: #ffffffed; box-shadow: 0 7px 24px #344e8c0a; font-size: 12px; }
.market-note i { width: 7px; height: 7px; border-radius: 50%; background: var(--search-accent); }
@media (max-width: 760px) {
  .terminal-search-page { gap: 20px; }
  .search-journey { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin-top: 28px; font-size: 11px; }
  .search-journey li { gap: 12px; }
  .search-journey li + li::before { display: none; }
  .search-mode-tabs { padding: 8px 18px 0; }
  .market-exploration { min-height: 220px; padding: 22px 18px; }
  .market-label { gap: 10px; }
  .market-label > b { font-size: 9px; }
  .market-caption { width: 70%; margin-top: 28px; }
  .market-caption h1 { font-size: 22px; }
  .globe-art { top: 65px; right: -50px; width: 250px; opacity: .65; }
  .market-note { display: none; }
}
@media (max-width: 480px) {
  .market-caption { width: 70%; }
  .globe-art { right: -100px; opacity: .4; }
}
</style>
