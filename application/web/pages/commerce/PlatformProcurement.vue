<script setup lang="ts">
import 'element-plus/es/components/tabs/style/css';
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
  ElInput,
  ElTabPane,
  ElTabs
} from 'element-plus';
import { useFormLeave } from '../../router/formLeave';
import ProcurementReference from './components/ProcurementReference.vue';
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
const activeRecordTab = ref('expenses');
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
const ledgerEvents: Record<string, string> = {
  purchase: '采购入账',
  expense: '费用确认',
  pricing: '计价配置'
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
      <h2 id="procurement-title" class="visually-hidden">平台采购与承担费用</h2>
      <p class="procurement-intro">登记采购与平台承担费用，核对库存及每笔账务关联。</p>
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
      <section class="account-summary" aria-label="账务摘要">
        <dl class="procurement-balances">
          <div>
            <dt>内部库存余额（点）</dt>
            <dd data-testid="inventory-balance">{{ snapshot.inventory.balance }}</dd>
          </div>
          <div>
            <dt>可用内部点数（点）</dt>
            <dd>{{ snapshot.inventory.available }}</dd>
          </div>
          <div>
            <dt>采购资金支出（元）</dt>
            <dd data-testid="cash-outflow">{{ snapshot.totals.cash_outflow }}</dd>
          </div>
          <div>
            <dt>平台承担费用（元）</dt>
            <dd data-testid="borne-expenses">{{ snapshot.totals.expenses }}</dd>
            <span class="metric-note">已关联充值不重复确认费用</span>
          </div>
        </dl>
        <dl class="secondary-balances">
          <div><dt>冻结 / 预留（点）</dt><dd>{{ snapshot.inventory.frozen }} / {{ snapshot.inventory.reserved }}</dd></div>
          <div><dt>移动加权成本（元/点）</dt><dd data-testid="inventory-cost">{{ snapshot.inventory.average_cost }}</dd></div>
          <div><dt>最低售价（元/点）</dt><dd data-testid="minimum-price">{{ snapshot.inventory.minimum_sale_price }}</dd></div>
          <div><dt>累计采购上游点数</dt><dd>{{ snapshot.totals.recorded_upstream_credits }}</dd></div>
        </dl>
        <div class="summary-context">
          <span>币种 {{ snapshot.currency }} · 入账系数 X={{ snapshot.pricing.coefficient }} · 最低加价率 {{ snapshot.pricing.minimum_markup }}（0.01 = 1%）</span>
          <span>系数变更须通过通知、生效与覆盖校验流程。</span>
          <span>上游点数为已登记采购累计值，供应商实际余额须结合查询扣费账单核对。</span>
        </div>
      </section>
      <fieldset class="procurement-forms" :disabled="busy">
        <legend class="visually-hidden">采购入账与费用登记</legend>
        <ElForm
          class="entry-card"
          label-position="top"
          aria-labelledby="purchase-title"
          @submit.prevent="submit('purchase', purchaseValues())"
        >
          <header class="entry-heading">
            <h3 id="purchase-title">采购入账</h3>
            <p>登记采购凭证与支付金额</p>
          </header>
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
          <div class="field-row">
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
              >
                <template #suffix>元</template>
              </ElInput>
            </ElFormItem>
          </div>
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
          <div class="form-guidance">
            <p v-if="purchase.purpose === 'sale'">按当前入账系数生成内部库存点数。</p>
            <template v-else>
              <p v-if="purchase.purpose === 'coverage'">可关联已记费用，或随本次充值确认新费用。</p>
              <p v-else>请关联用途一致的已记费用，再确认采购入账。</p>
              <p>关联已记费用的充值只增加资金支出与上游点数，不重复确认费用；一笔费用可关联多笔充值。</p>
              <p>充值合计与费用差额单独展示供核对。</p>
            </template>
          </div>
          <footer class="form-actions">
            <ElButton type="primary" native-type="submit" :disabled="busy">确认采购入账</ElButton>
          </footer>
        </ElForm>
        <ElForm
          class="entry-card"
          label-position="top"
          aria-labelledby="expense-title"
          @submit.prevent="submit('expense', expenseValues())"
        >
          <header class="entry-heading">
            <h3 id="expense-title">平台承担费用</h3>
            <p>登记费用来源与核对依据</p>
          </header>
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
          <div class="field-row">
            <ElFormItem label="费用人民币金额" for="expense-amount">
              <ElInput
                id="expense-amount"
                v-model="expense.amount"
                required
                :disabled="busy"
              >
                <template #suffix>元</template>
              </ElInput>
            </ElFormItem>
            <ElFormItem label="费用来源编号" for="expense-reference">
              <ElInput
                id="expense-reference"
                v-model="expense.sourceReference"
                required
                :disabled="busy"
              />
            </ElFormItem>
          </div>
          <ElFormItem label="费用核对依据" for="expense-evidence">
            <ElInput
              id="expense-evidence"
              v-model="expense.evidence"
              required
              :disabled="busy"
            />
          </ElFormItem>
          <section class="loss-associations" aria-labelledby="loss-associations-title">
            <h4 id="loss-associations-title">损耗关联信息</h4>
            <p>如需关联损耗，请填写对应记录的标识。</p>
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
          </section>
          <footer class="form-actions">
            <ElButton type="primary" native-type="submit" :disabled="busy">确认费用</ElButton>
          </footer>
        </ElForm>
      </fieldset>
      <section class="data-card" aria-label="采购与费用明细">
        <ElTabs v-model="activeRecordTab" class="record-tabs">
          <ElTabPane name="expenses">
            <template #label><span>费用来源与核对</span><span class="section-count">{{ snapshot.expenses.length }}</span></template>
            <div
              class="procurement-scroll"
              role="region"
              aria-label="费用来源与核对"
              tabindex="0"
            >
              <table aria-label="费用来源与核对">
                <thead>
                  <tr>
                    <th>费用记录 / 来源</th>
                    <th>用途</th>
                    <th class="numeric">人民币（元）</th>
                    <th>核对依据</th>
                    <th>关联采购</th>
                    <th class="numeric">充值合计（元）</th>
                    <th class="numeric">与费用差额（元）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in snapshot.expenses" :key="item.id">
                    <td><strong class="record-reference">{{ item.source_reference }}</strong><ProcurementReference :value="item.id" /></td>
                    <td>{{ purposes[item.purpose] }}</td>
                    <td class="numeric">{{ item.amount }}</td>
                    <td>{{ item.evidence }}</td>
                    <td>
                      <ProcurementReference
                        v-for="id in item.purchase_ids"
                        :key="id"
                        :value="id"
                      />
                      <span v-if="!item.purchase_ids.length" class="muted">尚未关联充值</span>
                    </td>
                    <td class="numeric">{{ item.replenished_amount }}</td>
                    <td class="numeric">
                      {{ item.reconciliation_difference }}
                      <span v-if="/[1-9]/.test(item.reconciliation_difference)" class="reconcile-note">需核对</span>
                    </td>
                  </tr>
                  <tr v-if="!snapshot.expenses.length">
                    <td class="empty-state" colspan="7">暂无费用记录，请在上方登记平台承担费用。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ElTabPane>
          <ElTabPane name="purchases">
            <template #label><span>采购及费用关联</span><span class="section-count">{{ snapshot.purchases.length }}</span></template>
            <div
              class="procurement-scroll"
              role="region"
              aria-label="采购及费用关联"
              tabindex="0"
            >
              <table aria-label="采购及费用关联">
                <thead>
                  <tr>
                    <th>采购记录 / 凭证</th>
                    <th>用途</th>
                    <th class="numeric">上游点数</th>
                    <th class="numeric">入账系数 X</th>
                    <th class="numeric">生成内部点数（点）</th>
                    <th class="numeric">人民币（元）</th>
                    <th>关联费用</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in snapshot.purchases" :key="item.id">
                    <td><strong class="record-reference">{{ item.receipt_reference }}</strong><ProcurementReference :value="item.id" /></td>
                    <td>{{ purposes[item.purpose] }}</td>
                    <td class="numeric">{{ item.upstream_points }}</td>
                    <td class="numeric">{{ item.coefficient_snapshot }}</td>
                    <td class="numeric">{{ item.generated_internal_points }}</td>
                    <td class="numeric">{{ item.amount }}</td>
                    <td><ProcurementReference v-if="item.expense_id" :value="item.expense_id" /><span v-else class="muted">未关联费用</span></td>
                  </tr>
                  <tr v-if="!snapshot.purchases.length">
                    <td class="empty-state" colspan="7">暂无采购记录，请在上方完成采购入账。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ElTabPane>
          <ElTabPane name="ledger">
            <template #label><span>账务流水</span><span class="section-count">{{ snapshot.ledger.length }}</span></template>
            <div
              class="procurement-scroll"
              role="region"
              aria-label="账务流水"
              tabindex="0"
            >
              <table aria-label="账务流水">
                <thead>
                  <tr>
                    <th>流水 / 业务引用</th>
                    <th>事件</th>
                    <th class="numeric">内部点数（点）</th>
                    <th class="numeric">上游点数（点）</th>
                    <th class="numeric">资金支出（元）</th>
                    <th class="numeric">费用确认（元）</th>
                    <th class="numeric">库存余额（点）</th>
                    <th class="numeric">成本（元/点）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in snapshot.ledger" :key="item.id">
                    <td><ProcurementReference :value="item.id" /><ProcurementReference :value="item.reference" /></td>
                    <td>{{ ledgerEvents[item.event] ?? item.event }}</td>
                    <td class="numeric">{{ item.internal_delta }}</td>
                    <td class="numeric">{{ item.upstream_delta }}</td>
                    <td class="numeric">{{ item.cash_outflow }}</td>
                    <td class="numeric">{{ item.expense_delta }}</td>
                    <td class="numeric">{{ item.balance_after }}</td>
                    <td class="numeric">{{ item.average_cost_after }}</td>
                  </tr>
                  <tr v-if="!snapshot.ledger.length">
                    <td class="empty-state" colspan="8">暂无账务流水，采购入账或确认费用后可在此查看。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ElTabPane>
        </ElTabs>
      </section>
    </template>
  </section>
</template>

<style scoped>
.procurement-panel {
  width: 100%;
  max-width: 1440px; margin: 0 auto;
  color: var(--console-text);
  font-size: 14px;
}

.visually-hidden {
  position: absolute;
  width: 1px; height: 1px; padding: 0;
  overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

.procurement-heading {
  display: flex;
  align-items: center; justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.procurement-intro {
  margin: 0;
  line-height: 1.7;
}
.refresh-button {
  flex: none;
  min-height: 40px;
  color: var(--el-color-primary);
  border-color: var(--console-line);
}
.refresh-button span {
  margin-right: 6px;
  font-size: 17px;
}
.procurement-panel > .el-alert, .procurement-panel > [role='alert'] {
  margin-bottom: 16px;
}

.account-summary, .entry-card, .data-card {
  min-width: 0;
  border: 1px solid var(--console-line);
  border-radius: 10px;
  background: var(--console-surface);
}

.account-summary {
  margin-bottom: 24px;
  overflow: hidden;
}
.procurement-balances, .secondary-balances {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0;
}

.procurement-balances > div {
  min-width: 0;
  padding: 22px 24px 18px;
  border-right: 1px solid var(--console-line);
}
.procurement-balances > div:last-child {
  border-right: 0;
}
.procurement-balances dt, .secondary-balances dt {
  color: var(--console-muted);
  font-size: 12px;
  line-height: 1.6;
}
.procurement-balances dd {
  margin: 8px 0 4px;
  font: 600 clamp(19px, 1.8vw, 28px)/1.4 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.metric-note {
  color: var(--console-muted);
  font-size: 12px;
}
.secondary-balances {
  gap: 16px 24px;
  padding: 16px 24px;
  border-top: 1px solid var(--console-line);
  background: #fafbfe;
}
.secondary-balances > div {
  min-width: 0;
}
.secondary-balances dd {
  margin: 4px 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.summary-context {
  display: flex;
  flex-wrap: wrap; gap: 6px 16px; padding: 12px 24px;
  border-top: 1px solid var(--console-line);
  color: var(--console-muted); font-size: 12px; line-height: 1.7;
}

.procurement-forms {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;
  min-width: 0;
  margin: 0; padding: 0; border: 0;
}

.entry-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
}
.entry-heading {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--console-line);
}
.entry-heading h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.5;
}
.entry-heading p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
}
.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.entry-card :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 20px;
}
.entry-card :deep(.el-form-item__label) {
  height: auto;
  margin-bottom: 8px;
  padding: 0;
  color: #52617a;
  font-size: 14px;
  line-height: 1.5;
}
.entry-card :deep(.el-form-item__content) {
  min-width: 0;
  line-height: 1.5;
}
.entry-card :deep(.el-input__wrapper) {
  min-height: 40px;
  padding: 1px 12px; border-radius: 7px;
  box-shadow: 0 0 0 1px var(--console-line-strong) inset;
}

