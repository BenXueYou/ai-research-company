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
import { useFormLeave } from '../../router/formLeave';
import { HttpError } from '../../api/http';

defineOptions({ name: 'PlatformProcurement' });

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
  expense: 'procurement/expenses'
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
type Operation = 'purchase' | 'expense';
interface Attempt {
  operation: Operation;
  payload: string;
  requestId: string;
}
const pending = new Map<Operation, Attempt>();
const unknown = shallowRef<Attempt[]>([]);
const submitting = ref(false);
const baseline = { purchase: JSON.stringify(purchase), expense: JSON.stringify(expense) };
function discard() {
  Object.assign(purchase, JSON.parse(baseline.purchase));
  Object.assign(expense, JSON.parse(baseline.expense));
}
useFormLeave({
  state: () => submitting.value ? 'submitting' : unknown.value.length ? 'unknown' :
    JSON.stringify(purchase) !== baseline.purchase || JSON.stringify(expense) !== baseline.expense ? 'dirty' : 'clean',
  discard,
  retainUnknown: true
});
const purposes: Record<string, string> = {
  sale: '销售库存',
  coverage: '补足额度',
  failure: '失败费用',
  excess: '超额费用'
};
async function refresh() {
  snapshot.value = await props.request('procurement') as ProcurementSnapshot;
}
async function submit(operation: Operation, values: Record<string, string>, original?: Attempt) {
  if (busy.value) return;
  busy.value = true;
  submitting.value = true;
  error.value = '';
  notice.value = '';
  const payload = JSON.stringify(values);
  let attempt = original ?? pending.get(operation);
  if (!attempt || attempt.payload !== payload) {
    attempt = { operation, payload, requestId: crypto.randomUUID() };
    pending.set(operation, attempt);
  }
  try {
    await props.request(procurementPaths[operation], { ...values, requestId: attempt.requestId });
  } catch (failure) {
    if (!(failure instanceof HttpError) || failure.status >= 500) {
      if (!unknown.value.some(item =>
        item.requestId === attempt.requestId
      )) unknown.value = [...unknown.value, attempt];
    }
    error.value = failure instanceof Error ? failure.message : '网络异常，请使用原请求核对';
    submitting.value = false;
    busy.value = false;
    return;
  }
  unknown.value = unknown.value.filter(item =>
    item.requestId !== attempt.requestId
  );
  // The acknowledged payload may be an older uncertain attempt, not the current draft.
  const currentValues = operation === 'purchase' ? purchaseValues() : expenseValues();
  if (JSON.stringify(currentValues) === payload) baseline[operation] = JSON.stringify(operation === 'purchase' ? purchase : expense);
  notice.value = '已记账';
  submitting.value = false;
  try {
    await refresh();
    notice.value = '已记账，余额和流水已更新';
  } catch (failure) {
    error.value = failure instanceof Error ? `已记账，账务刷新失败：${failure.message}` : '已记账，请主动刷新核对账务';
  } finally {
    busy.value = false;
  }
}
function expenseValues(): Record<string, string> {
  return {
    purpose: expense.purpose,
    amount: expense.amount,
    sourceReference: expense.sourceReference,
    evidence: expense.evidence,
    ...(expense.detailLossQueryId ? { detailLossQueryId: expense.detailLossQueryId } : {}),
    ...(expense.contactLossQueryId ? { contactLossQueryId: expense.contactLossQueryId } : {}),
    ...(expense.productLossPageId ? { productLossPageId: expense.productLossPageId } : {})
  };
}
function retry(attempt: Attempt) {
  return submit(attempt.operation, JSON.parse(attempt.payload), attempt);
}
function purchaseValues(): Record<string, string> {
  const values: Record<string, string> = {
    purpose: purchase.purpose,
    upstreamPoints: purchase.upstreamPoints,
    amount: purchase.amount,
    receiptReference: purchase.receiptReference,
    evidence: purchase.evidence
  };
  if (purchase.purpose !== 'sale' && purchase.expenseId) values.expenseId = purchase.expenseId;
  return values;
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
    <header class="procurement-heading">
      <div>
        <p class="eyebrow">点数与账务 / 平台运营</p>
        <h2 id="procurement-title">平台采购与承担费用</h2>
        <p class="procurement-intro">统一登记采购、费用来源与库存成本，保留每笔关联和账务流水。</p>
      </div>
      <ElButton class="refresh-button" :disabled="busy" @click="reload"><span aria-hidden="true">↻</span>刷新账务</ElButton>
    </header>
    <ElAlert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <ElAlert
      v-if="notice"
      :title="notice"
      type="success"
      :closable="false"
    />
    <div v-if="unknown.length" role="alert">
      <p>提交结果尚未确认。离开不会取消或重试请求；返回后可刷新账务，或使用原请求核对，避免重复入账。</p>
      <div v-for="attempt in unknown" :key="attempt.requestId">
        <p>{{ attempt.operation === 'purchase' ? '采购' : '费用' }} · {{ attempt.requestId }}</p>
        <p>{{ purposes[JSON.parse(attempt.payload).purpose] }} · {{ JSON.parse(attempt.payload).amount }} 元 ·
          {{ JSON.parse(attempt.payload).receiptReference || JSON.parse(attempt.payload).sourceReference }}</p>
        <ElButton :disabled="busy" @click="retry(attempt)">使用原请求核对</ElButton>
      </div>
    </div>
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
      <fieldset class="procurement-forms" :disabled="busy">
        <ElForm label-position="top" @submit.prevent="submit('purchase', purchaseValues())">
          <h3>采购入账</h3>
          <ElFormItem label="采购用途" for="purchase-purpose">
            <select
              id="purchase-purpose"
              v-model="purchase.purpose"
              :disabled="busy"
            >
              <option value="sale">销售库存</option>
              <option value="coverage">补足额度</option>
              <option value="failure">失败费用</option>
              <option value="excess">超额费用</option>
            </select>
          </ElFormItem>
          <ElFormItem label="采购上游点数" for="purchase-points">
            <ElInput
              id="purchase-points"
              v-model="purchase.upstreamPoints"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="采购人民币金额" for="purchase-amount">
            <ElInput
              id="purchase-amount"
              v-model="purchase.amount"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="采购凭证编号" for="purchase-reference">
            <ElInput
              id="purchase-reference"
              v-model="purchase.receiptReference"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="采购核对依据" for="purchase-evidence">
            <ElInput
              id="purchase-evidence"
              v-model="purchase.evidence"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem v-if="purchase.purpose !== 'sale'" label="关联已记费用" for="purchase-expense">
            <select
              id="purchase-expense"
              v-model="purchase.expenseId"
              :disabled="busy"
            >
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
        <ElForm label-position="top" @submit.prevent="submit('expense', expenseValues())">
          <h3>平台承担费用</h3>
          <ElFormItem label="费用用途" for="expense-purpose">
            <select
              id="expense-purpose"
              v-model="expense.purpose"
              :disabled="busy"
            >
              <option value="failure">失败费用</option>
              <option value="excess">超额费用</option>
              <option value="coverage">补足额度</option>
            </select>
          </ElFormItem>
          <ElFormItem label="费用人民币金额" for="expense-amount">
            <ElInput
              id="expense-amount"
              v-model="expense.amount"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="费用来源编号" for="expense-reference">
            <ElInput
              id="expense-reference"
              v-model="expense.sourceReference"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="费用核对依据" for="expense-evidence">
            <ElInput
              id="expense-evidence"
              v-model="expense.evidence"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="关联企业详情损耗查询标识" for="expense-detail-loss">
            <ElInput
              id="expense-detail-loss"
              v-model="expense.detailLossQueryId"
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="关联联系人页损耗查询标识" for="expense-contact-loss">
            <ElInput
              id="expense-contact-loss"
              v-model="expense.contactLossQueryId"
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem label="关联产品名单损耗页标识" for="expense-product-loss">
            <ElInput
              id="expense-product-loss"
              v-model="expense.productLossPageId"
              :disabled="busy"
            />
          </ElFormItem>
          <ElButton native-type="submit" :disabled="busy">确认费用</ElButton>
        </ElForm>
      </fieldset>
      <section class="data-card">
        <div class="section-heading"><div><p class="eyebrow">费用管理</p><h3>费用来源与核对</h3></div><span class="section-count">{{ snapshot.expenses.length }} 条</span></div>
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
      </section>
      <section class="data-card">
        <div class="section-heading"><div><p class="eyebrow">采购记录</p><h3>采购及费用关联</h3></div><span class="section-count">{{ snapshot.purchases.length }} 条</span></div>
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
      </section>
      <section class="data-card">
        <div class="section-heading"><div><p class="eyebrow">审计留痕</p><h3>只增账务流水</h3></div><span class="section-count">{{ snapshot.ledger.length }} 条</span></div>
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
      </section>
    </template>
  </section>
</template>

<style scoped>
.procurement-panel {
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  color: #1c2333;
}

.procurement-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin: 2px 0 24px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #7b879b;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.procurement-heading h2 {
  margin: 0;
  color: #1c2333;
  font-size: 24px;
  line-height: 1.35;
  letter-spacing: -.4px;
}

