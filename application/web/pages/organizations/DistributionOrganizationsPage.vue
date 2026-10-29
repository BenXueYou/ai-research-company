<template>
  <section class="workspace organization-section style-b-page">
    <div class="page-heading organization-heading">
      <div>
        <span class="module-kicker">ORGANIZATION MANAGEMENT</span>
        <h1>下级管理</h1>
        <p>管理直属合作组织、管理员凭据和组织状态。</p>
      </div>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <nav class="organization-tabs" aria-label="下级管理页面">
      <RouterLink to="/distribution/organizations" :class="{ 'tab-active': view === 'list' || view === 'detail' }">直属下级</RouterLink>
      <RouterLink :to="{ path: '/distribution/organizations', query: { view: 'new' } }" :class="{ 'tab-active': view === 'new' }">开户</RouterLink>
      <RouterLink :to="{ path: '/distribution/organizations', query: { view: 'accounts' } }" :class="{ 'tab-active': view === 'accounts' }">下级账户</RouterLink>
    </nav>
    <p v-if="openingUnknown" role="status">开户结果尚未确认。请刷新直属列表核实；重试将沿用本次请求标识，不会自动重新开户。</p>
    <el-button v-if="openingUnknown" @click="acknowledgeOpening">已核实开户结果，结束本次开户</el-button>
    <p v-if="resetUnknown" role="status">管理员密码重置结果尚未确认。请核实账号状态；返回本页不会再次重置。</p>
    <el-button v-if="resetUnknown" @click="acknowledgeReset">已核实，需要重新补发凭据</el-button>
    <p v-if="stateUnknown" role="status">组织状态调整结果尚未确认，请刷新列表核实后再操作。</p>
    <section v-if="credentials" class="identity-card credential-panel" aria-label="开户凭据">
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
      class="identity-card opening-form style-b-card"
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
      <el-form-item class="opening-email" label="管理员邮箱（登录账号）" for="administrator-email">
        <el-input
          id="administrator-email"
          v-model="email"
          type="email"
          autocomplete="off"
          required
          :disabled="busy || openingUnknown"
        />
      </el-form-item>
      <div class="opening-actions">
        <p class="hint">组织与首位管理员同时启用；系统生成临时密码。</p>
        <el-button
          class="primary-button"
          native-type="submit"
          :disabled="busy || !allowedKinds.length"
        >{{ busy ? '正在开户…' : '确认开户' }}</el-button>
      </div>
    </el-form>
    <div v-if="view === 'list'" class="workspace-card children-list style-b-card">
      <div class="section-heading">
        <div><span class="module-kicker">DIRECT ORGANIZATIONS</span><h2>直属下级</h2></div>
        <el-button :disabled="busy" @click="refresh">刷新列表</el-button>
      </div>
      <p v-if="!children.length">暂无直属下级</p>
      <article v-for="child in children" :key="child.id" class="child-row organization-row">
        <div class="organization-main"><span class="status-dot" :class="{ inactive: !child.active }"></span><div><h3>{{ child.name }}</h3><p>{{ child.kind === 'terminal' ? '终端企业' : `${child.distributorLevel}级分销` }} · {{ child.active ? '启用' : '停用' }}</p></div></div>
        <div class="organization-contact"><span>管理员</span><strong>{{ child.email }}</strong><small>{{ child.phoneMasked }}</small></div>
        <PointAccountSummary :account="pointAccounts.get(child.id)" :state="pointsState" />
        <RouterLink class="row-action" :to="{ path: '/distribution/organizations', query: { id: child.id } }">查看详情 →</RouterLink>
      </article>
    </div>
    <section v-if="view === 'accounts'" class="workspace-card children-list style-b-card" aria-label="下级账户">
      <div class="section-heading account-heading">
        <div><span class="module-kicker">POINT ACCOUNTS</span><h2>下级账户</h2></div>
        <el-button :disabled="pointsState === 'loading'" @click="refreshPoints">刷新账户</el-button>
      </div>
      <p class="account-description">查看授权范围内各层下级的内部点数。此页仅供查看；直属下级的管理请返回直属列表。</p>
      <p v-if="pointsState === 'loading'" role="status">账户读取中…</p>
      <p v-else-if="pointsState === 'error'" role="alert">下级账户读取失败，请刷新重试。</p>
      <template v-else>
        <p v-if="!visibleOrganizations.length">暂无授权下级</p>
        <article v-for="organization in visibleOrganizations" :key="organization.id" class="child-row account-row">
          <div class="account-identity">
            <div class="organization-main">
              <span
                class="status-dot"
                :class="{ inactive: !organization.active }"
                aria-hidden="true"
              ></span>
              <div>
                <h3>{{ organization.name }}</h3>
                <p>{{ organization.kind === 'terminal' ? '终端企业' : '分销组织' }} · {{ organization.active ? '启用' : '停用' }} · 第{{ organization.depth }}层下级</p>
              </div>
            </div>
            <p class="account-parent">直属上级：{{ organizationName(organization.parentId) }}</p>
          </div>
          <PointAccountSummary :account="pointAccounts.get(organization.id)" :state="pointsState" />
        </article>
      </template>
    </section>
    <div v-if="view === 'detail'" class="workspace-card children-list style-b-card detail-card">
      <div class="section-heading"><div><span class="module-kicker">ORGANIZATION PROFILE</span><h2>下级详情</h2></div></div>
      <template v-if="selectedChild">
        <h4>{{ selectedChild.name }}</h4>
        <p>{{ selectedChild.kind === 'terminal' ? '终端企业' : `${selectedChild.distributorLevel}级分销` }} · {{ selectedChild.active ? '启用' : '停用' }}</p>
        <p>联系号码：{{ selectedChild.phoneMasked }} · 管理员：{{ selectedChild.email }}</p>
        <el-button :disabled="busy || !!credentials || resetUnknown" @click="resetAdministrator(selectedChild.accountId)">重置管理员密码</el-button>
        <el-button :disabled="busy || stateUnknown" @click="setActive(selectedChild)">{{ selectedChild.active ? '停用组织' : '恢复组织' }}</el-button>
        <RouterLink to="/distribution/orders">点数订单与售价</RouterLink>
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
defineOptions({ name: 'DistributionOrganizationsPage' });
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
const allowedKinds = shallowRef<string[]>([]);
const children = shallowRef<Child[]>([]);
useBreadcrumbTitle(() => view.value === 'accounts' ? '下级账户' : selectedChild.value?.name ?? '下级详情');
const credentials = shallowRef<Credentials | null>(null);
const credentialAction = ref<'open' | 'reset'>('open');
const name = ref('');
const kind = ref('terminal');
const countryCode = ref('+86');
const savedKind = ref('terminal');
const savedCountryCode = ref('+86');
const phone = ref('');
const email = ref('');
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const copying = ref(false);
const error = ref('');
const copyMessage = ref('');
const resetUnknown = ref(false);
const openingUnknown = ref(false);
const stateUnknown = ref(false);
const refreshing = ref(false);
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
    if (report.role !== 'distributor' || !Array.isArray(report.organizations) || !Array.isArray(report.accounts))
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
  if (refreshing.value) return;
  refreshing.value = true;
  void refreshPoints();
  try {
    const result = await props.request('organizations') as { parentName: string; allowedKinds: string[]; children: Child[] };
    allowedKinds.value = result.allowedKinds;
    children.value = result.children;
    stateUnknown.value = false;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '列表加载失败，可重试刷新';
  } finally {
    refreshing.value = false;
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
  savedKind.value = kind.value;
  savedCountryCode.value = countryCode.value;
  requestId.value = crypto.randomUUID();
  if (view.value === 'new') void router.push('/distribution/organizations');
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
  savedKind.value = kind.value;
  savedCountryCode.value = countryCode.value;
  requestId.value = crypto.randomUUID();
  error.value = '';
  void router.push('/distribution/organizations');
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
  if (busy.value || stateUnknown.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('organizations/state', { organizationId: child.id, active: !child.active });
    await refresh();
  } catch (failure) {
    if (failure instanceof TypeError || failure instanceof SyntaxError) stateUnknown.value = true;
    error.value = failure instanceof Error ? failure.message : '组织状态调整失败，请刷新核对';
  } finally {
    busy.value = false;
  }
}
function hasUnsavedChanges() {
  return busy.value || !!credentials.value || !!(name.value || phone.value || email.value || kind.value !== savedKind.value || countryCode.value !== savedCountryCode.value);
}
useFormLeave({
  retainUnknown: true,
  state: () => {
    if (busy.value) return 'submitting';
    if (openingUnknown.value || resetUnknown.value || stateUnknown.value) return 'unknown';
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
    savedKind.value = 'terminal';
    savedCountryCode.value = '+86';
    requestId.value = crypto.randomUUID();
  },
  message: '您有未保存的信息或尚未交付的凭据。确定放弃并离开吗？取消将继续编辑。'
});
onMounted(refresh);
</script>

