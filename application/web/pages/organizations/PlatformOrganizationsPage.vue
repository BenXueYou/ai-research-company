<template>
  <section class="workspace organization-section">
    <div class="page-heading">
      <p>直属上级：{{ parentName }}。开户后上级固定，最多两级分销。</p>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <nav aria-label="下级管理页面">
      <RouterLink to="/platform/organizations">直属下级</RouterLink> ·
      <RouterLink :to="{ path: '/platform/organizations', query: { view: 'new' } }">开户</RouterLink> ·
      <RouterLink :to="{ path: '/platform/organizations', query: { view: 'accounts' } }">下级账户</RouterLink> ·
      <RouterLink to="/platform/organizations/business-data">业务数据查看</RouterLink>
    </nav>
    <p v-if="openingUnknown" role="status">开户结果尚未确认。请刷新直属列表核实；重试将沿用本次请求标识，不会自动重新开户。</p>
    <el-button v-if="openingUnknown" @click="acknowledgeOpening">已核实开户结果，结束本次开户</el-button>
    <p v-if="resetUnknown" role="status">管理员密码重置结果尚未确认。请核实账号状态；返回本页不会再次重置。</p>
    <el-button v-if="resetUnknown" @click="acknowledgeReset">已核实，需要重新补发凭据</el-button>
    <section v-if="credentials" class="identity-card" aria-label="开户凭据">
      <h2>{{ credentialAction === 'reset' ? '管理员密码重置成功' : '开户成功' }}</h2>
      <p>请在关闭前交付凭据。临时密码有效期72小时，首次登录必须改密。</p>
      <dl class="handoff-values">
        <dt>登录邮箱</dt><dd data-testid="handoff-email">{{ credentials.email }}</dd>
        <dt>临时密码</dt><dd data-testid="handoff-password">{{ credentials.temporaryPassword }}</dd>
        <dt>有效期至</dt><dd>{{ new Date(credentials.expiresAt).toLocaleString() }}</dd>
      </dl>
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
      <el-button class="primary-button" :disabled="copying" @click="copyCredentials">一键复制账号信息</el-button>
      <el-button @click="closeCredentials">已保存，关闭凭据</el-button>
      <p class="hint">关闭后无法查询本次密码；需要补发时请再次重置。</p>
    </section>
    <el-form
      v-else-if="view === 'new'"
      class="identity-card opening-form"
      label-position="top"
      @submit.prevent="openOrganization"
    >
      <h3>开户（直属下级）</h3>
      <el-form-item label="组织名称" for="organization-name">
        <el-input
          id="organization-name"
          v-model="name"
          required
          :disabled="busy || openingUnknown"
        />
      </el-form-item>
      <el-form-item label="组织类型" for="organization-kind">
        <select
          id="organization-kind"
          v-model="kind"
          required
          :disabled="busy || openingUnknown"
        >
          <option value="terminal">终端企业</option>
          <option v-if="allowedKinds.includes('distributor')" value="distributor">分销组织</option>
        </select>
      </el-form-item>
      <el-form-item label="国家区号" for="country-code">
        <el-input
          id="country-code"
          v-model="countryCode"
          list="country-codes"
          required
          :disabled="busy || openingUnknown"
        />
        <datalist id="country-codes">
          <option value="+86">中国大陆</option>
          <option value="+852">中国香港</option>
          <option value="+853">中国澳门</option>
          <option value="+886">中国台湾</option>
          <option value="+1">美国 / 加拿大</option>
          <option value="+44">英国</option>
          <option value="+65">新加坡</option>
        </datalist>
        <p class="hint">默认中国大陆 +86；可选择或输入其他国家区号。</p>
      </el-form-item>
      <el-form-item label="电话号码" for="organization-phone">
        <el-input
          id="organization-phone"
          v-model="phone"
          type="tel"
          required
          :disabled="busy || openingUnknown"
        />
        <p class="hint">不能包含空格；不同组织不能使用相同电话。</p>
      </el-form-item>
      <el-form-item label="管理员邮箱（登录账号）" for="administrator-email">
        <el-input
          id="administrator-email"
          v-model="email"
          type="email"
          autocomplete="off"
          required
          :disabled="busy || openingUnknown"
        />
      </el-form-item>
      <el-button
        class="primary-button"
        native-type="submit"
        :disabled="busy || !allowedKinds.length"
      >{{ busy ? '正在开户…' : '确认开户' }}</el-button>
      <p class="hint">组织与首位管理员同时启用；系统生成临时密码。</p>
    </el-form>
    <div v-if="view === 'list'" class="workspace-card children-list">
      <h3>直属下级</h3>
      <el-button :disabled="busy" @click="refresh">刷新列表</el-button>
      <p v-if="!children.length">暂无直属下级</p>
      <article v-for="child in children" :key="child.id" class="child-row">
        <h4>{{ child.name }}</h4>
        <p>{{ child.kind === 'terminal' ? '终端企业' : `${child.distributorLevel}级分销` }} · {{ child.active ? '启用' : '停用' }}</p>
        <p>联系号码：{{ child.phoneMasked }} · 管理员：{{ child.email }}</p>
        <PointAccountSummary :account="pointAccounts.get(child.id)" :state="pointsState" />
        <RouterLink :to="{ path: '/platform/organizations', query: { id: child.id } }">下级详情</RouterLink>
      </article>
    </div>
    <section v-if="view === 'accounts'" class="workspace-card children-list" aria-label="下级账户">
      <h3>下级账户</h3>
      <p>查看授权范围内各层下级的内部点数。此页仅供查看；直属下级的管理请返回直属列表。</p>
      <el-button :disabled="pointsState === 'loading'" @click="refreshPoints">刷新账户</el-button>
      <p v-if="pointsState === 'loading'" role="status">账户读取中…</p>
      <p v-else-if="pointsState === 'error'" role="alert">下级账户读取失败，请刷新重试。</p>
      <template v-else>
        <p v-if="!visibleOrganizations.length">暂无授权下级</p>
        <article v-for="organization in visibleOrganizations" :key="organization.id" class="child-row">
          <h4>{{ organization.name }}</h4>
          <p>{{ organization.kind === 'terminal' ? '终端企业' : '分销组织' }} · {{ organization.active ? '启用' : '停用' }} · 第{{ organization.depth }}层下级</p>
          <p>直属上级：{{ organizationName(organization.parentId) }}</p>
          <PointAccountSummary :account="pointAccounts.get(organization.id)" :state="pointsState" />
        </article>
      </template>
    </section>
    <div v-if="view === 'detail'" class="workspace-card children-list">
      <h3>下级详情</h3>
      <template v-if="selectedChild">
        <h4>{{ selectedChild.name }}</h4>
        <p>{{ selectedChild.kind === 'terminal' ? '终端企业' : `${selectedChild.distributorLevel}级分销` }} · {{ selectedChild.active ? '启用' : '停用' }}</p>
        <p>联系号码：{{ selectedChild.phoneMasked }} · 管理员：{{ selectedChild.email }}</p>
        <el-button :disabled="busy || !!credentials || resetUnknown" @click="resetAdministrator(selectedChild.accountId)">重置管理员密码</el-button>
        <el-button :disabled="busy" @click="setActive(selectedChild)">{{ selectedChild.active ? '停用组织' : '恢复组织' }}</el-button>
        <RouterLink to="/platform/ledger">点数订单与售价</RouterLink>
        <p class="hint">停用保留余额和历史；已收款未划拨订单暂停且保留预留。在途查询与邮件继续核对，未执行邮件暂停。</p>
      </template>
      <p v-else>未找到直属下级，请返回列表核对。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
  shallowRef
} from 'vue';
import PointAccountSummary, { type PointAccount } from './components/PointAccountSummary.vue';
import { useRoute, useRouter } from 'vue-router';
import { useFormLeave } from '../../router/formLeave';
import { useBreadcrumbTitle } from '../../layout/breadcrumb';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';
interface Credentials {
  email: string;
  temporaryPassword: string;
  expiresAt: string;
}
defineOptions({ name: 'PlatformOrganizationsPage' });
interface Child {
  id: string;
  accountId: string;
  name: string;
  kind: string;
  distributorLevel: number;
  active: boolean;
  phoneMasked: string;
  email: string;
}
const props = defineProps<{
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const route = useRoute();
const router = useRouter();
const view = computed(() => route.query.view === 'new' ? 'new' : route.query.view === 'accounts' ? 'accounts' : route.query.id ? 'detail' : 'list');
const selectedChild = computed(() => children.value.find(child =>
  child.id === route.query.id
));
const parentName = ref('');
const allowedKinds = shallowRef<string[]>([]);
const children = shallowRef<Child[]>([]);
useBreadcrumbTitle(() => view.value === 'accounts' ? '下级账户' : selectedChild.value?.name ?? '下级详情');
const credentials = shallowRef<Credentials | null>(null);
const credentialAction = ref<'open' | 'reset'>('open');
const name = ref('');
const kind = ref('terminal');
const countryCode = ref('+86');
const phone = ref('');
const email = ref('');
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const copying = ref(false);
const error = ref('');
const copyMessage = ref('');
const resetUnknown = ref(false);
const openingUnknown = ref(false);
interface VisibleOrganization {
  id: string;
  name: string;
  parentId: string | null;
  kind: string;
  active: boolean;
  depth: number;
}
const pointsState = ref<'loading' | 'ready' | 'error'>('loading');
const pointAccounts = shallowRef(new Map<string, PointAccount>());
const organizations = shallowRef<VisibleOrganization[]>([]);
const visibleOrganizations = computed(() => organizations.value.filter(item =>
  item.depth > 0
));
function organizationName(id: string | null) {
  return organizations.value.find(item =>
    item.id === id)?.name ?? '上级信息缺失';
}
async function refreshPoints() {
  if (pointsState.value === 'loading' && pointsRequestPending) return;
  pointsRequestPending = true;
  pointsState.value = 'loading';
  pointAccounts.value = new Map();
  organizations.value = [];
  try {
    const report = await props.request('reports') as {
      role: string;
      organizations: VisibleOrganization[];
      accounts: PointAccount[];
    };
    if (report.role !== 'platform' || !Array.isArray(report.organizations) || !Array.isArray(report.accounts))
      throw new Error('账户数据不可用');
    organizations.value = report.organizations;
    pointAccounts.value = new Map(report.accounts.map(account =>
      [account.organizationId, account]
    ));
    pointsState.value = 'ready';
  } catch {
    pointsState.value = 'error';
  } finally {
    pointsRequestPending = false;
  }
}
let pointsRequestPending = false;
async function refresh() {
  void refreshPoints();
  try {
    const result = await props.request('organizations') as { parentName: string; allowedKinds: string[]; children: Child[] };
    parentName.value = result.parentName;
    allowedKinds.value = result.allowedKinds;
    children.value = result.children;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '列表加载失败，可重试刷新';
  }
}
async function openOrganization() {
  if (busy.value || credentials.value) return;
  error.value = '';
  if (!name.value.trim() || !phone.value || /\s/u.test(phone.value)) {
    error.value = '组织名称、电话号码必填，电话号码不能包含空格';
    return;
  }
  if (!/^\+[1-9][0-9]{0,2}$/.test(countryCode.value)) {
    error.value = '请填写有效国家区号，例如 +86';
    return;
  }
  busy.value = true;
  try {
    credentialAction.value = 'open';
    credentials.value = await props.request('organizations', {
      name: name.value,
      kind: kind.value,
      countryCode: countryCode.value,
      phone: phone.value,
      email: email.value,
      requestId: requestId.value
    }) as Credentials;
    openingUnknown.value = false;
    await refresh();
  } catch (failure) {
    if (failure instanceof TypeError || failure instanceof SyntaxError) openingUnknown.value = true;
    error.value = failure instanceof Error ? failure.message : '网络异常；可重试本次请求，或刷新列表核实开户结果';
  } finally {
    busy.value = false;
  }
}
async function copyCredentials() {
  if (!credentials.value || copying.value) return;
  copying.value = true;
  try {
    await navigator.clipboard.writeText(`登录邮箱：${credentials.value.email}\n临时密码：${credentials.value.temporaryPassword}`);
    copyMessage.value = '账号信息已复制';
  } catch {
    copyMessage.value = '复制失败，可再次点击复制或手动保存；开户已成功，无需重新开户。';
  } finally {
    copying.value = false;
  }
}
function closeCredentials() {
  credentials.value = null;
  copyMessage.value = '';
  name.value = '';
  phone.value = '';
  email.value = '';
  requestId.value = crypto.randomUUID();
  if (view.value === 'new') void router.push('/platform/organizations');
}
function acknowledgeReset() {
  if (!window.confirm('再次补发会生成新密码并使当前凭据失效。确认已核实并需要再次重置吗？')) return;
  resetUnknown.value = false;
  error.value = '';
}
function acknowledgeOpening() {
  if (!window.confirm('确认已在直属列表核实开户结果？结束后不会再次显示本次密码；如需凭据，请从详情重置管理员密码。')) return;
  openingUnknown.value = false;
  name.value = '';
  phone.value = '';
  email.value = '';
  requestId.value = crypto.randomUUID();
  error.value = '';
  void router.push('/platform/organizations');
}
async function resetAdministrator(accountId: string) {
  if (busy.value || credentials.value || resetUnknown.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.request('password-resets', { accountId, requestId: crypto.randomUUID() }) as Credentials;
    credentialAction.value = 'reset';
    credentials.value = result;
  } catch (failure) {
    if (failure instanceof TypeError || failure instanceof SyntaxError) resetUnknown.value = true;
    error.value = resetUnknown.value ? '重置结果不确定，请先核实账号状态，勿重复重置。' : failure instanceof Error ? failure.message : '重置结果不确定，请先核实账号状态，再决定是否再次重置';
  } finally {
    busy.value = false;
  }
}
async function setActive(child: Child) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('organizations/state', { organizationId: child.id, active: !child.active });
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '组织状态调整失败，请刷新核对';
  } finally {
    busy.value = false;
  }
}
function hasUnsavedChanges() {
  return busy.value || !!credentials.value || (view.value === 'new' && !!(name.value || phone.value || email.value || kind.value !== 'terminal' || countryCode.value !== '+86'));
}
useFormLeave({
  retainUnknown: true,
  state: () => {
    if (busy.value) return 'submitting';
    if (openingUnknown.value || resetUnknown.value) return 'unknown';
    return hasUnsavedChanges() ? 'dirty' : 'clean';
  },
  discard: () => {
    credentials.value = null;
    copyMessage.value = '';
    name.value = '';
    phone.value = '';
    email.value = '';
    kind.value = 'terminal';
    countryCode.value = '+86';
    requestId.value = crypto.randomUUID();
  },
  message: '您有未保存的信息或尚未交付的凭据。确定放弃并离开吗？取消将继续编辑。'
});
onMounted(refresh);
</script>

<style scoped>
.organization-section { margin-top: 32px; }
.opening-form { max-width: 640px; }
select { width: 100%; padding: 12px; border: 1px solid #dcdfe6; border-radius: 8px; color: #263052; background: white; }
.children-list { margin-top: 24px; }
.child-row { border-top: 1px solid #e5e7f1; margin-top: 16px; overflow-wrap: anywhere; }
.handoff-values { overflow-wrap: anywhere; }
.handoff-values dd { margin: 8px 0 20px; font-family: monospace; }
</style>
