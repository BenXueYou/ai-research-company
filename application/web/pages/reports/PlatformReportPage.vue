<template>
  <section class="platform-report">
    <header class="report-toolbar">
      <el-button class="report-refresh" @click="load">刷新</el-button>
      <RouterLink class="back-link" to="/platform/ledger">返回点数与账务</RouterLink>
      <a
        class="export-link"
        href="/api/reports/own-ledger.csv"
        download="own-ledger.csv"
      >导出自有账务</a>
    </header>
    <p v-if="error" class="report-error" role="alert">{{ error }}</p>
    <template v-if="report">
      <template v-if="kind === 'profit'">
        <div class="totals">
          <p class="summary-card"><span>平台销售毛利：</span><strong>{{ report.totals.salesGrossProfit }}</strong></p>
          <p class="summary-card"><span>平台承担费用：</span><strong>{{ report.totals.platformExpenses }}</strong></p>
          <p class="summary-card"><span>扣除平台承担费用后：</span><strong>{{ report.totals.afterPlatformExpenses }}</strong></p>
        </div>
        <section class="report-panel"><h2>授权交易</h2>
        <div class="table-wrap"
          tabindex="0"
          role="region"
          aria-label="授权交易表格"><table><thead><tr><th>订单</th><th>卖方</th><th>买方</th><th>数量</th><th>金额</th><th>状态</th></tr></thead>
          <tbody><tr v-for="item in report.transactions" :key="item.id">
            <td>{{ item.id }}</td><td>{{ name(item.sellerId) }}</td><td>{{ name(item.buyerId) }}</td><td>{{ item.quantity }}</td><td>{{ item.amount }}</td><td>{{ item.status }}</td>
          </tr></tbody>
        </table></div></section>
        <section class="report-panel"><h2>销售毛利明细</h2>
        <div class="table-wrap"
          tabindex="0"
          role="region"
          aria-label="销售毛利明细表格"><table><thead><tr><th>订单</th><th>卖方</th><th>买方</th><th>销售金额</th><th>销售成本</th><th>毛利</th></tr></thead>
          <tbody><tr v-for="item in report.sales" :key="item.orderId">
            <td>{{ item.orderId }}</td><td>{{ name(item.sellerId) }}</td><td>{{ name(item.buyerId) }}</td><td>{{ item.salesAmount }}</td><td>{{ item.salesCost }}</td><td>{{ item.grossProfit }}</td>
          </tr></tbody>
        </table></div></section>
        <section class="report-panel"><h2>平台承担费用</h2>
        <p
          v-for="item in report.expenses"
          :key="item.id"
          class="expense-row"
        >{{ item.id }} · {{ item.purpose }} · {{ item.amount }} · {{ item.sourceReference }}</p>
        <p v-if="!report.expenses.length" class="empty-state">暂无平台承担费用</p>
        </section>
      </template>
      <template v-else>
        <section class="report-panel"><h2>平台库存与采购流水</h2>
        <p v-if="report.inventory" class="inventory">库存 {{ report.inventory.balance }}，冻结 {{ report.inventory.frozen }}，预留 {{ report.inventory.reserved }}</p>
        <div class="table-wrap"
          tabindex="0"
          role="region"
          aria-label="平台库存与采购流水表格"><table><thead><tr><th>流水</th><th>业务引用</th><th>事件</th><th>内部点数</th><th>上游点数</th><th>现金支出</th><th>费用</th><th>余额</th></tr></thead>
          <tbody><tr v-for="item in report.procurement" :key="item.id">
            <td>{{ item.id }}</td><td>{{ item.reference }}</td><td>{{ item.event }}</td><td>{{ item.internalDelta }}</td><td>{{ item.upstreamDelta }}</td><td>{{ item.cashOutflow }}</td><td>{{ item.expenseDelta }}</td><td>{{ item.balanceAfter }}</td>
          </tr></tbody>
        </table></div></section>
        <section class="report-panel"><h2>扣点与退款流水</h2>
        <div class="table-wrap"
          tabindex="0"
          role="region"
          aria-label="扣点与退款流水表格"><table><thead><tr><th>流水</th><th>业务引用</th><th>组织</th><th>时间</th><th>来源</th><th>事件</th><th>点数</th><th>余额</th><th>冻结</th></tr></thead>
          <tbody><tr v-for="item in report.ledger" :key="`${item.source}-${item.id}`">
            <td>{{ item.id }}</td><td>{{ item.referenceId }}</td><td>{{ name(item.organizationId) }}</td><td>{{ item.createdAt }}</td><td>{{ item.source }}</td><td>{{ item.event }}</td><td>{{ item.amount }}</td><td>{{ item.balanceAfter }}</td><td>{{ item.frozenAfter }}</td>
          </tr></tbody>
        </table></div></section>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { ElButton } from 'element-plus';

