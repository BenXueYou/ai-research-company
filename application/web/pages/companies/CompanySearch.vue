<template>
  <section class="workspace-card company-search">
    <header class="company-search-heading">
      <div>
        <p class="eyebrow">公司名免费查询</p>
        <h2>核实企业身份</h2>
      </div>
      <span class="search-free-badge">免费查找候选</span>
    </header>
    <p class="hint search-intro">输入公司名和国家，逐页查找并核实企业，再单独确认详情费用。免费查询不扣查询点数。</p>
    <el-form class="company-search-form" label-position="top" @submit.prevent="startSearch">
      <el-form-item label="公司名称" for="company-name">
        <el-input
          id="company-name"
          v-model="name"
          :disabled="locked"
          placeholder="输入完整或部分公司名"
        />
      </el-form-item>
      <el-form-item label="企业所在国家/地区（三位代码）" for="country-codes">
        <el-input
          id="country-codes"
          v-model="countryCodes"
          :disabled="locked"
          placeholder="例如 CHN；多个以英文逗号分隔"
        />
      </el-form-item>
      <el-button
        class="primary-button"
        native-type="submit"
        :loading="busy"
        :disabled="locked"
      >免费查询</el-button>
    </el-form>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <template v-if="result">
      <div class="search-summary results-summary">
        <strong>第 {{ result.page }} 页</strong>
        <span>共 {{ result.total }} 条</span>
        <span>本页扣点 {{ result.chargedInternalPoints }}</span>
      </div>
      <el-alert
        v-if="result.content.length > 1"
        type="warning"
        title="找到多个候选，系统不会自动选择。请核对名称与国家后明确确认。"
        :closable="false"
      />
      <el-empty v-if="result.content.length === 0" description="本页没有匹配企业" />
      <div
        v-for="candidate in result.content"
        :key="candidate.candidateId"
        class="candidate-row"
      >
        <div class="candidate-identity"><strong>{{ candidate.name }}</strong><small>{{ candidate.country }} · 来源标识 {{ candidate.sourceId }}</small></div>
        <span v-if="candidate.verificationStatus === 'verified'" class="status-pill">已核实</span>
        <el-button v-else :disabled="locked" @click="verify(candidate)">确认是该企业</el-button>
        <el-button
          v-if="candidate.verificationStatus === 'verified'"
          :disabled="locked"
          @click="quoteDetail(candidate)"
        >查看详情报价</el-button>
      </div>
      <div class="pager">
        <el-button :disabled="locked || result.page <= 1" @click="changePage(result.page - 1)">上一页</el-button>
        <el-button :disabled="locked || result.page * result.size >= result.total" @click="changePage(result.page + 1)">下一页</el-button>
      </div>
      <div v-if="quote && 'queryId' in quote" class="search-summary detail-quote">
        <span>详情：{{ quote.name }} · {{ quote.countryCode3 }}</span>
        <span>锁定系数 {{ quote.coefficient }} · 最高扣点 {{ quote.maximumPoints }}</span>
        <el-button :disabled="locked" @click="executeDetail">确认费用并查询详情</el-button>
        <el-button :disabled="locked" @click="quote = null">取消</el-button>
      </div>
      <p class="hint">待核实候选不能继续查询联系人或发信；详情需单独确认费用。</p>
    </template>
    <p v-if="detailStatus" class="detail-outcome" role="status">{{ detailStatus }}</p>
    <div v-if="pendingQuery" class="pending-query">
      <p>查询结果尚未确认，请主动核实。离开或返回不会重新收费查询。</p>
      <el-button :disabled="busy" @click="checkDetail">核实原查询结果</el-button>
    </div>
    <nav class="profile-links" aria-label="档案入口">
      <RouterLink v-if="profileId" :to="{ path: '/terminal/profiles', query: { id: profileId } }">打开已建档企业 <span aria-hidden="true">→</span></RouterLink>
      <RouterLink to="/terminal/profiles">查看本企业档案库 <span aria-hidden="true">→</span></RouterLink>
    </nav>
    <div v-if="pointAccount" class="search-summary points-summary">
      <strong>点数用量</strong>
      <span>余额 {{ pointAccount.balance }} · 查询冻结 {{ pointAccount.queryFrozen }} · 可用 {{ pointAccount.available }}</span>
      <details v-if="pointLedger.length">
        <summary>查询流水</summary>
        <div v-for="entry in pointLedger" :key="`${entry.queryId}-${entry.event}`">
          {{ entry.name }} · {{ entry.event }} {{ entry.amount }} · 最高 {{ entry.maximumPoints }}
        </div>
      </details>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
import {
  companySearchApi,
  type Candidate,
  type DetailOutcome,
  type DetailQuote,
  type SearchResult,
  type SearchSnapshot
} from '../../api/companySearch';
import type { CompanyRequest } from '../../api/companyProfiles';
import { HttpError } from '../../api/http';
import { useFormLeave } from '../../router/formLeave';

