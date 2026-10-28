<template>
  <section class="platform-report">
    <header>
      <h1>{{ kind === 'profit' ? '交易与利润' : '账务流水' }}</h1>
      <el-button @click="load">刷新</el-button>
      <RouterLink to="/platform/ledger">返回点数与账务</RouterLink>
      <a href="/api/reports/own-ledger.csv" download="own-ledger.csv">导出自有账务</a>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <template v-if="kind === 'profit'">
        <div class="totals">
          <p>平台销售毛利：{{ report.totals.salesGrossProfit }}</p>
          <p>平台承担费用：{{ report.totals.platformExpenses }}</p>
          <p>扣除平台承担费用后：{{ report.totals.afterPlatformExpenses }}</p>
        </div>
        <h2>授权交易</h2>
        <table><thead><tr><th>订单</th><th>卖方</th><th>买方</th><th>数量</th><th>金额</th><th>状态</th></tr></thead>
          <tbody><tr v-for="item in report.transactions" :key="item.id">
            <td>{{ item.id }}</td><td>{{ name(item.sellerId) }}</td><td>{{ name(item.buyerId) }}</td><td>{{ item.quantity }}</td><td>{{ item.amount }}</td><td>{{ item.status }}</td>
          </tr></tbody>
        </table>
        <h2>销售毛利明细</h2>
        <table><thead><tr><th>订单</th><th>卖方</th><th>买方</th><th>销售金额</th><th>销售成本</th><th>毛利</th></tr></thead>
          <tbody><tr v-for="item in report.sales" :key="item.orderId">
            <td>{{ item.orderId }}</td><td>{{ name(item.sellerId) }}</td><td>{{ name(item.buyerId) }}</td><td>{{ item.salesAmount }}</td><td>{{ item.salesCost }}</td><td>{{ item.grossProfit }}</td>
          </tr></tbody>
        </table>
        <h2>平台承担费用</h2>
        <p v-for="item in report.expenses" :key="item.id">{{ item.id }} · {{ item.purpose }} · {{ item.amount }} · {{ item.sourceReference }}</p>
      </template>
      <template v-else>
        <h2>平台库存与采购流水</h2>
        <p v-if="report.inventory">库存 {{ report.inventory.balance }}，冻结 {{ report.inventory.frozen }}，预留 {{ report.inventory.reserved }}</p>
        <table><thead><tr><th>流水</th><th>业务引用</th><th>事件</th><th>内部点数</th><th>上游点数</th><th>现金支出</th><th>费用</th><th>余额</th></tr></thead>
          <tbody><tr v-for="item in report.procurement" :key="item.id">
            <td>{{ item.id }}</td><td>{{ item.reference }}</td><td>{{ item.event }}</td><td>{{ item.internalDelta }}</td><td>{{ item.upstreamDelta }}</td><td>{{ item.cashOutflow }}</td><td>{{ item.expenseDelta }}</td><td>{{ item.balanceAfter }}</td>
          </tr></tbody>
        </table>
        <h2>扣点与退款流水</h2>
        <table><thead><tr><th>流水</th><th>业务引用</th><th>组织</th><th>时间</th><th>来源</th><th>事件</th><th>点数</th><th>余额</th><th>冻结</th></tr></thead>
          <tbody><tr v-for="item in report.ledger" :key="`${item.source}-${item.id}`">
            <td>{{ item.id }}</td><td>{{ item.referenceId }}</td><td>{{ name(item.organizationId) }}</td><td>{{ item.createdAt }}</td><td>{{ item.source }}</td><td>{{ item.event }}</td><td>{{ item.amount }}</td><td>{{ item.balanceAfter }}</td><td>{{ item.frozenAfter }}</td>
          </tr></tbody>
        </table>
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
.platform-report { margin: 24px 0; padding: 24px; background: #fff; border-radius: 12px; overflow-x: auto; }
.platform-report header, .totals { display: flex; align-items: center; gap: 16px; }
.platform-report table { width: 100%; border-collapse: collapse; }
.platform-report th, .platform-report td { padding: 8px; border-bottom: 1px solid #ddd; text-align: left; }
</style>
