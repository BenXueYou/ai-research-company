<template>
  <section class="workspace-card" aria-labelledby="detail-reconciliation-title">
    <h2 id="detail-reconciliation-title">查询结果人工核对</h2>
    <p>按查询标识核对供应商账单、traceId 和可查看结果。最终失败释放冻结；迟到结果仅留存，不再扣点。</p>
    <el-button :disabled="busy" @click="refresh">刷新查询</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th>查询 / 企业</th><th>状态 / 最高扣点</th><th>traceId / 账单</th><th>结果证据</th><th>损耗 / 关联费用</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="item in queries" :key="item.queryId">
            <td>{{ kindLabel(item.kind) }} / {{ item.queryId }}<br>{{ item.name }} / {{ item.countryCode3 }}
              <span v-if="item.kind === 'contact'"> / 第{{ item.pageNo }}页 / {{ item.positionTags?.join('、') }}</span>
              <span v-if="item.kind === 'product'"> / 第{{ item.pageNo }}页 / {{ item.startDate }}～{{ item.endDate }}</span>
            </td>
            <td>{{ item.state }} / {{ item.maximumPoints }}</td>
            <td>{{ item.traceId || '待补' }} / {{ item.billingReference || '待补' }}</td>
            <td><pre v-if="item.result">{{ JSON.stringify(item.result, null, 2) }}</pre><span v-else>暂无</span>
              <details v-if="item.lateResults.length"><summary>迟到结果（{{ item.lateResults.length }}）</summary><pre>{{ JSON.stringify(item.lateResults, null, 2) }}</pre></details>
            </td>
            <td>{{ item.lossPurpose || '无' }} {{ item.lossUpstreamPoints || '' }}<br>{{ item.expenseId || '尚未关联费用' }}</td>
            <td><el-button v-if="item.state === 'pending'" @click="select(item)">核对</el-button><el-button v-if="item.state === 'failed'" @click="selectLate(item)">登记迟到结果</el-button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <el-form v-if="selected" label-position="top" @submit.prevent="submit">
      <h3>{{ late ? '登记迟到结果' : '核对结果确认中查询' }}：{{ selected.name }}（{{ kindLabel(selected.kind) }}）</h3>
      <p>查询标识：{{ selected.queryId }}；锁定系数：{{ selected.coefficient }}；最高扣点：{{ selected.maximumPoints }}</p>
      <el-form-item v-if="!late" label="核对结论" for="detail-outcome">
        <select id="detail-outcome" v-model="form.outcome" :disabled="busy"><option value="settled">可查看结果，结算</option><option value="zero">真实零结果，释放</option><option value="failed">最终失败，释放</option></select>
      </el-form-item>
      <el-form-item label="供应商账单引用" for="detail-bill">
        <el-input
          id="detail-bill"
          v-model="form.billingReference"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="traceId" for="detail-trace">
        <el-input
          id="detail-trace"
          v-model="form.traceId"
          :required="late || form.outcome !== 'failed'"
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="实际上游扣点（失败或迟到结果如已知请填写）" for="detail-upstream">
        <el-input
          id="detail-upstream"
          v-model="form.upstreamPoints"
          :required="!late && form.outcome !== 'failed'"
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item
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
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="核对依据" for="detail-evidence">
        <el-input
          id="detail-evidence"
          v-model="form.evidence"
          type="textarea"
          :rows="2"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-button native-type="submit" :disabled="busy">确认并留痕</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, shallowRef } from 'vue';
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus';

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
const form = reactive({ outcome: 'settled', billingReference: '', traceId: '', upstreamPoints: '', result: '', evidence: '' });
async function refresh() {
  try {
    const [details, contacts, products] = await Promise.all([
      props.request('company-details/reconciliations') as Promise<Query[]>,
      props.request('company-contacts/reconciliations') as Promise<Query[]>,
      props.request('product-searches/reconciliations') as Promise<Query[]>
    ]);
    queries.value = [
      ...details.map(item => ({ ...item, kind: 'detail' as const })),
      ...contacts.map(item => ({ ...item, kind: 'contact' as const })),
      ...products.map(item => ({ ...item, kind: 'product' as const }))
    ].sort((a, b) => (a.state === 'pending' ? 0 : 1) - (b.state === 'pending' ? 0 : 1));
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '查询列表暂不可用';
  }
}
function select(item: Query) {
  selected.value = item;
  late.value = false;
  form.outcome = 'settled';
  form.billingReference = item.billingReference || '';
  form.traceId = item.traceId || '';
  form.upstreamPoints = '';
  form.result = item.result ? JSON.stringify(item.result, null, 2) : '';
  form.evidence = '';
}
function selectLate(item: Query) {
  select(item);
  late.value = true;
  form.result = '';
}
async function submit() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
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
    if (late.value) {
      await props.request(`${base}/late-results`, body);
    } else {
      body.outcome = form.outcome;
      await props.request(`${base}/reconciliations`, body);
    }
    notice.value = late.value ? '迟到结果已留存，未重新扣点' : '核对已完成';
    selected.value = null;
    await refresh();
  } catch (failure) {
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