defineOptions({ name: 'CompanySearch' });
const props = defineProps<{ request: CompanyRequest }>();
const api = companySearchApi(props.request);
const name = ref('');
const countryCodes = ref('CHN');
const busy = ref(false);
const error = ref('');
const result = ref<SearchResult | null>(null);
const quote = ref<DetailQuote | null>(null);
const pointAccount = ref<SearchSnapshot['account']>(null);
const pointLedger = ref<SearchSnapshot['ledger']>([]);
const detailStatus = ref('');
const pendingQuery = ref('');
const profileId = ref('');
const searchedInput = ref('');
const locked = computed(() => busy.value || !!pendingQuery.value);
const inputKey = () => JSON.stringify([name.value, countryCodes.value]);
useFormLeave({
  state: () => {
    if (busy.value) return 'submitting';
    if (pendingQuery.value) return 'unknown';
    return quote.value || (name.value && inputKey() !== searchedInput.value) ? 'dirty' : 'clean';
  },
  retainUnknown: true,
  discard: () => {
    quote.value = null;
    name.value = '';
    countryCodes.value = 'CHN';
    searchedInput.value = '';
    result.value = null;
  }
});
async function loadProfiles() {
  const data = await api.snapshot();
  pointAccount.value = data.account;
  pointLedger.value = data.ledger;
  return data.profiles;
}
async function loadPage(pageNo: number) {
  if (!name.value || name.value !== name.value.trim()) throw new Error('公司名称必填，且不得包含首尾空格');
  if (!/^[A-Z]{3}(,[A-Z]{3})*$/.test(countryCodes.value)) throw new Error('国家地区须使用三位大写代码，多个代码以英文逗号分隔');
  result.value = await api.search({
    name: name.value,
    countryCodes: countryCodes.value,
    pageNo,
    pageSize: 20
  });
  searchedInput.value = inputKey();
  quote.value = null;
  profileId.value = '';
  detailStatus.value = '';
}
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '查询失败';
  } finally {
    busy.value = false;
  }
}
function startSearch() {
  if (pendingQuery.value) return;
  void run(() => loadPage(1));
}
function changePage(pageNo: number) {
  if (pendingQuery.value) return;
  void run(() => loadPage(pageNo));
}
function verify(candidate: Candidate) {
  if (pendingQuery.value) return;
  void run(async () => {
    const verified = await api.verify(candidate.candidateId);
    if (result.value)
      result.value.content = result.value.content.map(item =>
        item.candidateId === verified.candidateId ? verified : item
      );
  });
}
function quoteDetail(candidate: Candidate) {
  if (pendingQuery.value) return;
  void run(async () => {
    const response = await api.quote(candidate.candidateId);
    profileId.value = '';
    if ('localProfile' in response) {
      quote.value = null;
      profileId.value = response.localProfile.id;
      detailStatus.value = '本企业已有本地档案，免费查看';
      await loadProfiles();
    } else if (response.state === 'pending') {
      quote.value = null;
      pendingQuery.value = response.queryId;
      detailStatus.value = '结果确认中，已保留冻结；请勿重复发起';
    } else quote.value = response;
  });
}
async function showOutcome(response: DetailOutcome) {
  if (response.state === 'quoted') {
    pendingQuery.value = '';
    detailStatus.value = '原查询尚未执行，请重新核对并确认费用';
    return;
  }
  if (response.state === 'pending') {
    detailStatus.value = '结果确认中，已保留冻结；请勿重复发起';
    await loadProfiles();
    return;
  }
  if (response.state === 'settled') {
    const profiles = await loadProfiles();
    const saved = profiles.find(profile =>
      profile.detail.id === response.result?.id
    );
    if (!saved) throw new Error('详情已完成，请在档案库核实保存结果');
    profileId.value = saved.id;
    detailStatus.value = `详情已入档，实际扣点 ${response.chargedPoints}`;
  } else {
    await loadProfiles();
    detailStatus.value = response.state === 'zero' ? '详情无匹配，已释放全部冻结' :
      response.state === 'failed' ? '查询已确认失败，冻结已释放' : '报价已失效，请重新报价';
  }
  quote.value = null;
  pendingQuery.value = '';
}
function executeDetail() {
  if (!quote.value || pendingQuery.value) return;
  const queryId = quote.value.queryId;
  void run(async () => {
    pendingQuery.value = queryId;
    try {
      await showOutcome(await api.execute(queryId));
    } catch (failure) {
      if (failure instanceof HttpError && failure.status < 500) pendingQuery.value = '';
      else detailStatus.value = '结果尚未确认，请核实原查询结果';
      throw failure;
    }
  });
}
function checkDetail() {
  if (!pendingQuery.value) return;
  const queryId = pendingQuery.value;
  void run(async () => { await showOutcome(await api.status(queryId)); });
}
onMounted(() => {
  void loadProfiles().catch(failure => {
    error.value = failure instanceof Error ? failure.message : '点数读取失败';
  });
});
</script>

