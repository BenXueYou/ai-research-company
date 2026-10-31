<template>
  <section class="profile-source" aria-label="企业资料来源">
    <h3>企业资料来源</h3>
    <p>选择要查看的资料。名称相同的记录可能属于不同企业，选择资料不会自动确认联系人归属。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <el-form @submit.prevent="selectSource">
      <el-form-item label="选择资料">
        <el-select
          v-model="choice"
          aria-label="选择资料"
          :disabled="busy || uncertain || !!quote"
          :empty-values="[null, undefined]"
        >
          <el-option label="请选择资料" value="" />
          <el-option
            v-for="candidate in data?.candidates ?? []"
            :key="`${candidate.sourceId}:${candidate.candidateId}`"
            :label="`${candidate.name} · ${candidate.countryCode3} · 资料编号 ${candidate.recordId}`"
            :value="`${candidate.sourceId}:${candidate.candidateId}`"
          />
        </el-select>
      </el-form-item>
      <p v-if="data && !data.candidates.length">此线索尚无可选择的企业资料，请先核实名单候选。</p>
      <div class="form-actions">
        <el-button
          type="primary"
          native-type="submit"
          :disabled="!choice || busy || uncertain || !!quote"
        >确认资料选择</el-button>
        <el-button :disabled="busy" @click="reload">刷新资料状态</el-button>
      </div>
    </el-form>
    <template v-if="data?.selection">
      <p>已选择：{{ data.selection.name }} · {{ data.selection.countryCode3 }} · 资料编号 {{ data.selection.recordId }}</p>
      <div class="form-actions">
        <el-button :disabled="busy || uncertain || !!quote" @click="requestQuote(false)">查看所选资料详情</el-button>
        <el-button :disabled="busy || uncertain || !!quote" @click="requestQuote(true)">主动更新所选资料</el-button>
      </div>
    </template>
    <section v-if="quote" aria-label="所选资料查询费用">
      <p>最高扣点 {{ quote.maximumPoints }} · 系数 {{ quote.coefficient }}</p>
      <div class="form-actions">
        <el-button type="primary" :disabled="busy || uncertain" @click="execute">确认费用并查询</el-button>
        <el-button :disabled="busy || uncertain" @click="quote = null">取消</el-button>
      </div>
    </section>
    <el-button v-if="pendingQueryId" :disabled="busy" @click="checkStatus">查看查询进度</el-button>
    <div v-for="snapshot in data?.snapshots ?? []" :key="snapshot.id" class="source-snapshot">
      <p>资料编号 {{ snapshot.recordId }} · {{ snapshot.state === 'ready' ? '详情已获取' : snapshot.state === 'zero' ? '未返回详情' : '资料待核实' }}</p>
      <p v-if="snapshot.reason">{{ snapshot.reason }}</p>
      <details>
        <summary>查看本次资料</summary>
        <pre>{{ JSON.stringify(snapshot.payload, null, 2) }}</pre>
      </details>
      <el-button
        v-if="snapshot.state === 'ready'"
        :disabled="busy || uncertain || data?.displayedSnapshotId === snapshot.id"
        @click="display(snapshot.id)"
      >{{ data?.displayedSnapshotId === snapshot.id ? '当前展示资料' : '设为档案展示资料' }}</el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  ElButton,
  ElForm,
  ElFormItem,
  ElOption,
  ElSelect
} from 'element-plus';
import { onMounted, ref } from 'vue';
import type { CompanyRequest } from '../../../api/companyProfiles';
import { HttpError } from '../../../api/http';
import { useFormLeave } from '../../../router/formLeave';