.procurement-intro {
  margin: 7px 0 0;
  color: #738095;
  font-size: 13px;
  line-height: 1.7;
}

.refresh-button {
  flex: none;
  min-height: 36px;
  color: #4356e0;
  border-color: #dce2ff;
  background: #f4f6ff;
}

.refresh-button span {
  margin-right: 6px;
  font-size: 17px;
}

.procurement-panel > .el-alert,
.procurement-panel > [role='alert'] {
  margin-bottom: 16px;
}

.procurement-balances,
.data-card,
.procurement-forms {
  border: 1px solid #e6e9f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 5px #19234603;
}

.procurement-balances,
.procurement-forms {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 0 0 20px;
  padding: 0;
}

.procurement-balances > div {
  min-width: 0;
  padding: 18px 20px;
  border-right: 1px solid #edf0f5;
}

.procurement-balances > div:nth-child(4n) {
  border-right: 0;
}

.procurement-balances dt {
  color: #7b879b;
  font-size: 12px;
}

.procurement-balances dd {
  margin: 8px 0;
  color: #26334d;
  font: 600 22px/1.3 'Segoe UI', Consolas, monospace;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.procurement-forms {
  min-width: 0;
  margin: 0;
  padding: 20px;
  gap: 28px;
  border: 1px solid #e6e9f0;
  background: #fff;
  box-shadow: 0 2px 5px #19234603;
}

.procurement-forms h3,
.data-card h3 {
  margin: 0;
  color: #26334d;
  font-size: 15px;
  line-height: 1.5;
}

.data-card {
  margin-top: 20px;
  padding: 20px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-count {
  padding: 4px 9px;
  border-radius: 6px;
  color: #6372a4;
  background: #f3f5ff;
  font-size: 11px;
  white-space: nowrap;
}

.procurement-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  color: #465064;
  font-size: 12px;
}

th,
td {
  padding: 12px 10px;
  border-bottom: 1px solid #edf0f5;
  text-align: left;
  overflow-wrap: anywhere;
}

th {
  color: #7b879b;
  background: #f8f9fc;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

tbody tr:hover {
  background: #f8f9ff;
}

select {
  width: 100%;
  min-height: 36px;
  border: 1px solid #dfe4ec;
  border-radius: 7px;
  color: #35415b;
  background: #fff;
}

.procurement-panel :deep(.el-form-item__label) {
  color: #647087;
  font-size: 12px;
  font-weight: 600;
}

.procurement-panel :deep(.el-input__wrapper) {
  border-radius: 7px;
  box-shadow: 0 0 0 1px #dfe4ec inset;
}

.procurement-panel :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #7d8cf0 inset, 0 0 0 3px #eef1ff;
}

@media (max-width: 980px) {
  .procurement-balances {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .procurement-balances > div:nth-child(2n) {
    border-right: 0;
  }

  .procurement-balances > div:nth-child(-n + 2) {
    border-bottom: 1px solid #edf0f5;
  }
}

@media (max-width: 720px) {
  .procurement-heading {
    align-items: flex-start;
    flex-direction: column;
    margin-bottom: 20px;
  }

  .procurement-heading h2 {
    font-size: 22px;
  }

  .procurement-balances > div {
    padding: 15px 14px;
  }

  .procurement-balances dd {
    font-size: 18px;
  }

  .procurement-forms,
  .data-card {
    padding: 16px;
  }

  .data-card {
    margin-top: 16px;
  }
}
</style>