<style scoped>
.style-b-page { --style-b-accent: #4356e0; --style-b-ink: #1c2333; --style-b-muted: #7d899d; --style-b-line: #e6e9f0; margin-top: 6px; }
.organization-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.organization-heading h1 { margin: 0 0 5px; color: var(--style-b-ink); font-size: 26px; letter-spacing: -.5px; }
.organization-heading p { margin: 0; color: var(--style-b-muted); font-size: 13px; }
.module-kicker { display: block; margin-bottom: 7px; color: #9ba6bd; font-size: 10px; letter-spacing: 1.5px; }
.organization-tabs { display: flex; gap: 22px; margin-bottom: 22px; border-bottom: 1px solid var(--style-b-line); overflow-x: auto; }
.organization-tabs a { flex-shrink: 0; padding: 10px 2px; color: var(--style-b-muted); font-size: 13px; text-decoration: none; }
.organization-tabs a.tab-active { border-bottom: 2px solid var(--style-b-accent); color: var(--style-b-accent); font-weight: 600; }
.style-b-card { margin-top: 18px; padding: 23px; border: 1px solid var(--style-b-line); border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
.opening-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; max-width: none; }
.opening-form h3, .section-heading h2 { margin: 0; color: var(--style-b-ink); font-size: 16px; }
.opening-form h3 { grid-column: 1 / -1; padding-bottom: 18px; border-bottom: 1px solid var(--style-b-line); }
.opening-form :deep(.el-form-item) { min-width: 0; max-width: none; margin: 0; }
.opening-form :deep(.el-form-item__label) { height: auto; margin: 0 0 7px; color: #647087; font-size: 12px; font-weight: 400; line-height: 1.65; }
.opening-form :deep(.el-input) { --el-input-height: 42px; }
.opening-form :deep(.el-input__wrapper) { padding: 1px 12px; }
.opening-form :deep(.el-form-item__content) { align-content: start; }
.opening-form .opening-email { grid-column: 1 / -1; }
.opening-form .hint { width: 100%; margin: 7px 0 0; color: #8a95a6; line-height: 1.8; }
.opening-actions { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 4px; padding-top: 18px; border-top: 1px solid var(--style-b-line); }
.opening-actions .hint { width: auto; margin: 0; }
.opening-actions .primary-button, .credential-panel .primary-button { flex-shrink: 0; min-height: 42px; margin: 0; padding: 8px 20px; border: 1px solid #4356e0; color: #fff; background: #4356e0; font-weight: 600; }
.opening-actions .primary-button:hover:not(:disabled), .credential-panel .primary-button:hover:not(:disabled) { border-color: #3343c9; background: #3343c9; }
.opening-actions .primary-button:disabled, .credential-panel .primary-button:disabled { opacity: .45; }
.opening-form :deep(.el-button:focus-visible), .credential-panel :deep(.el-button:focus-visible) { outline: 2px solid #8997ff; outline-offset: 3px; }
.opening-form select { min-height: 42px; padding: 8px 12px; font-size: 14px; }
.opening-form select:focus-visible { outline: 2px solid #8997ff; outline-offset: 3px; }
select { width: 100%; padding: 10px 12px; border: 1px solid #dfe4ee; border-radius: 8px; color: var(--style-b-ink); background: #fff; }
select:focus { border-color: var(--style-b-accent); outline: none; }
.children-list { margin-top: 18px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 4px; }
.section-heading .module-kicker { margin-bottom: 3px; }
.organization-row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) minmax(250px, 1.5fr) auto; align-items: center; gap: 20px; min-height: 82px; padding: 16px 0; border-top: 1px solid var(--style-b-line); overflow-wrap: anywhere; }
.organization-main { display: flex; align-items: center; gap: 11px; }
.organization-main h3 { margin: 0 0 3px; color: var(--style-b-ink); font-size: 14px; }
.organization-main p, .organization-contact small { margin: 0; color: var(--style-b-muted); font-size: 12px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #16885e; box-shadow: 0 0 0 4px #eaf7f0; }
.status-dot.inactive { background: #b97912; box-shadow: 0 0 0 4px #fff5e4; }
.organization-contact span { display: block; color: #9ba6bd; font-size: 10px; }
.organization-contact strong { display: block; margin: 2px 0; color: #465064; font-size: 12px; font-weight: 500; }
.row-action { color: var(--style-b-accent); font-size: 12px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.row-action:hover { text-decoration: underline; }
.credential-panel { max-width: 720px; border: 1px solid #dfe4ff; background: #f8f9ff; }
.detail-card .section-heading { margin-bottom: 18px; }
.detail-card h4 { margin: 0 0 8px; color: var(--style-b-ink); font-size: 20px; }
.handoff-values { overflow-wrap: anywhere; }
.handoff-values dd { margin: 8px 0 20px; color: var(--style-b-ink); font-family: Consolas, monospace; }

.account-description { color: #647087; font-size: 12px; line-height: 1.8; }
.account-row { display: grid; grid-template-columns: minmax(210px, 1fr) minmax(0, 1.6fr); align-items: center; gap: 28px; padding: 22px 0; border-top: 1px solid var(--style-b-line); overflow-wrap: anywhere; }
.account-parent { margin: 10px 0 0 19px; color: #647087; font-size: 12px; }
@media (max-width: 1100px) { .account-row { grid-template-columns: 1fr; gap: 16px; } }
@media (max-width: 1100px) { .organization-row { grid-template-columns: 1fr 1fr; } .row-action { justify-self: end; } }
@media (max-width: 600px) { .organization-heading { display: block; } .organization-tabs { gap: 16px; } .style-b-card { padding: 18px 16px; } .organization-row { grid-template-columns: 1fr; gap: 10px; } .row-action { justify-self: start; } }
@media (max-width: 600px) {
  .opening-form { grid-template-columns: minmax(0, 1fr); }
  .opening-actions { align-items: stretch; flex-direction: column; gap: 12px; }
}
</style>