<style scoped>
.company-search { font-size: 13px; line-height: 1.65; }
.company-search-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--search-line, #e6e9f0);
}
.company-search-heading .eyebrow {
  margin: 0 0 5px;
  color: #738095;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 1px;
}
.company-search-heading h2 { margin: 0; color: #1c2333; font-size: 18px; font-weight: 650; }
.search-free-badge {
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid #dce2ff;
  border-radius: 6px;
  color: #4356e0;
  background: #f4f6ff;
  font-size: 11px;
}
.company-search .search-intro { margin: 18px 0; color: #738095; font-size: 13px; }
.company-search .company-search-form {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 155px;
  align-items: end;
  gap: 16px;
  margin-bottom: 22px;
  padding: 0;
}
.company-search-form :deep(.el-form-item) { min-width: 0; margin-bottom: 0; }
.company-search-form :deep(.el-form-item__label) { height: auto; margin-bottom: 8px; color: #647087; font-size: 12px; line-height: 1.5; }
.company-search-form :deep(.el-input__wrapper) { min-height: 42px; padding: 0 12px; border-radius: 8px; box-shadow: 0 0 0 1px #dfe4ee inset; }
.company-search-form :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #4356e0 inset, 0 0 0 3px #4356e014; }
.company-search-form :deep(.el-input__inner) { color: #1c2333; font-size: 13px; }
.company-search :deep(.el-button) { height: 36px; border-radius: 8px; font-size: 12px; }
.company-search-form .primary-button {
  height: 42px;
  margin: 0;
  border-color: #4356e0;
  background: #4356e0;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 3px 7px #4356e017;
}
.company-search-form .primary-button:not(:disabled):hover { border-color: #3343c9; background: #3343c9; }
.company-search :deep(.el-alert) { margin: 16px 0; padding: 12px 14px; border: 1px solid #e8e4d8; border-radius: 8px; }
.company-search :deep(.el-alert__title) { font-size: 12px; line-height: 1.7; }
.company-search .results-summary { flex-wrap: wrap; gap: 16px; padding-top: 20px; border-top: 1px solid #edf0f6; color: #738095; }
.results-summary strong { margin-right: auto; color: #1c2333; font-weight: 600; }
.company-search .candidate-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 18px 12px;
  border-bottom: 1px solid #edf0f6;
}
.candidate-identity { flex: 1; min-width: 180px; overflow-wrap: anywhere; }
.candidate-identity strong { color: #28334b; font-size: 14px; font-weight: 600; }
.company-search .candidate-row small { color: #8490a5; font-size: 11px; }
.company-search .status-pill { margin: 0; padding: 4px 10px; font-size: 11px; }
.company-search .pager { justify-content: flex-end; gap: 10px; margin: 20px 0; }
.company-search .pager .el-button + .el-button { margin: 0; }
.company-search .detail-quote {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  padding: 18px;
  border: 1px solid #dce2ff;
  border-radius: 10px;
  background: #f5f7ff;
}
.detail-quote > span:first-child { grid-column: 1 / -1; color: #28334b; font-weight: 600; overflow-wrap: anywhere; }
.detail-quote > span:nth-child(2) { color: #58688f; font-size: 12px; }
.detail-quote .el-button + .el-button { margin: 0; }
.company-search .hint { color: #8490a5; font-size: 12px; }
.detail-outcome { padding: 12px 14px; border-radius: 8px; color: #4356e0; background: #f3f5ff; overflow-wrap: anywhere; }
.pending-query { margin: 16px 0; padding: 16px; border: 1px solid #f1dfb7; border-radius: 8px; color: #976a16; background: #fffbf1; }
.pending-query p { margin: 0 0 12px; }
.profile-links { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 22px 0 0; }
.profile-links a { color: #4356e0; font-size: 12px; text-decoration: none; }
.profile-links a:hover { text-decoration: underline; }
.profile-links a:focus-visible { outline: 2px solid #4356e0; outline-offset: 4px; border-radius: 2px; }
.profile-links span { margin-left: 6px; }
.company-search .points-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin: 22px 0 0;
  padding: 18px 20px;
  border: 1px solid #e6e9f0;
  border-radius: 10px;
  background: #f8f9fc;
  color: #647087;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.points-summary > strong { color: #3d4963; font-size: 13px; }
.points-summary > details { width: 100%; padding-top: 10px; border-top: 1px solid #e6e9f0; }
.points-summary summary { width: fit-content; color: #4356e0; cursor: pointer; }
.points-summary details div { margin-top: 8px; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .company-search .company-search-form { grid-template-columns: 1fr; gap: 16px; }
  .company-search-form .primary-button { width: 100%; }
  .company-search-heading { align-items: flex-start; }
  .company-search .candidate-row { padding: 16px 0; }
  .candidate-identity { flex-basis: 100%; }
  .company-search .detail-quote { grid-template-columns: 1fr 1fr; padding: 14px; }
  .detail-quote > span:nth-child(2) { grid-column: 1 / -1; }
  .company-search .points-summary { padding: 14px; }
  .points-summary > span { flex-basis: 100%; overflow-wrap: anywhere; }
}
</style>
