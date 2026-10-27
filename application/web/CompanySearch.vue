<template>
  <section class="workspace-card company-search">
    <p class="eyebrow">找企业 / 公司名免费查询</p>
    <h2>核实企业身份</h2>
    <p class="hint">每次只查询一页；免费查询不扣查询点数，但会计入腾道共享账号调用次数。</p>
    <el-form label-position="top" @submit.prevent="startSearch">
      <el-form-item label="公司名称" for="company-name">
        <el-input
          id="company-name"
          v-model="name"
          :disabled="busy"
          placeholder="输入完整或部分公司名"
        />
      </el-form-item>
      <el-form-item label="企业所在国家/地区（三位代码）" for="country-codes">
        <el-input
          id="country-codes"
          v-model="countryCodes"
          :disabled="busy"
          placeholder="例如 CHN；多个以英文逗号分隔"
        />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :loading="busy">免费查询</el-button>
    </el-form>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <template v-if="result">
      <div class="search-summary">
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
      <div v-for="candidate in result.content" :key="candidate.candidateId" class="candidate-row">
        <div><strong>{{ candidate.name }}</strong><small>{{ candidate.country }} · 来源标识 {{ candidate.sourceId }}</small></div>
        <span v-if="candidate.verificationStatus === 'verified'" class="status-pill">已核实</span>
        <el-button v-else :disabled="busy" @click="verify(candidate)">确认是该企业</el-button>
        <el-button
          v-if="candidate.verificationStatus === 'verified'"
          :disabled="busy"
          @click="quoteDetail(candidate)"
        >查看详情报价</el-button>
      </div>
      <div class="pager">
        <el-button :disabled="busy || result.page <= 1" @click="loadPage(result.page - 1)">上一页</el-button>
        <el-button :disabled="busy || result.page * result.size >= result.total" @click="loadPage(result.page + 1)">下一页</el-button>
      </div>
      <div v-if="quote && 'queryId' in quote" class="search-summary">
        <span>详情：{{ quote.name }} · {{ quote.countryCode3 }}</span>
        <span>锁定系数 {{ quote.coefficient }} · 最高扣点 {{ quote.maximumPoints }}</span>
        <el-button :disabled="busy" @click="executeDetail">确认费用并查询详情</el-button>
        <el-button :disabled="busy" @click="quote = null">取消</el-button>
      </div>
      <p v-if="detailStatus" role="status">{{ detailStatus }}</p>
      <p class="hint">待核实候选不能继续查询联系人或发信；详情需单独确认费用。</p>
    </template>
    <div v-if="profiles.length" class="search-summary">
      <strong>本企业本地档案</strong>
      <details v-for="profile in profiles" :key="profile.id">
        <summary>{{ profile.name }} · {{ profile.countryCode3 }}</summary>
        <p>最近获取：{{ profile.fetchedAt ?? '历史获取时间未知' }}</p>
        <pre>{{ JSON.stringify(profile.detail, null, 2) }}</pre>
        <CompanyContacts :profile="profile" :request="request" @updated="loadProfiles" />
        <CompanyTimeline
          :profile-id="profile.id"
          :current-account-id="currentAccountId"
          :can-delete="canDeleteTimeline"
          :request="request"
        />
      </details>
    </div>
    <div v-if="pointAccount" class="search-summary">
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
import { onMounted, ref } from 'vue';
import CompanyContacts from './CompanyContacts.vue';
import CompanyTimeline from './CompanyTimeline.vue';
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
interface Candidate {
  candidateId: string;
  sourceId: string;
  name: string;
  country: string;
  verificationStatus: 'pending' | 'verified';
}
interface SearchResult {
  page: number;
  size: number;
  total: number;
  chargedInternalPoints: string;
  content: Candidate[];
}
interface DetailQuote {
  queryId: string;
  name: string;
  countryCode3: string;
  coefficient: string;
  maximumPoints: string;
}
interface Profile { id: string; name: string; countryCode3: string; detail: Record<string, unknown>; fetchedAt: string | null }
interface PointAccount { balance: string; queryFrozen: string; available: string }
interface PointLedger { queryId: string; event: string; name: string; amount: string; maximumPoints: string }
const props = defineProps<{
  currentAccountId: string;
  canDeleteTimeline: boolean;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const name = ref('');
const countryCodes = ref('CHN');
const busy = ref(false);
const error = ref('');
const result = ref<SearchResult | null>(null);
const quote = ref<DetailQuote | { localProfile: Profile } | null>(null);
const profiles = ref<Profile[]>([]);
const pointAccount = ref<PointAccount | null>(null);
const pointLedger = ref<PointLedger[]>([]);
const detailStatus = ref('');
async function loadProfiles() {
  const data = await props.request('company-profiles') as { profiles: Profile[]; account: PointAccount | null; ledger: PointLedger[] };
  profiles.value = data.profiles;
  pointAccount.value = data.account;
  pointLedger.value = data.ledger;
}
async function loadPage(pageNo: number) {
  if (!name.value || name.value !== name.value.trim()) throw new Error('公司名称必填，且不得包含首尾空格');
  if (!/^[A-Z]{3}(,[A-Z]{3})*$/.test(countryCodes.value)) throw new Error('国家地区须使用三位大写代码，多个代码以英文逗号分隔');
  result.value = await props.request('company-searches', {
    name: name.value,
    countryCodes: countryCodes.value,
    pageNo,
    pageSize: 20
  }) as SearchResult;
  quote.value = null;
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
  void run(() => loadPage(1));
}
function verify(candidate: Candidate) {
  void run(async () => {
    const verified = await props.request('company-candidates/verify', { candidateId: candidate.candidateId }) as Candidate;
    if (result.value)
      result.value.content = result.value.content.map(item =>
        item.candidateId === verified.candidateId ? verified : item
      );
  });
}
function quoteDetail(candidate: Candidate) {
  void run(async () => {
    quote.value = await props.request('company-details/quote', { candidateId: candidate.candidateId }) as DetailQuote | { localProfile: Profile };
    if (quote.value && 'localProfile' in quote.value) {
      detailStatus.value = '本企业已有本地档案，免费查看';
      await loadProfiles();
    }
  });
}
function executeDetail() {
  if (!quote.value || !('queryId' in quote.value)) return;
  const queryId = quote.value.queryId;
  void run(async () => {
    const response = await props.request('company-details/execute', { queryId }) as { state: string; chargedPoints: string | null };
    detailStatus.value = response.state === 'pending' ? '结果确认中，已保留冻结；请勿重复发起' :
      response.state === 'zero' ? '详情无匹配，已释放全部冻结' : `详情已入档，实际扣点 ${response.chargedPoints}`;
    quote.value = null;
    await loadProfiles();
  });
}
onMounted(() => {
  void loadProfiles().catch(() => undefined);
});
</script>