interface Candidate {
  sourceId: string;
  candidateId: string;
  recordId: string;
  name: string;
  countryCode3: string;
}
interface SourceData {
  version: number;
  candidates: Candidate[];
  selection: (Candidate & { id: string }) | null;
  displayedSnapshotId: string | null;
  snapshots: Array<{
    id: string;
    recordId: string;
    state: string;
    reason: string | null;
    payload: Record<string, unknown>;
  }>;
}
interface Quote {
  queryId: string;
  maximumPoints: string;
  coefficient: string;
}
const props = defineProps<{ profileId: string; visible: boolean; request: CompanyRequest }>();
const emit = defineEmits<{ changed: [] }>();
const data = ref<SourceData | null>(null);
const choice = ref('');
const quote = ref<Quote | null>(null);
const busy = ref(false);
const uncertain = ref(false);
const pendingQueryId = ref('');
const error = ref('');
const message = ref('');
const pendingSelection = ref<Record<string, unknown> | null>(null);
const pendingDisplayId = ref('');
useFormLeave({
  active: () => props.visible,
  state: () => busy.value ? 'submitting' : uncertain.value ? 'unknown' : quote.value ? 'dirty' : 'clean',
  retainUnknown: true,
  discard: () => { quote.value = null; }
});
async function load() {
  data.value = await props.request('company-sources/list', { profileId: props.profileId }) as SourceData;
}
async function run(action: () => Promise<void>, mutation = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '资料操作失败';
    if (failure instanceof HttpError && failure.status < 500) pendingSelection.value = null;
    if (mutation && (!(failure instanceof HttpError) || failure.status >= 500)) {
      uncertain.value = true;
      message.value = '操作结果尚未确认，请刷新资料状态或查看查询进度。';
    }
  } finally {
    busy.value = false;
  }
}
async function reload() {
  await run(async () => {
    if (pendingSelection.value) {
      await props.request('company-sources/select', pendingSelection.value);
      pendingSelection.value = null;
      uncertain.value = false;
    }
    await load();
    if (pendingDisplayId.value && data.value?.displayedSnapshotId === pendingDisplayId.value) {
      pendingDisplayId.value = '';
      uncertain.value = false;
    }
    emit('changed');
  });
}
async function selectSource() {
  if (!data.value || !choice.value || uncertain.value || busy.value) return;
  const [sourceId, candidateId] = choice.value.split(':');
  pendingSelection.value = {
    profileId: props.profileId,
    sourceId,
    candidateId,
    expectedVersion: data.value.version,
    requestId: crypto.randomUUID()
  };
  await run(async () => {
    await props.request('company-sources/select', pendingSelection.value!);
    pendingSelection.value = null;
    message.value = '资料选择已保存，企业身份及联系人归属仍需核实。';
    await load();
    emit('changed');
  }, true);
}
async function requestQuote(refresh: boolean) {
  if (!data.value?.selection) return;
  await run(async () => {
    const result = await props.request('company-source-details/quote', {
      profileId: props.profileId,
      selectionId: data.value!.selection!.id,
      refresh
    }) as Quote & { localSnapshot?: unknown };
    if (result.localSnapshot) {
      message.value = '已取得的资料可在下方查看，本次未发起新查询。';
      await load();
    } else if ('state' in result && result.state !== 'quoted') {
      pendingQueryId.value = result.queryId;
      await applyStatus(result as unknown as { state: string; resultState: string });
    } else quote.value = result;
  });
}
async function applyStatus(result: { state: string; resultState: string }) {
  message.value = result.resultState === 'ready'
    ? result.state === 'pending' ? '详情已获取，可查看资料；费用仍待确认。' : '详情已获取。'
    : result.resultState === 'conflict' ? '返回资料需要核实，原档案资料已保留。'
      : result.resultState === 'zero' ? '本次未返回详情，原档案已保留。' : '查询结果确认中，请勿重复发起。';
  quote.value = null;
  uncertain.value = false;
  if (result.state !== 'pending') pendingQueryId.value = '';
  await load();
  emit('changed');
}
async function execute() {
  if (!quote.value || uncertain.value) return;
  pendingQueryId.value = quote.value.queryId;
  await run(async () => {
    const result = await props.request('company-source-details/execute', { queryId: pendingQueryId.value });
    await applyStatus(result as { state: string; resultState: string });
  }, true);
}
async function checkStatus() {
  await run(async () => {
    const result = await props.request('company-source-details/status', { queryId: pendingQueryId.value });
    await applyStatus(result as { state: string; resultState: string });
  });
}
async function display(snapshotId: string) {
  if (busy.value || uncertain.value) return;
  pendingDisplayId.value = snapshotId;
  await run(async () => {
    await props.request('company-sources/display', {
      profileId: props.profileId,
      snapshotId,
      expectedVersion: data.value!.version
    });
    await load();
    pendingDisplayId.value = '';
    emit('changed');
  }, true);
}
onMounted(reload);
</script>

<style scoped>
.source-snapshot { margin-top: 16px; min-width: 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
