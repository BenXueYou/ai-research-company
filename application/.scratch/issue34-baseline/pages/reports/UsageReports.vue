<template>
  <section class="usage-reports">
    <header>
      <h2>用量与账务</h2>
      <el-button @click="load">刷新</el-button>
      <a v-if="report?.role !== 'terminal' && report" href="/api/reports/own-ledger.csv" download="own-ledger.csv">导出自有账务</a>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <div v-if="report.totals" class="report-totals">
        <p>平台销售毛利：{{ report.totals.salesGrossProfit }}</p>
        <p>平台承担费用：{{ report.totals.platformExpenses }}</p>
        <p>扣除平台承担费用后：{{ report.totals.afterPlatformExpenses }}</p>
      </div>
      <p v-if="report.grossProfit !== undefined">自有交易毛利：{{ report.grossProfit }}</p>
      <h3>账户余额与冻结</h3>
      <table><thead><tr><th v-if="report.role !== 'terminal'">组织</th><th>余额</th><th>查询冻结</th>
        <th v-if="report.role !== 'terminal'">销售预留</th><th v-if="report.role !== 'terminal'">可用</th></tr></thead>
        <tbody><tr v-for="(item, index) in report.accounts" :key="item.organizationId ?? index">
          <td v-if="report.role !== 'terminal'">{{ name(item.organizationId) }}</td>
          <td>{{ item.balance }}</td><td>{{ item.queryFrozen }}</td>
          <td v-if="report.role !== 'terminal'">{{ item.salesReserved }}</td>
          <td v-if="report.role !== 'terminal'">{{ item.available }}</td>
        </tr></tbody>
      </table>
      <h3>扣点与退款流水</h3>
      <table><thead><tr><th>时间</th><th>来源</th><th>事件</th><th>点数</th><th>余额</th><th>冻结</th></tr></thead>
        <tbody><tr v-for="item in report.ledger" :key="`${item.source}-${item.id}`">
          <td>{{ item.createdAt }}</td><td>{{ item.source }}</td><td>{{ item.event }}</td>
          <td>{{ item.amount }}</td><td>{{ item.balanceAfter }}</td><td>{{ item.frozenAfter }}</td>
        </tr></tbody>
      </table>
      <template v-if="report.role !== 'terminal'">
        <h3>组织范围</h3>
        <p v-for="item in report.organizations" :key="item.id">
          {{ item.name }} · {{ item.kind }} · {{ item.active ? '启用' : '停用' }}
        </p>
        <h3>交易与汇总用量</h3>
        <table><thead><tr><th>卖方</th><th>买方</th><th>数量</th><th>金额</th><th>状态</th></tr></thead>
          <tbody><tr v-for="item in report.transactions" :key="item.id">
            <td>{{ name(item.sellerId) }}</td><td>{{ name(item.buyerId) }}</td><td>{{ item.quantity }}</td>
            <td>{{ item.amount }}</td><td>{{ item.status }}</td>
          </tr></tbody>
        </table>
        <p v-for="item in report.usage" :key="`${item.organizationId}-${item.source}`">
          {{ name(item.organizationId) }} · {{ item.source }}：{{ item.chargedPoints }} 点
        </p>
        <p v-for="item in report.emailUsage" :key="`${item.organizationId}-${item.usageDay}`">
          {{ name(item.organizationId) }} · {{ item.usageDay }} 邮件：已用 {{ item.used }}，预占 {{ item.reserved }}
        </p>
      </template>
      <template v-if="report.role === 'platform'">
        <h3>平台库存与采购流水</h3>
        <p v-if="report.inventory">库存 {{ report.inventory.balance }}，冻结 {{ report.inventory.frozen }}，预留 {{ report.inventory.reserved }}</p>
        <p v-for="item in report.procurement" :key="item.id">{{ item.event }} · {{ item.reference }} · {{ item.cashOutflow }}</p>
        <h3>平台承担费用</h3>
        <p v-for="item in report.expenses" :key="item.id">{{ item.purpose }} · {{ item.amount }} · {{ item.sourceReference }}</p>
        <h3>客户与邮件全链概览</h3>
        <details v-for="item in report.customers" :key="item.id">
          <summary>{{ name(item.organizationId) }} · {{ item.name }} · {{ item.customerStatus }}</summary>
          <p>主营产品：{{ item.mainProducts }}；采购需求：{{ item.purchasingNeeds }}；合作意向：{{ item.cooperationIntent }}</p>
          <pre>{{ item.detail }}</pre>
        </details>
        <details v-for="item in report.emails" :key="item.recipientId">
          <summary>{{ name(item.organizationId) }} · {{ item.channelKind }} · {{ item.status }} · {{ item.email }}</summary>
          <p>{{ item.subject }}</p><pre>{{ item.content }}</pre>
        </details>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { ElButton } from 'element-plus';

type Row = Record<string, string>;
type Report = {
  role: 'terminal' | 'distributor' | 'platform';
  organizations?: { id: string; name: string; kind: string; active: boolean }[];
  accounts: Row[];
  ledger: Row[];
  transactions?: Row[];
  usage?: Row[];
  emailUsage?: Row[];
  expenses?: Row[];
  customers?: Row[];
  emails?: Row[];
  procurement?: Row[];
  inventory?: Row;
  grossProfit?: string;
  totals?: { salesGrossProfit: string; platformExpenses: string; afterPlatformExpenses: string };
};
const props = defineProps<{ request: (path: string) => Promise<unknown> }>();
const report = shallowRef<Report | null>(null);
const error = shallowRef('');
function name(id: string) {
  return report.value?.organizations?.find(item => item.id === id)?.name ?? id;
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
.usage-reports { margin: 24px 0; padding: 24px; background: #fff; border-radius: 12px; }
.usage-reports header { display: flex; align-items: center; gap: 16px; }
.usage-reports table { width: 100%; border-collapse: collapse; }
.usage-reports th, .usage-reports td { padding: 8px; border-bottom: 1px solid #ddd; text-align: left; }
.report-totals { display: flex; gap: 24px; }
</style>
