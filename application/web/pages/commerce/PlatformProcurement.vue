<script setup lang="ts">
import {
  onMounted,
  reactive,
  ref,
  shallowRef
} from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

interface ProcurementSnapshot {
  currency: string;
  pricing: { coefficient: string; minimum_markup: string };
  inventory: { balance: string; frozen: string; reserved: string; available: string; average_cost: string; minimum_sale_price: string };
  totals: { recorded_upstream_credits: string; cash_outflow: string; expenses: string };
  prices: { interface_path: string; upstream_unit_price: string; maximum_billable_units: number; evidence: string; version: string }[];
  purchases: { id: string; purpose: string; receipt_reference: string; upstream_points: string; coefficient_snapshot: string; generated_internal_points: string; amount: string; expense_id: string | null }[];
  expenses: { id: string; purpose: string; source_reference: string; amount: string; evidence: string; purchase_ids: string[]; replenished_amount: string; reconciliation_difference: string }[];
  ledger: { id: string; event: string; reference: string; internal_delta: string; upstream_delta: string; cash_outflow: string; expense_delta: string; balance_after: string; average_cost_after: string }[];
}
type ProcurementRequest = (path: string, body?: Record<string, string>) => Promise<unknown>;

const props = defineProps<{ request: ProcurementRequest }>();
const procurementPaths = {
  purchase: 'procurement/purchases',
  expense: 'procurement/expenses',
  pricing: 'procurement/pricing'
} as const;
const snapshot = shallowRef<ProcurementSnapshot>();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const purchase = reactive({
  purpose: 'sale',
  upstreamPoints: '',
  amount: '',
  receiptReference: '',
  evidence: '',
  expenseId: ''
});
const expense = reactive({
  purpose: 'failure',
  amount: '',
  sourceReference: '',
  evidence: '',
  detailLossQueryId: '',
  contactLossQueryId: '',
  productLossPageId: ''
});
const pricing = reactive({
  minimumMarkup: '',
  interfacePath: '',
  upstreamUnitPrice: '',
  maximumBillableUnits: '',
  evidenceType: 'supplier_verified',
  evidence: ''
});
// Retain the same key and payload after network uncertainty; edits receive a new key.
const pending = new Map<string, { payload: string; requestId: string }>();
const purposes: Record<string, string> = {
  sale: '销售库存',
  coverage: '补足额度',
  failure: '失败费用',
  excess: '超额费用'
};
async function refresh() {
  snapshot.value = await props.request('procurement') as ProcurementSnapshot;
}
async function submit(operation: 'purchase' | 'expense' | 'pricing', values: Record<string, string>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const payload = JSON.stringify(values);
  let attempt = pending.get(operation);
  if (!attempt || attempt.payload !== payload) {
    attempt = { payload, requestId: crypto.randomUUID() };
    pending.set(operation, attempt);
  }
  try {
    await props.request(procurementPaths[operation], { ...values, requestId: attempt.requestId });
    notice.value = '已记账，余额和流水已更新';
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '网络异常，请使用原表单重试核对';
  } finally {
    busy.value = false;
  }
}
function submitPurchase() {
  const values: Record<string, string> = {
    purpose: purchase.purpose,
    upstreamPoints: purchase.upstreamPoints,
    amount: purchase.amount,
    receiptReference: purchase.receiptReference,
    evidence: purchase.evidence
  };
  if (purchase.purpose !== 'sale' && purchase.expenseId) values.expenseId = purchase.expenseId;
  return submit('purchase', values);
}
function submitPricing() {
  const values: Record<string, string> = { evidence: pricing.evidence };
  if (pricing.minimumMarkup) values.minimumMarkup = pricing.minimumMarkup;
  if (pricing.interfacePath) {
    values.interfacePath = pricing.interfacePath;
    values.upstreamUnitPrice = pricing.upstreamUnitPrice;
    values.maximumBillableUnits = pricing.maximumBillableUnits;
    values.evidenceType = pricing.evidenceType;
  }
  return submit('pricing', values);
}
async function reload() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try { await refresh(); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '采购信息加载失败'; }
  finally { busy.value = false; }
}
onMounted(reload);
</script>