.entry-card :deep(.el-input__inner) {
  height: 38px;
  font-size: 14px;
}
.entry-card :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset, 0 0 0 3px var(--el-color-primary-light-9);
}
.entry-card select {
  width: 100%;
  min-width: 0; height: 40px; padding: 0 12px;
  border: 1px solid var(--console-line-strong);
  border-radius: 7px;
  color: var(--console-text);
  background: var(--console-surface); font: inherit;
}

.entry-card select:focus-visible {
  outline: 3px solid var(--el-color-primary-light-7);
  outline-offset: 2px;
}
.entry-card select:disabled {
  cursor: not-allowed;
  background: var(--el-disabled-bg-color);
}
.form-guidance {
  margin-bottom: 20px;
  padding: 12px 14px;
  border-left: 3px solid #c3c9f7;
  border-radius: 0 6px 6px 0;
  background: #f5f7ff;
}
.form-guidance p {
  margin: 0;
  font-size: 12px;
  line-height: 1.8;
}
.loss-associations {
  margin: 0 0 20px;
  padding: 16px;
  border: 1px solid var(--console-line);
  border-radius: 7px;
  background: #fafbfe;
}
.loss-associations h4 {
  margin: 0;
  color: #52617a;
  font-size: 13px;
  font-weight: 600;
}
.loss-associations p {
  margin: 6px 0 16px;
  font-size: 12px;
  line-height: 1.6;
}
.loss-associations :deep(.el-form-item__label) {
  font-size: 12px;
}
.loss-associations :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid var(--console-line);
}
.form-actions .el-button {
  min-height: 40px;
  padding: 0 22px;
  font-weight: 600;
}
.data-card {
  margin-top: 24px;
  padding: 8px 24px 24px;
}
.record-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}
.record-tabs :deep(.el-tabs__item) {
  height: 52px;
  font-size: 14px;
}
.record-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background-color: var(--console-line);
}
.section-count {
  margin-left: 8px;
  padding: 2px 7px;
  border-radius: 5px;
  color: var(--console-muted);
  background: var(--console-canvas);
  font-size: 12px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.procurement-scroll {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--console-line);
  border-radius: 7px;
}
table {
  width: 100%;
  min-width: 1000px;
  border-collapse: collapse;
  color: #465064;
  font-size: 13px;
}
th, td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--console-line);
  text-align: left;
  vertical-align: top;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
