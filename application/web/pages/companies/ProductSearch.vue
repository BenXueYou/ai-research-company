<template>
  <section class="workspace-card product-search">
    <header class="product-search-heading">
      <div>
        <h2>按产品词发现</h2>
      </div>
      <span class="product-fee-badge">逐页确认费用</span>
    </header>
    <el-form class="product-search-form" label-position="top" @submit.prevent="prepare(1)">
      <slot name="search-mode" />
      <el-form-item label="采购企业所在国（三位代码）" for="buyer-country">
        <CountrySelect
          id="buyer-country"
          v-model="buyerCountryCode3"
          :disabled="locked"
          :multiple="false"
        />
      </el-form-item>
      <el-form-item label="产品词" for="product-desc">
        <el-input
          id="product-desc"
          v-model="productDesc"
          :disabled="locked"
          placeholder="至少两个字符"
        />
      </el-form-item>
      <el-form-item label="贸易开始日期" for="trade-start">
        <el-date-picker
          id="trade-start"
          v-model="startDate"
          type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false"
          :disabled="locked"
        />
      </el-form-item>
      <el-form-item label="贸易结束日期" for="trade-end">
        <el-date-picker
          id="trade-end"
          v-model="endDate"
          type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false"
          :disabled="locked"
        />
      </el-form-item>
      <p class="hint product-intro">输入产品词，选择采购企业所在国与贸易时间，查看本页报价后确认查询。名单仅含企业名称，身份须另行核实。</p>
      <el-button
        class="primary-button"
        native-type="submit"
        :loading="busy"
        :disabled="unresolved"
      >查看第 1 页报价</el-button>
    </el-form>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <div v-if="page" class="search-summary product-page-quote">
      <strong>{{ page.productDesc }} · 采购企业所在国 {{ page.buyerCountryCode3 }}</strong>
      <span>贸易时间 {{ page.startDate }} 至 {{ page.endDate }} · 第 {{ page.pageNo }} 页</span>
      <span>最高扣点 {{ page.maximumPoints }} · 锁定系数 {{ page.coefficient }}</span>
      <template v-if="page.state === 'quoted' && !pageUnknown">
        <el-button :disabled="locked" @click="execute">确认本页费用并查询</el-button>
        <el-button :disabled="locked" @click="page = null">取消</el-button>
      </template>
      <template v-else-if="page.state === 'pending' || pageUnknown">
        <p role="status">本页结果确认中，冻结保留；请主动核实，勿重复提交。</p>
        <el-button :disabled="busy" @click="refreshPage">核实本页结果</el-button>
      </template>
      <p v-else-if="page.state === 'failed'" role="status">本页查询已确认失败，不展示候选；可重新报价。</p>
      <p v-else-if="page.state === 'expired'" role="status">本页报价已失效，请重新报价并确认。</p>
      <p v-else role="status">本页已结算 {{ page.chargedPoints }} 点；下一页须重新确认。</p>
    </div>
    <template v-if="page && ['settled', 'zero'].includes(page.state)">
      <p class="product-results-caption">共 {{ page.total }} 个候选；当前页只显示名称，不自动建档。</p>
      <el-empty v-if="!page.content.length" description="本页没有采购企业候选" />
      <div v-for="candidate in page.content" :key="candidate.candidateId" class="candidate-row">
        <strong>{{ candidate.name }}</strong>
        <el-button :disabled="locked" @click="checkCandidate(candidate)">免费核实企业身份</el-button>
      </div>
      <div class="pager">
        <el-button :disabled="locked || page.pageNo <= 1" @click="prepare(page.pageNo - 1, page)">上一页报价</el-button>
        <el-button :disabled="locked || page.pageNo * page.pageSize >= (page.total ?? 0)" @click="prepare(page.pageNo + 1, page)">下一页报价</el-button>
      </div>
    </template>
    <template v-if="verification">
      <h3 class="verification-heading">免费身份核实 · {{ verification.query.name }}</h3>
      <p class="hint">请核对返回企业的名称和国家。产品名单名称并不证明企业位于所选国家。</p>
      <el-empty v-if="!verification.content.length" description="该国家没有匹配的企业，不能继续建档" />
      <div v-for="candidate in verification.content" :key="candidate.candidateId" class="candidate-row">
        <CompanyIdentity
          :name="candidate.name"
          :country="candidate.country"
          :source-id="candidate.sourceId"
        />
        <span v-if="candidate.verificationStatus === 'verified'" class="status-pill">已核实</span>
        <el-button v-else :disabled="locked" @click="verify(candidate)">确认是该企业</el-button>
        <el-button
          v-if="candidate.verificationStatus === 'verified'"
          :disabled="locked"
          @click="quoteDetail(candidate)"
        >查看详情报价</el-button>
        <el-alert
          v-if="candidateError?.candidateId === candidate.candidateId"
          class="candidate-error"
          type="error"
          :title="candidateError.message"
          :closable="false"
        />
      </div>
    </template>
    <div v-if="detailQuote" ref="quotePanel" class="search-summary product-detail-quote">
      <span>企业详情 {{ detailQuote.name }} · {{ detailQuote.countryCode3 }}</span>
      <span>最高扣点 {{ detailQuote.maximumPoints }} · 锁定系数 {{ detailQuote.coefficient }}</span>
      <template v-if="detailUnknown || detailQuote.state === 'pending'">
        <p role="status">详情结果确认中，已保留详情冻结，请主动核实。</p>
        <el-button :disabled="busy" @click="refreshDetail">核实详情结果</el-button>
      </template>
      <template v-else>
        <el-button :disabled="locked" @click="executeDetail">另行确认详情费用并建档</el-button>
        <el-button :disabled="locked" @click="detailQuote = null">取消</el-button>
      </template>
    </div>
    <p v-if="detailStatus" class="product-detail-outcome" role="status">{{ detailStatus }}</p>
    <RouterLink v-if="localProfile" class="product-profile-link" :to="{ path: '/terminal/profiles', query: { id: localProfile.id } }">进入企业档案 · {{ localProfile.name }}</RouterLink>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  watch
} from 'vue';
import { ElDatePicker } from 'element-plus';
import { RouterLink } from 'vue-router';
import { useFormLeave } from '../../router/formLeave';
import CompanyIdentity from './components/CompanyIdentity.vue';
import CountrySelect from './components/CountrySelect.vue';
import {
  checkProductCandidate,
  executeProductDetail,
  executeProductPage,
  quoteProductDetail,
  quoteProductPage,
  readProductDetail,
  readProductPage,
  verifyProductCompany,
  type CompanyCandidate,
  type DetailQuote,
  type DetailResult,
  type LocalProfile,
  type ProductCandidate,
  type ProductPage,
  type Verification
} from '../../api/productSearch';
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

