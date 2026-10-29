<template>
  <article class="profile-detail" @input="markDirty" @change="markDirty">
    <header class="profile-detail-heading">
      <span class="profile-avatar" aria-hidden="true">{{ profile.name.slice(0, 1).toUpperCase() }}</span>
      <div>
        <p>企业档案 / {{ profile.countryCode3 }}</p>
        <h2>{{ profile.name }} · {{ profile.countryCode3 }}</h2>
      </div>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="unknown" role="status">请求结果尚未确认，已保留原请求，请勿重复提交。返回本档案核实结果。</p>
    <p v-if="unresolved" class="hint">待核实请求标识：{{ unresolved.body.queryId ?? unresolved.body.previewId ?? unresolved.body.batchId ?? profile.id }}</p>
    <div :key="revision">
      <div data-draft="editor">
        <CompanyProfileEditor
          :profile="profile"
          :can-delete="canDelete"
          :request="trackedRequest"
          @changed="changed"
        />
      </div>
      <template v-if="!profile.deletedAt">
        <section class="profile-source">
        <div class="source-heading">
          <div>
            <p class="source-kicker">企业信息</p>
            <h3>企业详情</h3>
            <p class="source-fetched">最近获取 <strong>{{ formatFetchedAt(profile.fetchedAt, '历史获取时间未知') }}</strong></p>
          </div>
          <button class="source-refresh" :disabled="!!inFlight || unknown" @click="quoteRefresh">主动更新企业详情</button>
        </div>
        <div v-if="refreshQuote" class="search-summary source-quote">
          <div class="source-quote-copy">
            <strong>确认本次企业详情费用</strong>
            <span>{{ refreshQuote.name }} · {{ refreshQuote.countryCode3 }}</span>
            <span>最高扣点 {{ refreshQuote.maximumPoints }} · 系数 {{ refreshQuote.coefficient }}</span>
          </div>
          <div class="source-quote-actions">
            <button :disabled="!!inFlight || unknown" @click="refreshQuote = null">取消</button>
            <button class="source-confirm" :disabled="!!inFlight || unknown" @click="executeRefresh">再次确认费用并更新</button>
          </div>
        </div>
        <p v-if="status" role="status">{{ status }}</p>
        <details class="profile-source-data">
          <summary>查看完整企业信息</summary>
          <pre>{{ JSON.stringify(profile.detail, null, 2) }}</pre>
        </details>
        </section>
        <div data-draft="contacts">
          <CompanyContacts :profile="profile" :request="trackedRequest" @updated="changed" />
        </div>
        <div data-draft="timeline">
          <CompanyTimeline
            :profile-id="profile.id"
            :current-account-id="currentAccountId"
            :can-delete="canDelete"
            :request="trackedRequest"
          />
        </div>
      </template>
    </div>
  </article>
</template>

<script setup lang="ts">
import { onActivated, ref, watch } from 'vue';
import { HttpError } from '../../../api/http';
import type { CompanyProfile, CompanyRequest } from '../../../api/companyProfiles';
import { useFormLeave } from '../../../router/formLeave';
import { formatFetchedAt } from '../../../utils/formatFetchedAt';
import CompanyProfileEditor from './CompanyProfileEditor.vue';
import CompanyContacts from './CompanyContacts.vue';
import CompanyTimeline from './CompanyTimeline.vue';