type Row = Record<string, string>;
type Report = {
  organizations: { id: string; name: string }[];
  transactions: Row[];
  sales: Row[];
  expenses: Row[];
  procurement: Row[];
  ledger: Row[];
  inventory: Row | null;
  totals: { salesGrossProfit: string; platformExpenses: string; afterPlatformExpenses: string };
};
const props = defineProps<{ request: (path: string) => Promise<unknown>; kind: 'profit' | 'ledger' }>();
const report = shallowRef<Report | null>(null);
const error = shallowRef('');
function name(id: string) {
  return report.value?.organizations.find(item =>
    item.id === id)?.name ?? id;
}
async function load() {
  try {
    report.value = await props.request('reports') as Report;
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '报表加载失败';
  }
}
onMounted(load);
</script>

<style scoped>
.platform-report { margin: 20px 0 32px; min-width: 0; color: #1c2333; }
.report-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
.report-refresh { height: 34px; border-color: #e6e9f0; border-radius: 8px; }
.back-link { order: -1; margin-right: auto; color: #738095; font-size: 13px; text-decoration: none; }
.back-link:hover { color: #4356e0; }
.export-link { display: inline-flex; align-items: center; min-height: 32px; padding: 0 15px; border: 1px solid #4356e0; border-radius: 8px; background: #4356e0; color: #fff; font-size: 13px; font-weight: 600; text-decoration: none; }
.export-link:hover { background: #3343c9; }
.back-link:focus-visible, .export-link:focus-visible { outline: 2px solid #8997ff; outline-offset: 3px; }
.report-error { padding: 12px 14px; border: 1px solid #f1d2d2; border-radius: 8px; background: #fff5f5; color: #b43f3f; }
.totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
.totals p { min-width: 0; margin: 0; padding: 18px 20px; border: 1px solid #e6e9f0; border-radius: 11px; background: #fff; }
.totals p:last-child { border-color: #dce2ff; background: #f7f8ff; }
.totals span { display: block; color: #738095; font-size: 12px; }
.totals strong { display: block; margin-top: 8px; color: #3d4963; font: 600 22px/1.35 'Segoe UI', 'Microsoft YaHei', sans-serif; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.totals p:last-child strong { color: #4356e0; }
.report-panel { min-width: 0; margin: 20px 0; padding: 23px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
.report-panel h2 { margin: 0 0 16px; color: #1c2333; font-size: 16px; font-weight: 650; }
.table-wrap { max-width: 100%; overflow-x: auto; }
.platform-report table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.platform-report th, .platform-report td { padding: 15px 13px; border-bottom: 1px solid #edf0f6; text-align: left; vertical-align: top; white-space: nowrap; }
.platform-report th { background: #f8f9fc; color: #8b96a8; font-weight: 500; }
.platform-report tbody tr:hover { background: #fafbff; }
.inventory { padding: 14px 16px; border: 1px solid #edf0f6; border-radius: 8px; background: #f8f9fc; color: #536078; font-variant-numeric: tabular-nums; }
.expense-row { padding: 12px 0; border-bottom: 1px solid #edf0f6; color: #536078; overflow-wrap: anywhere; }
.empty-state { padding: 20px 12px 8px; color: #8a95a6; text-align: center; font-size: 13px; }
@media (max-width: 680px) {
  .totals { grid-template-columns: 1fr; }
  .report-panel { padding: 18px 14px; }
}
</style>