defineOptions({ name: 'ProductSearch' });
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const emit = defineEmits<{ profileCreated: [] }>();
const productDesc = ref('');
const buyerCountryCode3 = ref('');
const startDate = ref('');
const endDate = ref('');
const page = ref<ProductPage | null>(null);
const verification = ref<Verification | null>(null);
const detailQuote = ref<DetailQuote | null>(null);

const detailCandidateId = ref('');
const localProfile = ref<LocalProfile | null>(null);
const pageUnknown = ref(false);
const detailUnknown = ref(false);
const detailStatus = ref('');
const busy = ref(false);
const error = ref('');
const candidateError = ref<{ candidateId: string; message: string } | null>(null);
const quotePanel = ref<HTMLElement | null>(null);
watch(detailQuote, async value => {
  if (!value) return;
  await nextTick();
  quotePanel.value?.scrollIntoView({ block: 'nearest' });
});

const unresolved = computed(() => pageUnknown.value || detailUnknown.value || page.value?.state === 'pending' || detailQuote.value?.state === 'pending');
const locked = computed(() => busy.value || unresolved.value);
const inputSnapshot = computed(() => JSON.stringify([productDesc.value, buyerCountryCode3.value, startDate.value, endDate.value]));
const acceptedSnapshot = ref(inputSnapshot.value);
useFormLeave({
  state: () => {
    if (busy.value) return 'submitting';
    if (unresolved.value) return 'unknown';
    return inputSnapshot.value !== acceptedSnapshot.value || page.value?.state === 'quoted' || detailQuote.value ? 'dirty' : 'clean';
  },
  retainUnknown: true,
  discard: () => {
    productDesc.value = '';
    buyerCountryCode3.value = '';
    startDate.value = '';
    endDate.value = '';
    acceptedSnapshot.value = inputSnapshot.value;
    page.value = null;
    verification.value = null;
    detailQuote.value = null;
    localProfile.value = null;
    detailStatus.value = '';
  }
});
async function run(action: () => Promise<void>, candidateId = '') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  candidateError.value = null;
  try {
    await action();
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : '查询失败';
    if (candidateId) candidateError.value = { candidateId, message };
    else error.value = message;
  } finally {
    busy.value = false;
  }
}
function prepare(pageNo: number, source?: ProductPage) {
  if (locked.value) return;
  void run(async () => {
    page.value = await quoteProductPage(props.request, {
      productDesc: source?.productDesc ?? productDesc.value,
      buyerCountryCode3: source?.buyerCountryCode3 ?? buyerCountryCode3.value,
      startDate: source?.startDate ?? startDate.value,
      endDate: source?.endDate ?? endDate.value,
      pageNo,
      pageSize: source?.pageSize ?? 20
    });
    acceptedSnapshot.value = JSON.stringify([page.value.productDesc, page.value.buyerCountryCode3, page.value.startDate, page.value.endDate]);
    verification.value = null;
    detailQuote.value = null;
    detailStatus.value = '';
    localProfile.value = null;
  });
}
function execute() {
  const pageId = page.value?.pageId;
  if (!pageId || locked.value) return;
  void run(async () => {
    pageUnknown.value = true;
    page.value = await executeProductPage(props.request, pageId);
    pageUnknown.value = false;
  });
}
function refreshPage() {
  const pageId = page.value?.pageId;
  if (!pageId) return;
  void run(async () => {
    page.value = await readProductPage(props.request, pageId);
    pageUnknown.value = false;
  });
}
function checkCandidate(candidate: ProductCandidate) {
  if (locked.value) return;
  void run(async () => {
    verification.value = await checkProductCandidate(props.request, candidate.candidateId);
    detailQuote.value = null;
    localProfile.value = null;
    detailStatus.value = '';
  });
}
function verify(candidate: CompanyCandidate) {
  if (locked.value) return;
  void run(async () => {
    const verified = await verifyProductCompany(props.request, candidate.candidateId);
    if (verification.value) verification.value.content = verification.value.content.map(item =>
      item.candidateId === verified.candidateId ? verified : item
    );
  }, candidate.candidateId);
}
function quoteDetail(candidate: CompanyCandidate) {
  if (locked.value) return;
  void run(async () => {
    const quote = await quoteProductDetail(props.request, candidate.candidateId);
    detailCandidateId.value = candidate.candidateId;
    detailStatus.value = '';
    localProfile.value = null;
    if ('localProfile' in quote) {
      localProfile.value = quote.localProfile;
      detailQuote.value = null;
      detailStatus.value = '本企业已有本地档案，免费查看';
    } else detailQuote.value = quote;
  }, candidate.candidateId);
}
function executeDetail() {
  if (!detailQuote.value || locked.value) return;
  const queryId = detailQuote.value.queryId;
  void run(async () => {
    detailUnknown.value = true;
    await applyDetailResult(await executeProductDetail(props.request, queryId));
  });
}
function refreshDetail() {
  const queryId = detailQuote.value?.queryId;
  if (!queryId) return;
  void run(async () => {
    await applyDetailResult(await readProductDetail(props.request, queryId));
  });
}
async function applyDetailResult(result: DetailResult) {
  detailUnknown.value = false;
  if (result.state === 'pending') {
    if (detailQuote.value) detailQuote.value.state = 'pending';
    return;
  }
  if (result.state === 'quoted') return;
  detailQuote.value = null;
  if (result.state === 'settled') {
    detailStatus.value = `企业已建档，详情扣点 ${result.chargedPoints}；名单费独立结算`;
    emit('profileCreated');
    const quote = await quoteProductDetail(props.request, detailCandidateId.value);
    if ('localProfile' in quote) localProfile.value = quote.localProfile;
    return;
  }
  detailStatus.value = result.state === 'zero' ? '详情无匹配，已释放详情冻结；名单费仍按成功结果结算' :
    '详情查询已确认失败；名单费仍按成功结果结算';
}
</script>