const props = defineProps<{
  profile: CompanyProfile;
  visible: boolean;
  currentAccountId: string;
  canDelete: boolean;
  request: CompanyRequest;
}>();
const emit = defineEmits<{ changed: [] }>();
interface RefreshQuote {
  queryId: string;
  name: string;
  countryCode3: string;
  coefficient: string;
  maximumPoints: string;
  state?: string;
}
const refreshQuote = ref<RefreshQuote | null>(null);
const revision = ref(0);
const resetPending = ref(false);
const inFlight = ref(0);
const unknown = ref(false);
const unresolved = ref<{ path: string; body: Record<string, unknown> } | null>(null);
const dirty = ref(new Set<string>());
const error = ref('');
const status = ref('');
const readPaths = new Set([
  'company-profiles/history', 'company-contacts/profile', 'company-timeline/list',
  'company-attachments/list', 'company-attachments/download'
]);
function markDirty(event: Event) {
  const scope = (event.target as HTMLElement).closest<HTMLElement>('[data-draft]')?.dataset.draft;
  if (scope) dirty.value.add(scope);
}
useFormLeave({
  active: () => props.visible,
  state: () => inFlight.value ? 'submitting' : unknown.value ? 'unknown' : dirty.value.size || refreshQuote.value ? 'dirty' : 'clean',
  retainUnknown: true,
  discard: () => {
    dirty.value.clear();
    refreshQuote.value = null;
    resetPending.value = true;
  }
});
function resetDiscarded() {
  if (!props.visible || !resetPending.value) return;
  resetPending.value = false;
  revision.value += 1;
}
watch(() => props.visible, resetDiscarded);
onActivated(resetDiscarded);
const trackedRequest: CompanyRequest = async (path, body) => {
  const mutation = !!body && !readPaths.has(path);
  if (mutation && unknown.value) throw new Error('原请求结果尚未确认，请勿重复提交');
  if (mutation) inFlight.value += 1;
  try {
    const result = await props.request(path, body);
    const pendingQuery = result && typeof result === 'object' && 'state' in result && result.state === 'pending';
    const pendingRecipients = result && typeof result === 'object' && 'recipients' in result &&
      Array.isArray(result.recipients) && result.recipients.some((recipient: { status: string }) =>
        ['uncertain', 'submitting'].includes(recipient.status)
      );
    if (mutation && (pendingQuery || pendingRecipients)) {
      unknown.value = true;
      unresolved.value = { path, body: structuredClone(body!) };
    }
    if (path === 'company-profiles/update') dirty.value.delete('editor');
    if (['company-timeline/create', 'company-timeline/edit'].includes(path)) dirty.value.delete('timeline');
    if (path === 'email-drafts') dirty.value.delete('contacts');
    return result;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '档案操作失败';
    if (mutation && (!(failure instanceof HttpError) || failure.status >= 500)) {
      unknown.value = true;
      unresolved.value = { path, body: structuredClone(body!) };
    }
    throw failure;
  } finally {
    if (mutation) inFlight.value -= 1;
  }
};
function changed() {
  emit('changed');
}
async function quoteRefresh() {
  error.value = '';
  try {
    refreshQuote.value = await trackedRequest('company-details/refresh-quote', { profileId: props.profile.id }) as RefreshQuote;
  } catch { /* trackedRequest displays the failure. */ }
}
async function executeRefresh() {
  if (!refreshQuote.value || inFlight.value || unknown.value) return;
  const queryId = refreshQuote.value.queryId;
  try {
    const response = await trackedRequest('company-details/execute', { queryId }) as { state: string; chargedPoints: string | null };
    status.value = response.state === 'pending' ? '更新结果确认中，冻结保留；请勿重复发起' :
      response.state === 'zero' ? '本次更新无匹配，原档案保留' : `企业详情已更新，实际扣点 ${response.chargedPoints}`;
    if (response.state !== 'pending') refreshQuote.value = null;
    changed();
  } catch { /* Keep the original quote and request context. */ }
}
</script>

