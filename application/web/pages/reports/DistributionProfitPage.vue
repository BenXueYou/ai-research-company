<template>
  <section class="distribution-profit" aria-label="分销交易与利润">
    <header class="report-toolbar">
      <div class="report-heading">
        <span class="module-kicker">TRANSACTIONS &amp; PROFIT</span>
        <h1>交易与利润</h1>
        <p>查看自有交易毛利、授权范围内的账户与汇总用量。</p>
      </div>
      <div class="report-actions">
        <el-button :disabled="loading" @click="load">刷新报表</el-button>
        <a
          v-if="report"
          class="export-button"
          href="/api/reports/own-ledger.csv"
          download="own-ledger.csv"
        >导出自有账务</a>
      </div>
    </header>
    <p v-if="loading" role="status">正在读取报表…</p>
    <p v-if="error" class="report-error" role="alert">{{ error }}</p>
    <template v-if="report">
      <div class="metric-card">
        <span class="metric-label">自有交易毛利：</span><strong>{{ report.grossProfit ?? '数据缺失' }}</strong>
        <p>历史交易成本与毛利不因后续采购重算。</p>
      </div>
      <DistributionReportTable
        v-for="table in tables"
        :key="table.key"
        :title="table.title"
        :columns="table.columns"
        :rows="report[table.key]"
        :organization-name="name"
      />
      <section class="scope-card">
        <h2>组织范围</h2>
        <p v-for="item in report.organizations" :key="item.id">{{ item.name }} · {{ item.kind }} · {{ item.active ? '启用' : '停用' }}</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue';
import { ElButton } from 'element-plus';
import { readDistributionProfit, type DistributionReport } from '../../api/distributionProfit';
import DistributionReportTable from './components/DistributionReportTable.vue';

const props = defineProps<{ request: (path: string) => Promise<unknown> }>();
const report = shallowRef<DistributionReport | null>(null);
const loading = shallowRef(false);
const error = shallowRef('');
let active = true;
const column = (key: string, label: string) => ({ key, label });
const tables: { key: 'accounts' | 'transactions' | 'sales' | 'usage' | 'emailUsage' | 'ledger'; title: string; columns: { key: string; label: string }[] }[] = [
  { key: 'accounts', title: '账户余额与冻结', columns: [column('organizationId', '组织'), column('balance', '余额'), column('queryFrozen', '查询冻结'), column('salesReserved', '销售预留'), column('available', '可用')] },
  { key: 'transactions', title: '授权交易', columns: [column('id', '订单'), column('sellerId', '卖方'), column('buyerId', '买方'), column('quantity', '数量'), column('amount', '金额'), column('status', '状态')] },
  { key: 'sales', title: '自有销售毛利明细', columns: [column('orderId', '订单'), column('sellerId', '卖方'), column('buyerId', '买方'), column('salesAmount', '销售金额'), column('salesCost', '销售成本'), column('grossProfit', '毛利')] },
  { key: 'usage', title: '查询汇总用量', columns: [column('organizationId', '组织'), column('source', '来源'), column('chargedPoints', '点数')] },
  { key: 'emailUsage', title: '邮件汇总用量', columns: [column('organizationId', '组织'), column('usageDay', '日期'), column('used', '已用'), column('reserved', '预占')] },
  { key: 'ledger', title: '自有扣点与退款流水', columns: [column('id', '流水'), column('referenceId', '业务引用'), column('createdAt', '时间'), column('source', '来源'), column('event', '事件'), column('amount', '点数'), column('balanceAfter', '余额'), column('frozenAfter', '冻结')] }
];
function name(id: string) {
  return report.value?.organizations.find(item =>
    item.id === id
  )?.name ?? id;
}
async function load() {
  if (loading.value) return;
  loading.value = true;
  report.value = null;
  error.value = '';
  try {
    const result = await readDistributionProfit(props.request);
    if (active) report.value = result;
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : '报表加载失败，请刷新重试';
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(load);
onUnmounted(() => { active = false; });
</script>

<style scoped>
.distribution-profit { min-width: 0; color: #1c2333; }
.report-toolbar, .report-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.report-toolbar { align-items: flex-end; flex-wrap: wrap; margin-bottom: 20px; }
.module-kicker { display: block; margin-bottom: 9px; color: #9ba6bd; font-size: 10px; letter-spacing: 1.5px; }
.report-heading h1 { margin: 0 0 7px; font-size: 24px; line-height: 1.4; letter-spacing: -.4px; }
.report-toolbar p { margin: 0; color: #738095; font-size: 13px; }
.report-actions { flex: none; }
.export-button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 8px 15px; border: 1px solid #4356e0; border-radius: 8px; color: #fff; background: #4356e0; font-size: 14px; font-weight: 600; text-decoration: none; }
.export-button:hover { border-color: #3343c9; background: #3343c9; }
.metric-card, .scope-card { padding: 23px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
.metric-label { display: block; margin-bottom: 7px; color: #738095; font-size: 12px; }
.metric-card strong { color: #4356e0; font: 600 28px/1.4 'Segoe UI', Consolas, monospace; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-card p { margin: 8px 0 0; color: #8a95a6; font-size: 12px; }
.scope-card { margin-top: 20px; }
.scope-card h2 { margin: 0 0 16px; font-size: 16px; }
.scope-card p { margin: 0; padding: 14px 0; border-top: 1px solid #edf0f6; color: #738095; font-size: 13px; overflow-wrap: anywhere; }
.report-error { color: #a13d49; }
@media (max-width: 640px) {
  .report-toolbar { align-items: flex-start; flex-direction: column; }
  .report-heading h1 { font-size: 21px; }
  .report-actions { flex-wrap: wrap; gap: 10px; }
  .metric-card, .scope-card { padding: 18px; }
}
</style>