<style scoped>
.product-search .candidate-row > .candidate-error { flex: 0 0 100%; min-width: 0; }
.product-search { min-width: 0; color: #1c2333; font-size: 13px; line-height: 1.65; }
.product-search-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--search-line, #e6e9f0); }
.product-search-heading h2 { margin: 0; color: #1c2333; font-size: 18px; font-weight: 650; }
.product-fee-badge { flex-shrink: 0; padding: 5px 10px; border: 1px solid #dce2ff; border-radius: 6px; color: #4356e0; background: #f4f6ff; font-size: 11px; }
.product-search .hint { color: #8490a5; font-size: 12px; }
.product-search .product-intro { margin: 18px 0; color: #738095; font-size: 13px; }
.product-search-form { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) repeat(2, minmax(0, .9fr)); align-items: end; gap: 16px; }
.product-search-form :deep(.el-form-item) { min-width: 0; margin-bottom: 0; }
.product-search-form :deep(.el-form-item__label) { height: auto; margin-bottom: 8px; color: #647087; font-size: 12px; line-height: 1.5; }
.product-search-form :deep(.el-input__wrapper) { min-height: 42px; padding: 0 12px; border-radius: 8px; box-shadow: 0 0 0 1px #dfe4ee inset; }
.product-search-form :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #4356e0 inset, 0 0 0 3px #4356e014; }
.product-search-form :deep(.el-input__inner) { min-width: 0; color: #1c2333; font-size: 13px; }
.product-search :deep(.el-button) { min-height: 36px; height: auto; padding: 9px 14px; border-radius: 8px; font-size: 12px; }
.product-search :deep(.el-button + .el-button) { margin-left: 0; }
.product-search-form .primary-button { grid-column: 1 / -1; justify-self: end; min-width: 172px; height: 42px; margin: 2px 0 0; border-color: #4356e0; color: #fff; background: #4356e0; font-size: 13px; font-weight: 600; box-shadow: 0 3px 7px #4356e017; }
.product-search-form .primary-button:not(:disabled):hover { border-color: #3343c9; background: #3343c9; }
.product-search-form .primary-button.is-disabled { opacity: .55; }
.product-search :deep(.el-alert) { margin: 18px 0; padding: 12px 14px; border-radius: 8px; }
.product-search :deep(.el-alert__title) { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.product-search .search-summary { display: flex; flex-wrap: wrap; gap: 12px 16px; margin: 22px 0; padding: 18px 20px; border: 1px solid #dce2ff; border-radius: 10px; color: #58688f; background: #f5f7ff; font-variant-numeric: tabular-nums; }
.product-page-quote > strong, .product-detail-quote > span:first-child { flex-basis: 100%; color: #28334b; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.product-page-quote > span { flex-basis: 100%; }
.product-search .search-summary > p { flex-basis: 100%; margin: 0; overflow-wrap: anywhere; }
.product-results-caption { padding-top: 6px; color: #738095; font-size: 12px; }
.product-search .candidate-row { flex-wrap: wrap; gap: 12px; padding: 18px 12px; border-bottom: 1px solid #edf0f6; }
.product-search .candidate-row > strong, .product-search .candidate-row > div { flex: 1; min-width: 180px; overflow-wrap: anywhere; }
.product-search .candidate-row strong { color: #28334b; font-size: 14px; font-weight: 600; }
.product-search .candidate-row small { color: #8490a5; font-size: 11px; }
.product-search .pager { justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
.verification-heading { margin: 28px 0 10px; padding-top: 22px; border-top: 1px solid #e6e9f0; color: #28334b; font-size: 15px; overflow-wrap: anywhere; }
.product-detail-outcome { margin: 20px 0 12px; padding: 12px 14px; border-radius: 8px; color: #4356e0; background: #f3f5ff; overflow-wrap: anywhere; }
.product-profile-link { display: inline-block; margin-top: 8px; color: #4356e0; font-size: 12px; text-decoration: none; overflow-wrap: anywhere; }
.product-profile-link:hover { text-decoration: underline; }
.product-profile-link:focus-visible { outline: 2px solid #4356e0; outline-offset: 4px; border-radius: 2px; }
@media (max-width: 1000px) {
  .product-search-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .product-search-heading { align-items: flex-start; gap: 10px; }
  .product-search-heading h2 { font-size: 17px; }
  .product-fee-badge { padding: 4px 7px; font-size: 10px; }
  .product-search-form { grid-template-columns: minmax(0, 1fr); }
  .product-search-form .primary-button { width: 100%; }
  .product-search .search-summary { gap: 12px; padding: 14px; }
  .product-search .search-summary > .el-button { flex: 1 1 auto; }
  .product-search .candidate-row { padding: 16px 0; }
  .product-search .candidate-row > strong, .product-search .candidate-row > div { flex-basis: 100%; min-width: 0; }
}
.el-date-editor.el-input { width: 100%; min-width: 0; }
</style>