th {
  color: #52617a;
  background: #f7f9fc;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
td:first-child {
  min-width: 220px;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: #fafbff;
}
.numeric {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.record-reference {
  color: var(--console-text);
  font-weight: 500;
}
.muted {
  color: var(--console-muted);
  font-size: 12px;
}
.reconcile-note {
  display: block;
  color: #97611d;
  font-size: 12px;
}
.empty-state {
  height: 132px;
  color: var(--console-muted);
  text-align: center;
  vertical-align: middle;
}

@media (max-width: 1100px) {
  .procurement-forms {
  gap: 20px;
}
  .entry-card {
  padding: 20px;
}
  .procurement-balances, .secondary-balances {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
  .procurement-balances > div:nth-child(2n) {
  border-right: 0;
}
  .procurement-balances > div:nth-child(-n + 2) {
  border-bottom: 1px solid var(--console-line);
}
}

@media (max-width: 980px) {
  .procurement-forms {
  grid-template-columns: minmax(0, 1fr);
}
}

@media (max-width: 560px) {
  .procurement-heading {
  align-items: flex-start;
}
  .procurement-intro {
  font-size: 12px;
}
  .procurement-balances > div {
  padding: 16px 14px;
}
  .secondary-balances {
  gap: 14px;
  padding: 14px;
}
  .summary-context {
  padding: 12px 14px;
}
  .entry-card {
  padding: 20px 16px;
}
  .field-row {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}
  .data-card {
  padding: 8px 16px 16px;
}
  .loss-associations {
  padding: 12px;
}
}
</style>
