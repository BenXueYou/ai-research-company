<template>
  <section class="contact-panel">
    <h3>联系人</h3>
    <p class="hint">每页须单独确认费用；单企业最多返回 200 条，达到上限不代表企业实际联系人总数。无邮箱的联系人仍可能计费。</p>
    <p>联系人最近获取：{{ fetchedAt ?? '尚未获取' }}</p>
    <el-button :disabled="busy" @click="quoteRefresh">主动更新当前职位第 1 页</el-button>
    <el-form label-position="top" @submit.prevent="quotePage(1)">
      <el-form-item label="职位标签">
        <el-select v-model="positionTags" multiple placeholder="不筛选职位">
          <el-option
            v-for="tag in tagOptions"
            :key="tag.value"
            :label="tag.label"
            :value="tag.value"
          />
        </el-select>
      </el-form-item>
      <el-button native-type="submit" :disabled="busy">查看第 1 页报价</el-button>
    </el-form>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <div v-if="quote && 'queryId' in quote" class="search-summary">
      <span>{{ profile.name }} · 第 {{ quote.pageNo }} 页 · 最高扣点 {{ quote.maximumPoints }} · 系数 {{ quote.coefficient }}</span>
      <el-button :disabled="busy" @click="executePage">{{ refreshPending ? '再次确认费用并更新本页' : '确认费用并查询本页' }}</el-button>
      <el-button :disabled="busy" @click="quote = null">取消</el-button>
    </div>
    <p v-if="status" role="status">{{ status }}</p>
    <div v-if="page && page.state === 'settled'" class="search-summary">
      <span>第 {{ page.pageNo }} 页 · 返回总数 {{ page.total }} · 本页扣点 {{ page.chargedPoints }}</span>
      <p v-if="page.total === 200" class="hint">已达单企业 200 条返回上限，不能据此推断实际总人数。</p>
      <el-button :disabled="busy || page.pageNo * page.pageSize >= page.total" @click="quotePage(page.pageNo + 1)">下一页报价</el-button>
    </div>
    <div v-for="contact in contacts" :key="contact.id" class="candidate-row">
      <div>
        <strong>{{ contact.mailsouId }}</strong>
        <small>返回企业 {{ contact.returnedCompanyName }} · 职位 {{ contact.positionTag || '未提供' }} · 邮箱可信度 {{ contact.credibility || '未提供' }}</small>
        <small>企业邮箱 {{ contact.email || '未提供' }} · 个人邮箱 {{ contact.personalEmail || '未提供' }}</small>
        <small v-if="contact.notReturnedInLastUpdate">本次更新未返回；仅表示本次查询结果，不代表离职或邮箱失效</small>
      </div>
      <span v-if="contact.ownershipStatus === 'pending'" class="status-pill">归属待核实，默认不选</span>
      <span v-else class="status-pill">归属一致</span>
    </div>
    <EmailComposer :profile="profile" :contacts="contacts" :request="request" @updated="loadLocal" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElForm, ElFormItem, ElOption, ElSelect } from 'element-plus';
import EmailComposer from '../email/EmailComposer.vue';

interface Profile { id: string; name: string }
interface Contact {
  id: string;
  mailsouId: string;
  returnedCompanyName: string;
  ownershipStatus: 'matched' | 'pending';
  email: string | null;
  personalEmail: string | null;
  positionTag: string | null;
  credibility: string | null;
  unsubscribed: boolean;
  ownershipReason: string | null;
  notReturnedInLastUpdate: boolean;
}
interface Quote { queryId: string; pageNo: number; pageSize: number; coefficient: string; maximumPoints: string }
interface Page { state: string; pageNo: number; pageSize: number; total: number; chargedPoints: string; contacts: Contact[] }
const props = defineProps<{
  profile: Profile;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const emit = defineEmits<{ updated: [] }>();
const tagOptions = [
  { value: 'EXECUTIVE', label: '高管' },
  { value: 'SALE', label: '销售' },
  { value: 'PURCHASING', label: '采购' },
  { value: 'TECHNOLGY', label: '技术研发' },
  { value: 'FINANCE', label: '财务' },
  { value: 'PRODUCER', label: '生产制造' },
  { value: 'SHAREHOLDER', label: '股东' },
  { value: 'MANAGEMENT', label: '管理层' },
  { value: 'UNSPECIFIED', label: '未分类职位' }
];
const positionTags = ref<string[]>([]);
const busy = ref(false);
const error = ref('');
const status = ref('');
const quote = ref<Quote | { localPage: Page } | null>(null);
const page = ref<Page | null>(null);
const contacts = ref<Contact[]>([]);
const fetchedAt = ref<string | null>(null);
const refreshPending = ref(false);
async function loadLocal() {
  const local = await props.request('company-contacts/profile', { profileId: props.profile.id }) as { contacts: Contact[]; fetchedAt: string | null };
  contacts.value = local.contacts;
  fetchedAt.value = local.fetchedAt;
}
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '联系人查询失败';
  } finally {
    busy.value = false;
  }
}
function quotePage(pageNo: number) {
  void run(async () => {
    refreshPending.value = false;
    quote.value = await props.request('company-contacts/quote', {
      profileId: props.profile.id,
      positionTags: [...positionTags.value],
      pageNo,
      pageSize: 20
    }) as Quote | { localPage: Page };
    if (quote.value && 'localPage' in quote.value) {
      page.value = quote.value.localPage;
      status.value = '本企业本地联系人页，免费查看';
      quote.value = null;
      await loadLocal();
    }
  });
}
function quoteRefresh() {
  void run(async () => {
    quote.value = await props.request('company-contacts/refresh-quote', {
      profileId: props.profile.id,
      positionTags: [...positionTags.value],
      pageNo: 1,
      pageSize: 20
    }) as Quote;
    refreshPending.value = true;
  });
}
function executePage() {
  if (!quote.value || !('queryId' in quote.value)) return;
  const queryId = quote.value.queryId;
  void run(async () => {
    page.value = await props.request('company-contacts/execute', { queryId }) as Page;
    status.value = page.value.state === 'pending' ? '结果确认中，冻结保留；请勿重复发起' :
      page.value.state === 'zero' ? '本页真实零结果，冻结已全部释放' : `本页已结算，扣点 ${page.value.chargedPoints}`;
    quote.value = null;
    refreshPending.value = false;
    await loadLocal();
    emit('updated');
  });
}
onMounted(() => {
  void loadLocal().catch(() => undefined);
});
</script>
