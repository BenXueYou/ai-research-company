<template>
  <section class="workspace-card reconciliation-card" aria-labelledby="detail-reconciliation-title">
    <div class="reconciliation-card-heading">
      <div>
        <p class="section-kicker">待处理事项</p>
        <h2 id="detail-reconciliation-title">查询结果人工核对</h2>
        <p class="section-description">按查询标识核对供应商账单、traceId 和可查看结果。最终失败释放冻结；迟到结果仅留存，不再扣点。</p>
      </div>
      <el-button class="refresh-button" :disabled="busy" @click="refresh">刷新查询</el-button>
    </div>
    <p v-if="error" class="reconciliation-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="reconciliation-notice" role="status">{{ notice }}</p>
    <p v-if="unknown" class="reconciliation-warning" role="alert">提交结果尚未确认，请刷新查询核实。离开不会取消或重试请求。</p>
    <div
      class="table-scroll"
      tabindex="0"
      role="region"
      aria-label="查询核对列表"
    >
      <table>
        <thead><tr><th>查询 / 企业</th><th>状态 / 最高扣点</th><th>traceId / 账单</th><th>结果证据</th><th>处理留痕</th><th>损耗 / 关联费用</th><th>操作</th></tr></thead>
        <tbody>
          <tr
            v-for="item in queries"
            :key="item.queryId"
            :class="{ 'selected-row': selected?.queryId === item.queryId && selected?.kind === item.kind }"
          >
            <td>{{ kindLabel(item.kind) }} / {{ item.queryId }}<br>{{ item.name }} / {{ item.countryCode3 }}
              <span v-if="item.kind === 'contact'"> / 第{{ item.pageNo }}页 / {{ item.positionTags?.join('、') }}</span>
              <span v-if="item.kind === 'product'"> / 第{{ item.pageNo }}页 / {{ item.startDate }}～{{ item.endDate }}</span>
            </td>
            <td><span class="query-state" :class="{ 'query-pending': item.state === 'pending' }">{{ item.state }}</span> / {{ item.maximumPoints }}</td>
            <td>{{ item.traceId || '待补' }} / {{ item.billingReference || '待补' }}</td>
            <td><pre v-if="item.result">{{ JSON.stringify(item.result, null, 2) }}</pre><span v-else>暂无</span>
              <details v-if="item.lateResults.length"><summary>迟到结果（{{ item.lateResults.length }}）</summary><pre>{{ JSON.stringify(item.lateResults, null, 2) }}</pre></details>
            </td>
            <td>{{ item.reconciliationEvidence || '暂无' }}<br>{{ item.reconciledBy || '' }}<br>{{ item.reconciledAt || '' }}</td>
            <td>{{ item.lossPurpose || '无' }} {{ item.lossUpstreamPoints || '' }}<br>{{ item.expenseId || '尚未关联费用' }}</td>
            <td>
              <el-button
                v-if="item.state === 'pending'"
                :disabled="busy || unknown"
                @click="select(item)"
              >核对</el-button>
              <el-button
                v-if="item.state === 'failed'"
                :disabled="busy || unknown"
                @click="selectLate(item)"
              >登记迟到结果</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!queries.length" class="reconciliation-empty">暂无可核对的查询记录，可点击「刷新查询」获取最新记录。</p>
    <el-form
      v-if="selected"
      class="reconciliation-form"
      label-position="top"
      @submit.prevent="submit"
    >
      <h3>{{ late ? '登记迟到结果' : '核对结果确认中查询' }}：{{ selected.name }}（{{ kindLabel(selected.kind) }}）</h3>
      <p>查询标识：{{ selected.queryId }}；锁定系数：{{ selected.coefficient }}；最高扣点：{{ selected.maximumPoints }}</p>
      <el-form-item v-if="!late" label="核对结论" for="detail-outcome">
        <el-select :empty-values="[null, undefined]"
          id="detail-outcome"
          v-model="form.outcome"
          :disabled="busy || unknown"
        ><el-option value="settled" label="可查看结果，结算" /><el-option value="zero" label="真实零结果，释放" /><el-option value="failed" label="最终失败，释放" /></el-select>
      </el-form-item>
      <el-form-item label="供应商账单引用" for="detail-bill">
        <el-input
          id="detail-bill"
          v-model="form.billingReference"
          required
          :disabled="busy || unknown"
        />
      </el-form-item>
      <el-form-item label="traceId" for="detail-trace">
        <el-input
          id="detail-trace"
          v-model="form.traceId"
          :required="late || form.outcome !== 'failed'"
          :disabled="busy || unknown"
        />
      </el-form-item>
      <el-form-item label="实际上游扣点（失败或迟到结果如已知请填写）" for="detail-upstream">
        <el-input
          id="detail-upstream"
          v-model="form.upstreamPoints"
          :required="!late && form.outcome !== 'failed'"
          :disabled="busy || unknown"
        />
      </el-form-item>
      <el-form-item
        class="form-wide"
        v-if="late || form.outcome !== 'failed'"
        :label="resultLabel(selected.kind)"
        for="detail-result"
      >
        <el-input
          id="detail-result"
          v-model="form.result"
          type="textarea"
          :rows="5"
          required
          :disabled="busy || unknown"
        />
      </el-form-item>
      <el-form-item class="form-wide" label="核对依据" for="detail-evidence">
        <el-input
          id="detail-evidence"
          v-model="form.evidence"
          type="textarea"
          :rows="2"
          required
          :disabled="busy || unknown"
        />
      </el-form-item>
      <el-button
        type="primary"
        native-type="submit"
        :disabled="busy || unknown"
      >确认并留痕</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import {
  onMounted,
  reactive,
  ref,
  shallowRef
} from 'vue';
import { useFormLeave } from '../../../router/formLeave';
import { HttpError } from '../../../api/http';
import {
  ElOption,
  ElSelect,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

interface Query {
  kind: 'detail' | 'contact' | 'product';
  queryId: string;
  name: string;
  countryCode3: string;
  state: string;
  maximumPoints: string;
  coefficient: string;
  traceId: string | null;
  billingReference: string | null;
  result: Record<string, unknown> | null;
  lossPurpose: string | null;
  lossUpstreamPoints: string | null;
  expenseId: string | null;
  lateResults: Array<Record<string, unknown>>;
  reconciliationEvidence?: string;
  reconciledBy?: string;
  reconciledAt?: string;
  pageNo?: number;
  positionTags?: string[];
  startDate?: string;
  endDate?: string;
}
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const queries = shallowRef<Query[]>([]);
const selected = shallowRef<Query | null>(null);
const late = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const form = reactive({
  outcome: 'settled',
  billingReference: '',
  traceId: '',
  upstreamPoints: '',
  result: '',
  evidence: ''
});
const baseline = ref('');
const unknown = ref(false);
let issued: { queryId: string; kind: Query['kind']; late: boolean; body: Record<string, unknown> } | null = null;
useFormLeave({
  state: () => busy.value ? 'submitting' : unknown.value ? 'unknown' :
    selected.value && JSON.stringify(form) !== baseline.value ? 'dirty' : 'clean',
  discard: () => { selected.value = null; },
  retainUnknown: true
});
async function refresh() {
  try {
    const [details, contacts, products] = await Promise.all([
      props.request('company-details/reconciliations') as Promise<Query[]>,
      props.request('company-contacts/reconciliations') as Promise<Query[]>,
      props.request('product-searches/reconciliations') as Promise<Query[]>
    ]);
    queries.value = [
      ...details.map(item =>
        ({ ...item, kind: 'detail' as const })),
      ...contacts.map(item =>
        ({ ...item, kind: 'contact' as const })),
      ...products.map(item =>
        ({ ...item, kind: 'product' as const }))
    ].sort((a, b) =>
      (a.state === 'pending' ? 0 : 1) - (b.state === 'pending' ? 0 : 1));
    if (unknown.value && issued) {
      const snapshot = issued;
      const row = queries.value.find(item =>
        item.kind === snapshot.kind && item.queryId === snapshot.queryId
      );
      const matches = (record: Record<string, unknown>) =>
        record.billingReference === snapshot.body.billingReference &&
        record.traceId === snapshot.body.traceId && record.evidence === snapshot.body.evidence;
      const confirmed = snapshot.late ? row?.lateResults.some(matches) :
        !!row && row.state === snapshot.body.outcome && row.billingReference === snapshot.body.billingReference &&
        (row.traceId ?? '') === snapshot.body.traceId && row.reconciliationEvidence === snapshot.body.evidence;
      if (confirmed) {
        unknown.value = false;
        selected.value = null;
        issued = null;
        notice.value = '查询已有处理记录，请核对列表中的结果与留痕';
      }
    }
    error.value = '';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '查询列表暂不可用';
  }
}
function select(item: Query) {
  if (busy.value || unknown.value) return;
  if (selected.value && JSON.stringify(form) !== baseline.value &&
    !window.confirm('您有未提交的修改。确定放弃并选择其他查询吗？取消将继续编辑。')) return;
  selected.value = item;
  late.value = false;
  form.outcome = 'settled';
  form.billingReference = item.billingReference || '';
  form.traceId = item.traceId || '';
  form.upstreamPoints = '';
  form.result = item.result ? JSON.stringify(item.result, null, 2) : '';
  form.evidence = '';
  baseline.value = JSON.stringify(form);
  return true;
}
function selectLate(item: Query) {
  if (!select(item)) return;
  late.value = true;
  form.result = '';
  baseline.value = JSON.stringify(form);
}
async function submit() {
  if (!selected.value || busy.value || unknown.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  let dispatched = false;
  try {
    const body: Record<string, unknown> = {
      queryId: selected.value.queryId,
      billingReference: form.billingReference,
      traceId: form.traceId,
      evidence: form.evidence
    };
    if (late.value || form.outcome !== 'failed') body.result = JSON.parse(form.result) as Record<string, unknown>;
    if (form.upstreamPoints) body.upstreamPoints = form.upstreamPoints;
    const base = selected.value.kind === 'detail' ? 'company-details' : selected.value.kind === 'contact' ? 'company-contacts' : 'product-searches';
    issued = {
      queryId: selected.value.queryId,
      kind: selected.value.kind,
      late: late.value,
      body
    };
    dispatched = true;
    if (late.value) {
      await props.request(`${base}/late-results`, body);
    } else {
      body.outcome = form.outcome;
      await props.request(`${base}/reconciliations`, body);
    }
    notice.value = late.value ? '迟到结果已留存，未重新扣点' : '核对已完成';
    selected.value = null;
    issued = null;
    await refresh();
  } catch (failure) {
    if (dispatched && (!(failure instanceof HttpError) || failure.status >= 500)) unknown.value = true;
    error.value = failure instanceof Error ? failure.message : '核对提交失败';
  } finally {
    busy.value = false;
  }
}
onMounted(refresh);
function kindLabel(kind: Query['kind']) {
  return kind === 'detail' ? '企业详情' : kind === 'contact' ? '联系人页' : '产品名单页';
}
function resultLabel(kind: Query['kind']) {
  return kind === 'detail' ? '可查看结果 JSON（含原始 id 与 countryCode3）'
    : kind === 'contact' ? '联系人页结果 JSON（含 list、pageNo、pageSize、total）'
      : '名单页结果 JSON（含 content、page、size、total）';
}
</script>

<style scoped>
.reconciliation-card { min-width: 0; }
.reconciliation-card h2 { font-size: 17px; }
.reconciliation-card .table-scroll { max-width: 100%; overflow: auto; margin-top: 20px; border: 1px solid var(--console-line); border-radius: 9px; }
table { width: 100%; min-width: 980px; border-collapse: collapse; text-align: left; }
th, td { padding: 14px 13px; border-bottom: 1px solid #edf0f6; }
th { color: var(--console-muted); background: #f8f9fc; font-size: 11px; font-weight: 500; white-space: nowrap; }
td { max-width: 240px; color: #465064; font-size: 12px; line-height: 1.8; vertical-align: top; overflow-wrap: anywhere; }
td:first-child { min-width: 190px; }
td:last-child { white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: #fafbff; }
tbody .selected-row { background: #f0f3ff; }
pre { max-height: 180px; overflow: auto; padding: 12px; border-radius: 6px; background: #f5f7fc; font: 11px/1.7 Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
summary { cursor: pointer; color: var(--console-brand); }
.query-state { display: inline-block; padding: 2px 7px; border-radius: 5px; color: #63718a; background: #f0f2f7; }
.query-pending { color: #a8731e; background: #fff5e4; }
.reconciliation-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; margin-top: 24px; padding: 24px; border: 1px solid #e1e5fb; border-radius: 10px; background: #f8f9ff; }
.reconciliation-form h3, .reconciliation-form > p, .form-wide { grid-column: 1 / -1; }
.reconciliation-form h3 { margin: 0 0 8px; font-size: 15px; overflow-wrap: anywhere; }
.reconciliation-form > p { margin: 0 0 22px; font-size: 12px; overflow-wrap: anywhere; }
.reconciliation-form :deep(.el-form-item) { min-width: 0; }
.reconciliation-form :deep(.el-form-item__label) { font-size: 12px; }
.reconciliation-form > .el-button { grid-column: 1 / -1; justify-self: end; margin-top: 4px; }
.reconciliation-error, .reconciliation-notice, .reconciliation-warning { margin: 16px 0 0; padding: 12px 15px; border: 1px solid #f0d2d6; border-radius: 8px; font-size: 12px; }
.reconciliation-card .reconciliation-error { color: var(--console-danger); background: #fff4f4; }
.reconciliation-card .reconciliation-notice { color: #168764; border-color: #cbe8dc; background: #eefaf4; }
.reconciliation-card .reconciliation-warning { color: #a8731e; border-color: #f0dfbd; background: #fff9ed; }
.reconciliation-empty { margin: 0; padding: 32px 16px; text-align: center; font-size: 12px; }
@media (max-width: 640px) {
  .reconciliation-form { grid-template-columns: 1fr; padding: 18px 14px; }
  .reconciliation-form > .el-button { width: 100%; }
}

.reconciliation-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 4px;
}

.section-kicker {
  margin: 0 0 6px;
  color: #4356e0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.6px;
}

.reconciliation-card-heading h2 {
  margin-bottom: 8px;
}

.section-description {
  max-width: 760px;
  margin: 0;
  color: #738095;
  font-size: 13px;
  line-height: 1.7;
}

.refresh-button {
  flex: 0 0 auto;
}

@media (max-width: 640px) {
  .reconciliation-card-heading {
    display: block;
  }

  .refresh-button {
    width: 100%;
    margin-top: 16px;
  }
}

/* Element Plus 下拉框沿用页面控件尺寸，状态样式由组件提供。 */
:deep(.el-select) { min-width: 0; }
.reconciliation-form :deep(.el-select__wrapper) { min-height: 34px; border-radius: 8px; }
</style>