<style scoped>
.profile-detail { min-width: 0; overflow-wrap: anywhere; }
.profile-detail-heading { display: flex; align-items: center; gap: 14px; padding: 22px 24px; margin-bottom: 16px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; }
.profile-avatar { display: grid; flex-shrink: 0; width: 48px; height: 48px; place-items: center; border: 1px solid #dce1fc; border-radius: 12px; background: #eff2ff; color: #4356e0; font-size: 22px; font-weight: 700; }
.profile-detail-heading p { margin: 0 0 5px; color: #8b95a5; font-size: 11px; }
.profile-detail-heading h2 { margin: 0; color: #263052; font-size: 18px; line-height: 1.5; }
.profile-detail :deep(.profile-editor), .profile-source, .profile-detail :deep(.contact-panel), .profile-detail :deep(.timeline-panel) { min-width: 0; margin-bottom: 16px; padding: 22px 24px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; }
.profile-detail :deep(h3), .profile-detail :deep(h4) { margin: 0 0 14px; color: #263052; font-size: 14px; font-weight: 600; }
.profile-detail :deep(p), .profile-detail :deep(.hint) { font-size: 12px; line-height: 1.8; }
.profile-detail :deep(.el-form-item__label) { color: #647087; font-size: 12px; }
.profile-detail :deep(.profile-editor > .el-form) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; margin-top: 18px; }
.profile-detail :deep(.profile-editor .el-form > .el-button) { justify-self: start; margin: 0 0 16px; }
.profile-detail :deep(.el-form-item) { min-width: 0; margin-bottom: 16px; }
.profile-detail :deep(.el-form-item__content), .profile-detail :deep(.el-select) { min-width: 0; }
.profile-detail :deep(.el-input__wrapper), .profile-detail :deep(.el-textarea__inner), .profile-detail :deep(.el-select__wrapper) { border-radius: 8px; }
.profile-detail :deep(select) { width: 100%; min-width: 0; min-height: 34px; padding: 6px 10px; border: 1px solid #dfe4ee; border-radius: 8px; background: #fff; color: #465064; font: inherit; font-size: 12px; }
.profile-detail :deep(button) { max-width: 100%; font-size: 12px; white-space: normal; }
.source-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.source-heading > div { min-width: 0; }
.profile-source .source-kicker { margin: 0 0 3px; color: #8190aa; font-size: 10px; letter-spacing: .1em; }
.profile-source .source-heading h3 { margin: 0 0 5px; font-size: 16px; }
.profile-source .source-fetched { margin: 0; color: #7a879c; font-size: 12px; }
.source-fetched strong { margin-left: 5px; color: #42506c; font-weight: 500; font-variant-numeric: tabular-nums; }
.profile-source .source-refresh, .source-quote-actions button { min-height: 36px; padding: 7px 13px; border: 1px solid #dfe4ee; border-radius: 8px; background: #fff; color: #4356e0; font: inherit; font-size: 12px; cursor: pointer; }
.profile-source .source-refresh:hover, .source-quote-actions button:hover { border-color: #b5bff6; background: #f4f6ff; }
.profile-detail :deep(.search-summary.source-quote) { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 0; padding: 16px 18px; }
.source-quote-copy { display: grid; gap: 3px; min-width: 0; }
.source-quote-copy strong { color: #263052; font-size: 13px; }
.source-quote-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.source-quote-actions .source-confirm { border-color: #4356e0; background: #4356e0; color: #fff; font-weight: 600; }
.source-quote-actions .source-confirm:hover { border-color: #3343c9; background: #3343c9; color: #fff; }
.profile-source button:disabled { opacity: .5; cursor: not-allowed; }
.profile-detail :deep(.search-summary) { flex-wrap: wrap; gap: 10px; padding: 12px; border: 1px solid #e1e6fc; border-radius: 8px; background: #f6f8ff; color: #53617e; font-size: 12px; }
.profile-source-data { margin-top: 16px; border-top: 1px solid #eef0f6; padding-top: 14px; color: #647087; font-size: 12px; }
.profile-detail :deep(summary) { cursor: pointer; }
.profile-detail :deep(pre) { max-width: 100%; overflow: auto; padding: 14px; border: 1px solid #e9edf5; border-radius: 8px; background: #f7f9fc; color: #53617e; font: 11px/1.8 Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.profile-detail :deep(.email-composer) { padding-top: 22px; margin-top: 22px; border-top: 1px solid #e6e9f0; }
.profile-detail :deep(.email-contact), .profile-detail :deep(.candidate-row) { flex-wrap: wrap; padding: 14px 0; border-bottom: 1px solid #edf0f6; font-size: 12px; }
.profile-detail :deep(.attachment-panel) { border-top-color: #e6e9f0; padding-top: 18px; margin-top: 20px; }
.profile-detail :deep(input[type="file"]) { max-width: 100%; padding: 10px; border: 1px dashed #dce1ee; border-radius: 8px; background: #f8f9fc; color: #738095; font-size: 12px; }
.profile-detail :deep(input[type="file"]::file-selector-button) { margin-right: 10px; padding: 5px 10px; border: 0; border-radius: 5px; background: #e9edff; color: #4356e0; cursor: pointer; }
.profile-detail :deep(.attachment-row) { flex-wrap: wrap; gap: 8px; padding: 10px 0; border-bottom: 1px solid #eef0f6; font-size: 12px; }
.profile-detail :deep(.timeline-filter) { flex-wrap: wrap; }
.profile-detail :deep(.timeline-entry) { padding: 18px 0; border-top-color: #e6e9f0; font-size: 12px; }
.profile-detail :deep(.timeline-entry > strong) { color: #4356e0; font-weight: 600; }
.profile-detail :deep(.timeline-entry small) { color: #98a1b0; font-size: 11px; }
.profile-detail > p[role="alert"] { padding: 12px 16px; border: 1px solid #f2d6da; border-radius: 8px; background: #fff0f0; color: #a13d49; }
.profile-detail > p[role="status"] { padding: 12px 16px; border: 1px solid #f0dfbb; border-radius: 8px; background: #fff8e9; color: #946b26; }
@media (max-width: 1100px) and (min-width: 801px), (max-width: 480px) {
  .profile-detail :deep(.profile-editor > .el-form) { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .profile-detail-heading, .profile-detail :deep(.profile-editor), .profile-source, .profile-detail :deep(.contact-panel), .profile-detail :deep(.timeline-panel) { padding: 18px 16px; }
  .profile-detail-heading h2 { font-size: 16px; }
  .profile-avatar { width: 40px; height: 40px; font-size: 18px; }
  .source-heading, .source-quote-actions { align-items: stretch; flex-direction: column; }
  .profile-source .source-refresh, .source-quote-actions button { width: 100%; }
  .profile-detail :deep(.search-summary.source-quote) { align-items: stretch; }
}
</style>
