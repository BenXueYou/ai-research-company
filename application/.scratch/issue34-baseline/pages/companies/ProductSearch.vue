<template>
  <section class="workspace-card product-search">
    <p class="eyebrow">找企业 / 产品词发现</p>
    <h2>寻找采购企业候选</h2>
    <p class="hint">按采购企业所在国、贸易时间和产品词逐页确认费用。名单仅含企业名称，身份须另行核实。</p>
    <el-form label-position="top" @submit.prevent="prepare(1)">
      <el-form-item label="产品词" for="product-desc">
        <el-input
          id="product-desc"
          v-model="productDesc"
          :disabled="busy"
          placeholder="至少两个字符"
        />
      </el-form-item>
      <el-form-item label="采购企业所在国（三位代码）" for="buyer-country">
        <el-input
          id="buyer-country"
          v-model="buyerCountryCode3"
          :disabled="busy"
          placeholder="例如 TUR"
        />
      </el-form-item>
      <el-form-item label="贸易开始日期" for="trade-start">
        <el-input
          id="trade-start"
          v-model="startDate"
          type="date"
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="贸易结束日期" for="trade-end">
        <el-input
          id="trade-end"
          v-model="endDate"
          type="date"
          :disabled="busy"
        />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :loading="busy">查看第 1 页报价</el-button>
    </el-form>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <div v-if="page" class="search-summary">
      <strong>{{ page.productDesc }} · 采购企业所在国 {{ page.buyerCountryCode3 }}</strong>
      <span>贸易时间 {{ page.startDate }} 至 {{ page.endDate }} · 第 {{ page.pageNo }} 页</span>
      <span>最高扣点 {{ page.maximumPoints }} · 锁定系数 {{ page.coefficient }}</span>
      <template v-if="page.state === 'quoted'">
        <el-button :disabled="busy" @click="execute">确认本页费用并查询</el-button>
        <el-button :disabled="busy" @click="page = null">取消</el-button>
      </template>
      <p v-else-if="page.state === 'pending'" role="status">本页结果确认中，冻结保留；重复提交不会再次调用。</p>
      <p v-else role="status">本页已结算 {{ page.chargedPoints }} 点；下一页须重新确认。</p>
    </div>
    <template v-if="page && ['settled', 'zero'].includes(page.state)">
      <p>共 {{ page.total }} 个候选；当前页只显示名称，不自动建档。</p>
      <el-empty v-if="!page.content.length" description="本页没有采购企业候选" />
      <div v-for="candidate in page.content" :key="candidate.candidateId" class="candidate-row">
        <strong>{{ candidate.name }}</strong>
        <el-button :disabled="busy" @click="checkCandidate(candidate)">免费核实企业身份</el-button>
      </div>
      <div class="pager">
        <el-button :disabled="busy || page.pageNo <= 1" @click="prepare(page.pageNo - 1, page)">上一页报价</el-button>
        <el-button :disabled="busy || page.pageNo * page.pageSize >= (page.total ?? 0)" @click="prepare(page.pageNo + 1, page)">下一页报价</el-button>
      </div>
    </template>
    <template v-if="verification">
      <h3>免费身份核实 · {{ verification.query.name }}</h3>
      <p class="hint">请核对返回企业的名称和国家。产品名单名称并不证明企业位于所选国家。</p>
      <el-empty v-if="!verification.content.length" description="该国家没有匹配的企业，不能继续建档" />
      <div v-for="candidate in verification.content" :key="candidate.candidateId" class="candidate-row">
        <div><strong>{{ candidate.name }}</strong><small>{{ candidate.country }} · 来源标识 {{ candidate.sourceId }}</small></div>
        <el-button v-if="candidate.verificationStatus !== 'verified'" :disabled="busy" @click="verify(candidate)">确认是该企业</el-button>
        <el-button v-else :disabled="busy" @click="quoteDetail(candidate)">查看详情报价</el-button>
      </div>
    </template>
    <div v-if="detailQuote && 'queryId' in detailQuote" class="search-summary">
      <span>企业详情 {{ detailQuote.name }} · {{ detailQuote.countryCode3 }}</span>
      <span>最高扣点 {{ detailQuote.maximumPoints }} · 锁定系数 {{ detailQuote.coefficient }}</span>
      <el-button :disabled="busy" @click="executeDetail">另行确认详情费用并建档</el-button>
      <el-button :disabled="busy" @click="detailQuote = null">取消</el-button>
    </div>
    <p v-if="detailStatus" role="status">{{ detailStatus }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

interface ProductCandidate { candidateId: string; name: string }
interface ProductPage {
  pageId: string;
  state: 'quoted' | 'pending' | 'settled' | 'zero' | 'failed';
  productDesc: string;
  buyerCountryCode3: string;
  startDate: string;
  endDate: string;
  pageNo: number;
  pageSize: number;
  coefficient: string;
  maximumPoints: string;
  chargedPoints: string | null;
  total: number | null;
  content: ProductCandidate[];
}
interface CompanyCandidate {
  candidateId: string;
  sourceId: string;
  name: string;
  country: string;
  verificationStatus: 'pending' | 'verified' | 'not_selected';
}
interface Verification { query: { name: string }; content: CompanyCandidate[] }
interface DetailQuote { queryId: string; name: string; countryCode3: string; coefficient: string; maximumPoints: string }
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const emit = defineEmits<{ profileCreated: [] }>();
const productDesc = ref('');
const buyerCountryCode3 = ref('');
const startDate = ref('');
const endDate = ref('');
const page = ref<ProductPage | null>(null);
const verification = ref<Verification | null>(null);
const detailQuote = ref<DetailQuote | { localProfile: unknown } | null>(null);
const detailStatus = ref('');
const busy = ref(false);
const error = ref('');
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
function prepare(pageNo: number, source?: ProductPage) {
  void run(async () => {
    page.value = await props.request('product-searches/quote', {
      productDesc: source?.productDesc ?? productDesc.value,
      buyerCountryCode3: source?.buyerCountryCode3 ?? buyerCountryCode3.value,
      startDate: source?.startDate ?? startDate.value,
      endDate: source?.endDate ?? endDate.value,
      pageNo,
      pageSize: source?.pageSize ?? 20
    }) as ProductPage;
    verification.value = null;
    detailQuote.value = null;
    detailStatus.value = '';
  });
}
function execute() {
  const pageId = page.value?.pageId;
  if (!pageId) return;
  void run(async () => {
    page.value = await props.request('product-searches/execute', { pageId }) as ProductPage;
  });
}
function checkCandidate(candidate: ProductCandidate) {
  void run(async () => {
    verification.value = await props.request('product-candidates/check', { candidateId: candidate.candidateId }) as Verification;
    detailQuote.value = null;
  });
}
function verify(candidate: CompanyCandidate) {
  void run(async () => {
    const verified = await props.request('company-candidates/verify', { candidateId: candidate.candidateId }) as CompanyCandidate;
    if (verification.value) verification.value.content = verification.value.content.map(item =>
      item.candidateId === verified.candidateId ? verified : item
    );
  });
}
function quoteDetail(candidate: CompanyCandidate) {
  void run(async () => {
    detailQuote.value = await props.request('company-details/quote', { candidateId: candidate.candidateId }) as DetailQuote | { localProfile: unknown };
    if (detailQuote.value && 'localProfile' in detailQuote.value) detailStatus.value = '本企业已有本地档案，免费查看';
  });
}
function executeDetail() {
  if (!detailQuote.value || !('queryId' in detailQuote.value)) return;
  const queryId = detailQuote.value.queryId;
  void run(async () => {
    const result = await props.request('company-details/execute', { queryId }) as { state: string; chargedPoints: string | null };
    detailStatus.value = result.state === 'pending' ? '详情结果确认中，已保留详情冻结' :
      result.state === 'zero' ? '详情无匹配，已释放详情冻结；名单费仍按成功结果结算' :
        `企业已建档，详情扣点 ${result.chargedPoints}；名单费独立结算`;
    detailQuote.value = null;
    if (result.state === 'settled') emit('profileCreated');
  });
}
</script>
