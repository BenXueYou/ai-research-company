<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue';
import { ElButton } from 'element-plus';
import { readTerminalUsage, type TerminalUsage } from '../../api/terminalUsage';

const props = defineProps<{ request: (path: string) => Promise<unknown> }>();
const report = shallowRef<TerminalUsage | null>(null);
const loading = shallowRef(false);
const error = shallowRef('');
let active = true;
const display = (value: unknown) => value === undefined || value === null || value === '' ? '数据缺失' : value;

async function load() {
  if (loading.value) return;
  loading.value = true;
  report.value = null;
  error.value = '';
  try {
    const result = await readTerminalUsage(props.request);
    if (active) report.value = result;
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : '用量读取失败，请刷新重试';
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(load);
onUnmounted(() => { active = false; });
</script>

<template>
  <section class="terminal-usage" aria-label="本企业点数用量">
    <header class="usage-toolbar">
      <p>查看本企业点数余额、查询冻结及扣点退款记录。</p>
      <el-button :disabled="loading" @click="load">
        <svg class="refresh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17" /></svg>
        刷新用量
      </el-button>
    </header>
    <p v-if="loading" class="usage-message" role="status">正在读取用量…</p>
    <p v-if="error" class="usage-message usage-error" role="alert">{{ error }}</p>
    <template v-if="report">
      <section class="usage-account" aria-label="账户余额与冻结">
        <h2 class="section-title">账户余额与冻结</h2>
        <p v-if="!report.accounts.length" class="usage-message" role="status">暂无账户余额数据，请稍后刷新核实。</p>
        <div v-for="(account, index) in report.accounts" :key="index" class="account-summary">
          <p class="balance-card"><span class="metric-label">余额：</span><strong class="metric-value">{{ display(account.balance) }}</strong><span class="metric-unit"> 点</span></p>
          <p class="frozen-card"><span class="metric-label">查询冻结：</span><strong class="metric-value">{{ display(account.queryFrozen) }}</strong><span class="metric-unit"> 点</span></p>
        </div>
      </section>
      <section class="ledger-card" aria-label="扣点与退款流水">
        <header class="ledger-heading"><h2 class="section-title">扣点与退款流水</h2></header>
        <p v-if="!report.ledger.length" class="empty-ledger">暂无扣点与退款流水。</p>
        <div
          v-else
          class="ledger-scroll console-scroll"
          tabindex="0"
          aria-label="点数流水表格，可横向滚动"
        >
        <table>
          <thead><tr><th>流水编号</th><th>业务引用</th><th>时间</th><th>来源</th><th>事件</th><th>点数</th><th>余额</th><th>查询冻结</th></tr></thead>
          <tbody>
            <tr v-for="item in report.ledger" :key="`${item.source}-${item.id}`">
              <td class="ledger-id">{{ display(item.id) }}</td><td class="ledger-reference">{{ display(item.referenceId) }}</td><td class="ledger-time">{{ display(item.createdAt) }}</td>
              <td><span class="source-label">{{ display(item.source) }}</span></td><td>{{ display(item.event) }}</td><td class="numeric-cell">{{ display(item.amount) }}</td>
              <td class="numeric-cell">{{ display(item.balanceAfter) }}</td><td class="numeric-cell">{{ display(item.frozenAfter) }}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.terminal-usage { min-width: 0; color: #263052; }
.usage-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.usage-toolbar p { margin: 0; color: #727d96; font-size: 13px; line-height: 1.7; }
.usage-toolbar :deep(.el-button) { flex: none; min-height: 36px; padding: 9px 14px; border-color: #dce1ef; border-radius: 8px; color: #4657da; background: #fff; }
.usage-toolbar :deep(.el-button:hover:not(:disabled)) { border-color: #a6afd6; background: #f0f2ff; }
.refresh-icon { width: 15px; height: 15px; margin-right: 7px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.section-title { margin: 0; color: #263052; font-size: 15px; font-weight: 600; line-height: 1.6; }
.usage-account > .section-title { margin-bottom: 14px; }
.account-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-bottom: 24px; }
.account-summary p { display: flex; align-items: baseline; flex-wrap: wrap; margin: 0; padding: 24px; border: 1px solid #e5e7f1; border-radius: 12px; background: #fff; }
.account-summary .balance-card { border-top: 3px solid #4657da; padding-top: 22px; }
.account-summary .frozen-card { border-top: 3px solid #a6afd6; padding-top: 22px; }
.metric-label { flex-basis: 100%; margin-bottom: 14px; color: #727d96; font-size: 13px; }
.metric-value { color: #3446c2; font-size: clamp(24px, 2.4vw, 32px); font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.frozen-card .metric-value { color: #53617e; }
.metric-unit { margin-left: 7px; color: #8a93a9; font-size: 13px; }
.ledger-card { min-width: 0; overflow: hidden; border: 1px solid #e5e7f1; border-radius: 12px; background: #fff; }
.ledger-heading { padding: 20px 24px; border-bottom: 1px solid #edf0f6; }
.ledger-scroll { max-width: 100%; overflow-x: auto; }
.ledger-scroll:focus-visible { outline: 2px solid #4657da; outline-offset: -2px; }
.terminal-usage table { width: 100%; border-collapse: collapse; font-size: 13px; }
.terminal-usage th { padding: 13px 18px; background: #f7f8fc; color: #727d96; font-size: 12px; font-weight: 500; text-align: left; white-space: nowrap; }
.terminal-usage td { padding: 18px; border-bottom: 1px solid #edf0f6; white-space: nowrap; }
.terminal-usage tr:last-child td { border-bottom: 0; }
.terminal-usage tbody tr:hover { background: #fafbff; }
.terminal-usage th:first-child, .terminal-usage td:first-child { padding-left: 24px; }
.terminal-usage th:last-child, .terminal-usage td:last-child { padding-right: 24px; }
.terminal-usage th:nth-last-child(-n+3), .terminal-usage .numeric-cell { text-align: right; font-variant-numeric: tabular-nums; }
.ledger-id, .ledger-time { color: #8a93a9; font-variant-numeric: tabular-nums; }
.ledger-reference { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #53617e; }
.source-label { display: inline-block; padding: 4px 9px; border: 1px solid #e5e8f5; border-radius: 5px; background: #f2f4fc; color: #5868b0; font-size: 12px; }
.usage-message { margin: 0 0 24px; padding: 18px 22px; border: 1px solid #e5e7f1; border-radius: 10px; background: #fff; color: #727d96; font-size: 13px; }
.usage-error { border-color: #f2d6da; background: #fff0f0; color: #a13d49; }
.empty-ledger { margin: 0; padding: 56px 24px; text-align: center; color: #8a93a9; font-size: 13px; }
@media (max-width: 760px) {
  .usage-toolbar { align-items: flex-start; gap: 12px; margin-bottom: 20px; }
  .account-summary { gap: 12px; }
  .account-summary p { padding: 18px; }
  .account-summary .balance-card, .account-summary .frozen-card { padding-top: 16px; }
  .ledger-heading { padding: 18px; }
}
@media (max-width: 420px) {
  .account-summary { grid-template-columns: 1fr; }
}
</style>