<template>
  <section class="procurement-panel" aria-labelledby="procurement-title">
    <h2 id="procurement-title">平台采购与计价</h2>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert v-if="notice" :title="notice" type="success" :closable="false" />
    <template v-if="snapshot">
      <p>币种 {{ snapshot.currency }} · 入账系数 X={{ snapshot.pricing.coefficient }} · 最低加价率 {{
        snapshot.pricing.minimum_markup }}（0.01 = 1%）</p>
      <p>系数变更须通过通知、生效与覆盖校验流程。</p>
      <dl class="procurement-balances">
        <div>
          <dt>内部库存余额</dt>
          <dd data-testid="inventory-balance">{{ snapshot.inventory.balance }}</dd>
        </div>
        <div>
          <dt>可用 / 冻结 / 预留</dt>
          <dd>{{ snapshot.inventory.available }} / {{ snapshot.inventory.frozen }} / {{ snapshot.inventory.reserved }}
          </dd>
        </div>
        <div>
          <dt>移动加权成本（元/点）</dt>
          <dd data-testid="inventory-cost">{{ snapshot.inventory.average_cost }}</dd>
        </div>
        <div>
          <dt>最低售价（元/点）</dt>
          <dd data-testid="minimum-price">{{ snapshot.inventory.minimum_sale_price }}</dd>
        </div>
        <div>
          <dt>累计采购上游点数</dt>
          <dd>{{ snapshot.totals.recorded_upstream_credits }}</dd>
        </div>
        <div>
          <dt>采购资金支出（元）</dt>
          <dd data-testid="cash-outflow">{{ snapshot.totals.cash_outflow }}</dd>
        </div>
        <div>
          <dt>去重后平台承担费用（元）</dt>
          <dd data-testid="borne-expenses">{{ snapshot.totals.expenses }}</dd>
        </div>
      </dl>
      <p>上游点数为本系统已登记采购累计值；实际供应商余额须结合查询扣费账单核对。</p>
      <div class="procurement-forms">
        <ElForm label-position="top" @submit.prevent="submitPurchase">
          <h3>采购入账</h3>
          <ElFormItem label="采购用途" for="purchase-purpose">
            <select id="purchase-purpose" v-model="purchase.purpose" :disabled="busy">
              <option value="sale">销售库存</option>
              <option value="coverage">补足额度</option>
              <option value="failure">失败费用</option>
              <option value="excess">超额费用</option>
            </select>
          </ElFormItem>
          <ElFormItem label="采购上游点数" for="purchase-points">
            <ElInput id="purchase-points" v-model="purchase.upstreamPoints" required />
          </ElFormItem>
          <ElFormItem label="采购人民币金额" for="purchase-amount">
            <ElInput id="purchase-amount" v-model="purchase.amount" required />
          </ElFormItem>
          <ElFormItem label="采购凭证编号" for="purchase-reference">
            <ElInput id="purchase-reference" v-model="purchase.receiptReference" required />
          </ElFormItem>
          <ElFormItem label="采购核对依据" for="purchase-evidence">
            <ElInput id="purchase-evidence" v-model="purchase.evidence" required />
          </ElFormItem>
          <ElFormItem v-if="purchase.purpose !== 'sale'" label="关联已记费用" for="purchase-expense">
            <select id="purchase-expense" v-model="purchase.expenseId" :disabled="busy">
              <option value="">{{ purchase.purpose === 'coverage' ? '本次确认新费用' : '请先登记费用并选择关联' }}</option>
              <template v-for="item in snapshot.expenses" :key="item.id">
                <option v-if="item.purpose === purchase.purpose" :value="item.id">{{ item.source_reference }} · {{
                  item.amount }}元</option>
              </template>
            </select>
          </ElFormItem>
          <p>关联费用须与采购用途一致；已记费用可关联多笔充值，只增加资金支出与上游点数。充值合计与费用的差额单独展示供核对。</p>
          <ElButton native-type="submit" :disabled="busy">确认采购入账</ElButton>
        </ElForm>
        <ElForm label-position="top" @submit.prevent="submit('expense', {
          purpose: expense.purpose,
          amount: expense.amount,
          sourceReference: expense.sourceReference,
          evidence: expense.evidence,
          ...(expense.detailLossQueryId ? { detailLossQueryId: expense.detailLossQueryId } : {}),
          ...(expense.contactLossQueryId ? { contactLossQueryId: expense.contactLossQueryId } : {}),
          ...(expense.productLossPageId ? { productLossPageId: expense.productLossPageId } : {})
        })">
          <h3>平台承担费用</h3>
          <ElFormItem label="费用用途" for="expense-purpose">
            <select id="expense-purpose" v-model="expense.purpose" :disabled="busy">
              <option value="failure">失败费用</option>
              <option value="excess">超额费用</option>
              <option value="coverage">补足额度</option>
            </select>
          </ElFormItem>
          <ElFormItem label="费用人民币金额" for="expense-amount">
            <ElInput id="expense-amount" v-model="expense.amount" required />
          </ElFormItem>
          <ElFormItem label="费用来源编号" for="expense-reference">
            <ElInput id="expense-reference" v-model="expense.sourceReference" required />
          </ElFormItem>
          <ElFormItem label="费用核对依据" for="expense-evidence">
            <ElInput id="expense-evidence" v-model="expense.evidence" required />
          </ElFormItem>
          <ElFormItem label="关联企业详情损耗查询标识" for="expense-detail-loss">
            <ElInput id="expense-detail-loss" v-model="expense.detailLossQueryId" :disabled="busy" />
          </ElFormItem>
          <ElFormItem label="关联联系人页损耗查询标识" for="expense-contact-loss">
            <ElInput id="expense-contact-loss" v-model="expense.contactLossQueryId" :disabled="busy" />
          </ElFormItem>
          <ElFormItem label="关联产品名单损耗页标识" for="expense-product-loss">
            <ElInput id="expense-product-loss" v-model="expense.productLossPageId" :disabled="busy" />
          </ElFormItem>
          <ElButton native-type="submit" :disabled="busy">确认费用</ElButton>
        </ElForm>
        <ElForm label-position="top" @submit.prevent="submitPricing">
          <h3>基础计价配置</h3>
          <p>未配置接口保持未配置；请按已核实商务价格填写，勿录入演示值。查询报价及调用仍须经过后续查询流程。</p>
          <ElFormItem label="最低加价率" for="minimum-markup">
            <ElInput id="minimum-markup" v-model="pricing.minimumMarkup" placeholder="留空保持当前值" />
          </ElFormItem>
          <ElFormItem label="接口路径" for="price-path">
            <ElInput id="price-path" v-model="pricing.interfacePath" />
          </ElFormItem>
          <ElFormItem label="上游接口单价（上游点数/计费单位）" for="unit-price">
            <ElInput id="unit-price" v-model="pricing.upstreamUnitPrice" />
          </ElFormItem>
          <ElFormItem label="已核实本页最大计费量" for="billable-units">
            <ElInput id="billable-units" v-model="pricing.maximumBillableUnits" />
          </ElFormItem>
          <ElFormItem label="计价核实依据" for="pricing-evidence">
            <ElInput id="pricing-evidence" v-model="pricing.evidence" required />
          </ElFormItem>
          <ElFormItem label="计价依据类型" for="pricing-evidence-type">
            <select id="pricing-evidence-type" v-model="pricing.evidenceType">
              <option value="supplier_verified">已核实供应商商务依据</option>
              <option value="controlled_test">受控测试价格（生产环境禁止）</option>
            </select>
          </ElFormItem>
          <ElButton native-type="submit" :disabled="busy">保存计价配置</ElButton>
        </ElForm>
      </div>
      <h3>已配置接口单价</h3>
      <p v-if="!snapshot.prices.length">接口单价未配置，付费查询不可执行。</p>
      <ul>
        <li v-for="item in snapshot.prices" :key="item.interface_path">{{ item.interface_path }}：{{
          item.upstream_unit_price
          }} 上游点数/计费单位；本页最大 {{ item.maximum_billable_units }}；版本 {{ item.version }}</li>
      </ul>
      <h3>费用来源与核对</h3>
      <div class="procurement-scroll">
        <table>
          <thead>
            <tr>
              <th>费用记录 / 来源</th>
              <th>用途</th>
              <th>人民币</th>
              <th>核对依据</th>
              <th>关联采购</th>
              <th>充值合计 / 与费用差额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in snapshot.expenses" :key="item.id">
              <td>{{ item.id }} / {{ item.source_reference }}</td>
              <td>{{ purposes[item.purpose] }}</td>
              <td>{{ item.amount }}</td>
              <td>{{ item.evidence }}</td>
              <td>{{ item.purchase_ids.join('、') || '尚未关联充值' }}</td>
              <td>{{ item.replenished_amount }} / {{ item.reconciliation_difference }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>采购及费用关联</h3>
      <div class="procurement-scroll">
        <table>
          <thead>
            <tr>
              <th>采购记录 / 凭证</th>
              <th>用途</th>
              <th>上游点数 / X</th>
              <th>生成内部点数</th>
              <th>人民币</th>
              <th>关联费用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in snapshot.purchases" :key="item.id">
              <td>{{ item.id }} / {{ item.receipt_reference }}</td>
              <td>{{ purposes[item.purpose] }}</td>
              <td>{{ item.upstream_points }} / {{ item.coefficient_snapshot }}</td>
              <td>{{ item.generated_internal_points }}</td>
              <td>{{ item.amount }}</td>
              <td>{{ item.expense_id }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>只增账务流水</h3>
      <div class="procurement-scroll">
        <table>
          <thead>
            <tr>
              <th>流水 / 业务引用</th>
              <th>事件</th>
              <th>内部点数</th>
              <th>上游点数</th>
              <th>资金支出</th>
              <th>费用确认</th>
              <th>余额 / 成本</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in snapshot.ledger" :key="item.id">
              <td>{{ item.id }} / {{ item.reference }}</td>
              <td>{{ item.event }}</td>
              <td>{{ item.internal_delta }}</td>
              <td>{{ item.upstream_delta }}</td>
              <td>{{ item.cash_outflow }}</td>
              <td>{{ item.expense_delta }}</td>
              <td>{{ item.balance_after }} / {{ item.average_cost_after }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <ElButton :disabled="busy" @click="reload">刷新采购账务</ElButton>
  </section>
</template>

<style scoped>
.procurement-panel {
  width: 100%;
  margin-top: 24px;
  padding: 24px;
  border: 1px solid #d8e2e8;
  border-radius: 12px;
  background: #fff;
}

.procurement-balances,
.procurement-forms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 24px;
}

.procurement-balances dd {
  margin: 8px 0;
  font-weight: 600;
}

.procurement-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 10px;
  border-bottom: 1px solid #d8e2e8;
  text-align: left;
  overflow-wrap: anywhere;
}

select {
  width: 100%;
  min-height: 36px;
  border: 1px solid #b5c5ce;
  border-radius: 4px;
}
</style>
