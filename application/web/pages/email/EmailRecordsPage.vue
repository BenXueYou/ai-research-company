<template>
  <section class="email-records" aria-label="本企业邮件发送记录">
    <header class="records-heading">
      <div>
        <h1>邮件发送记录</h1>
        <p>本企业共享发送记录；受理不等于送达。核对渠道证据不会重发邮件，重发、重新确认与执行需主动操作。</p>
      </div>
      <el-button :disabled="busy || reading" @click="refresh">刷新记录</el-button>
    </header>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <div v-if="pending" class="pending-card" role="status">
      <p>请求结果尚未确认：{{ pending.label }}。请查看原批次最新结果后再决定后续操作。</p>
      <p>批次 {{ pending.batchId }} · 收件人 {{ pending.body.recipientId }}</p>
      <el-button :disabled="busy || reading" @click="verifyPending">查看原批次核实结果</el-button>
    </div>
    <p v-if="reading" class="records-loading" role="status">正在读取发送记录…</p>
    <el-empty v-else-if="!batches.length && !error" class="records-empty" description="暂无发送记录" />
    <div v-if="batches.length" class="records-panel">
      <div class="panel-heading">
        <h2>发送批次</h2>
        <span>{{ batches.length }} 个批次</span>
      </div>
      <div class="list-columns" aria-hidden="true">
        <span>发送渠道 / 数量</span><span>额度日期</span><span>回复地址</span><span>发送结果</span><span>操作</span>
      </div>
      <div class="records-list">
        <article
          v-for="batch in batches"
          :key="batch.id"
          class="email-record"
          :class="{ 'is-selected': selectedBatch?.id === batch.id }"
        >
          <div class="record-heading">
            <strong>{{ batch.channel }}</strong>
            <span>{{ batch.count }} 封邮件</span>
          </div>
          <div class="record-day"><span class="mobile-label">额度日期</span>{{ usageDayLabel(batch.usageDay) }}</div>
          <p class="record-address"><span class="mobile-label">回复地址</span>{{ batch.replyTo }}</p>
          <div class="record-summary">
            <span class="summary-accepted">受理 <b>{{ batch.accepted }}</b></span>
            <span class="summary-delivered">有证据送达 <b>{{ batch.delivered }}</b></span>
            <span class="summary-uncertain">待确认 <b>{{ batch.uncertain }}</b></span>
            <span class="summary-paused">跨日暂停 <b>{{ batch.paused }}</b></span>
          </div>
          <RouterLink
            class="record-link"
            :to="{ path: '/terminal/emails', query: { batchId: batch.id } }"
            :aria-current="selectedBatch?.id === batch.id ? 'true' : undefined"
          >查看逐收件人结果<span aria-hidden="true"> →</span></RouterLink>
        </article>
      </div>
    </div>
    <section v-if="selectedBatch" aria-label="发送批次详情" class="email-detail">
      <div class="detail-heading">
        <div>
          <h2>发送批次详情</h2>
          <p>批次 {{ selectedBatch.id }} · {{ selectedBatch.channel }} · 回复地址 {{ selectedBatch.replyTo }}</p>
        </div>
        <div class="detail-links">
          <RouterLink :to="{ path: '/terminal/profiles', query: { id: selectedBatch.profileId } }">查看企业档案</RouterLink>
          <RouterLink to="/terminal/emails">返回发送记录</RouterLink>
        </div>
      </div>
      <ul class="recipient-list">
        <li
          v-for="recipient in recipients"
          :key="recipient.id"
          class="email-recipient"
          :data-status="recipient.status"
        >
          <p class="recipient-heading"><strong>{{ recipient.email }}</strong><span class="recipient-status" :class="`recipient-status-${recipient.status}`">{{ statusLabel(recipient.status) }}</span></p>
          <h3 class="recipient-subject">{{ recipient.subject }}</h3>
          <p class="recipient-evidence">{{ recipient.detail || '无补充信息' }}</p>
          <p class="email-content">{{ recipient.content }}</p>
          <p v-if="recipient.parentRecipientId">人工重发，额度日期 {{ usageDayLabel(recipient.usageDay) }}</p>
          <p v-if="recipient.status === 'paused'">原额度日期 {{ usageDayLabel(recipient.usageDay) }}，原日预占已释放</p>
          <el-button
            v-if="recipient.status === 'paused'"
            :disabled="busy || reading || !!pending"
            @click="reconfirm(recipient)"
          >重新确认今日额度</el-button>
          <el-button
            v-if="recipient.status === 'queued' && recipient.reconfirmedUsageDay"
            :disabled="busy || reading || !!pending"
            @click="operate('execute', { recipientId: recipient.id }, '执行已重确认收件人')"
          >执行已重确认收件人</el-button>
          <el-button
            v-if="['submitting', 'uncertain', 'accepted'].includes(recipient.status)"
            :disabled="busy || reading || !!pending"
            @click="operate('reconcile', { recipientId: recipient.id }, '核对渠道证据')"
          >核对渠道证据</el-button>
          <el-button
            v-if="recipient.status === 'uncertain' && recipient.checkedAt"
            :disabled="busy || reading || !!pending"
            @click="retry(recipient.id)"
          >决定重发</el-button>
        </li>
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import {
  onActivated,
  onScopeDispose,
  ref,
  shallowRef,
  watch
} from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElMessageBox
} from 'element-plus';
import {
  emailRecordsApi,
  type EmailBatch,
  type EmailRecipient,
  type EmailRecordRequest
} from '../../api/emailRecords';
import { HttpError } from '../../api/http';
import { useFormLeave } from '../../router/formLeave';

defineOptions({ name: 'EmailRecordsPage' });
const props = defineProps<{ request: EmailRecordRequest; role?: string }>();
const api = emailRecordsApi(props.request);
const route = useRoute();
const router = useRouter();
const batches = shallowRef<EmailBatch[]>([]);
const recipients = shallowRef<EmailRecipient[]>([]);
const selectedBatch = shallowRef<EmailBatch | null>(null);
const busy = ref(false);
const reading = ref(false);
const error = ref('');
const pending = shallowRef<{ action: string; body: Record<string, unknown>; batchId: string; label: string } | null>(null);
let sequence = 0;
let alive = true;
let loadedBatchId = '';
let confirming = false;
function batchId() {
  return typeof route.query.batchId === 'string' ? route.query.batchId : '';
}
function statusLabel(status: string) {
  return ({
    queued: '排队中',
    submitting: '提交中待核对',
    accepted: '已提交发信服务',
    not_submitted: '发送失败',
    uncertain: '结果待确认',
    paused: '跨日暂停',
    delivered: '有证据送达'
  } as Record<string, string>)[status] ?? status;
}
function usageDayLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed);
}
async function refresh() {
  const current = ++sequence;
  const target = batchId();
  reading.value = true;
  error.value = '';
  selectedBatch.value = null;
  recipients.value = [];
  try {
    const list = await api.list();
    const detail = target ? await api.detail(target) : null;
    if (!alive || current !== sequence) return;
    batches.value = list.batches;
    selectedBatch.value = detail?.batch ?? null;
    recipients.value = detail?.recipients ?? [];
    loadedBatchId = target;
  } catch (failure) {
    if (!alive || current !== sequence) return;
    batches.value = [];
    error.value = failure instanceof Error ? failure.message : '加载发送记录失败';
  } finally {
    if (alive && current === sequence) reading.value = false;
  }
}
async function operate(action: string, body: Record<string, unknown>, label: string) {
  if (busy.value || reading.value || pending.value || !selectedBatch.value) return;
  busy.value = true;
  error.value = '';
  pending.value = {
    action,
    body,
    batchId: selectedBatch.value.id,
    label
  };
  try {
    await api.operate(action, body);
    if (!alive) return;
    pending.value = null;
    await refresh();
  } catch (failure) {
    if (!alive) return;
    if (failure instanceof HttpError && failure.status < 500) pending.value = null;
    error.value = failure instanceof Error ? failure.message : `${label}结果未确认`;
  } finally {
    if (alive) busy.value = false;
  }
}
async function retry(recipientId: string) {
  if (busy.value || pending.value) return;
  busy.value = true;
  confirming = true;
  try {
    await ElMessageBox.confirm('渠道核对后结果仍不明确。再次发送可能让收件人收到重复邮件，并将重新占用今日额度。确定重发吗？',
      '可能重复发送', { confirmButtonText: '明确重发', cancelButtonText: '取消', type: 'warning' });
  } catch {
    busy.value = false;
    return;
  } finally {
    confirming = false;
  }
  busy.value = false;
  if (alive) await operate('retry', { recipientId, confirmPossibleDuplicate: true }, '决定重发');
}
async function reconfirm(recipient: EmailRecipient) {
  if (busy.value || pending.value) return;
  busy.value = true;
  try {
    const quota = await api.quota();
    if (!alive) return;
    confirming = true;
    await ElMessageBox.confirm(
      `收件邮箱 ${recipient.email} 将按 ${quota.day} 的企业共享额度重新预占 1 封，当前剩余 ${quota.remaining} 封。请确认退订提示和本次发送。`,
      '跨日重新确认', { confirmButtonText: '确认今日额度', cancelButtonText: '取消', type: 'warning' });
  } catch (failure) {
    if (failure !== 'cancel' && failure !== 'close') error.value = failure instanceof Error ? failure.message : '跨日重新确认失败';
    busy.value = false;
    return;
  } finally {
    confirming = false;
  }
  busy.value = false;
  if (alive) await operate('reconfirm', {
    recipientId: recipient.id,
    confirmUnsubscribeNotice: true,
    confirmQuota: true
  }, '重新确认今日额度');
}
async function verifyPending() {
  if (busy.value || reading.value || !pending.value) return;
  const target = pending.value.batchId;
  if (batchId() !== target) await router.push({ path: '/terminal/emails', query: { batchId: target } });
  await refresh();
  if (!error.value && selectedBatch.value?.id === target) pending.value = null;
}
useFormLeave({
  state: () => busy.value ? 'submitting' : pending.value ? 'unknown' : 'clean',
  discard: () => {},
  retainUnknown: true
});
watch(() => [route.path, route.query.batchId], () => {
  if (route.path === '/terminal/emails') void refresh();
}, { immediate: true });
onActivated(() => {
  if (route.path === '/terminal/emails' && loadedBatchId !== batchId() && !reading.value) void refresh();
});
onScopeDispose(() => {
  alive = false;
  sequence += 1;
  if (confirming) ElMessageBox.close();
});
</script>

<style scoped>
.email-records {
  width: min(1180px, 100%);
  min-width: 0;
  color: var(--console-text);
}
.records-heading, .panel-heading, .detail-heading, .recipient-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.records-heading { margin-bottom: 22px; }
.records-heading h1 { margin: 0 0 7px; font-size: 24px; line-height: 1.4; letter-spacing: -.4px; }
.records-heading p { max-width: 730px; margin: 0; color: var(--console-muted); font-size: 13px; line-height: 1.8; }
.records-heading :deep(.el-button) { flex: none; margin-top: 3px; border-radius: 8px; }
.email-records > :deep(.el-alert) { margin-bottom: 16px; }
.pending-card {
  padding: 16px 18px;
  margin-bottom: 18px;
  border: 1px solid #e9d9b9;
  border-radius: 10px;
  color: #805b22;
  background: #fff9ee;
}
.pending-card p { margin: 0 0 8px; color: inherit; font-size: 13px; overflow-wrap: anywhere; }
.records-loading { padding: 14px 0; color: var(--console-muted); }
.records-empty, .records-panel, .email-detail {
  min-width: 0;
  border: 1px solid var(--console-line);
  border-radius: 12px;
  background: var(--console-surface);
  box-shadow: 0 2px 5px #19234605;
}
.records-panel { overflow: hidden; }
.panel-heading { align-items: center; padding: 20px 22px; }
.panel-heading h2, .detail-heading h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.5; }
.panel-heading > span { color: var(--console-muted); font-size: 12px; }
.list-columns, .email-record {
  display: grid;
  grid-template-columns: minmax(95px, .8fr) 105px minmax(140px, 1.3fr) minmax(205px, 1.5fr) 132px;
  align-items: center;
  gap: 18px;
  padding: 17px 22px;
}
.list-columns { border-top: 1px solid #edf0f6; background: #f8f9fd; color: var(--console-muted); font-size: 12px; }
.email-record { min-width: 0; border-top: 1px solid #edf0f6; font-size: 13px; overflow-wrap: anywhere; }
.email-record:hover { background: #fafbff; }
.email-record.is-selected { background: #f5f6ff; box-shadow: inset 3px 0 var(--console-brand); }
.record-heading { display: grid; gap: 6px; }
.record-heading strong { width: fit-content; padding: 3px 8px; border: 1px solid #e0e5fd; border-radius: 5px; color: var(--console-brand); background: #eef1ff; font-size: 12px; line-height: 1.5; }
.record-heading > span { color: var(--console-muted); font-size: 12px; }
.record-day { color: #53617e; font-variant-numeric: tabular-nums; }
.record-address { min-width: 0; margin: 0; color: #53617e; font-size: 13px; }
.record-summary { display: grid; grid-template-columns: 1fr 1.25fr; gap: 8px; }
.record-summary > span { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 7px; border-radius: 4px; font-size: 11px; line-height: 1.5; }
.record-summary b { font-size: 12px; font-variant-numeric: tabular-nums; }
.summary-accepted { color: #5365c5; background: #eef1ff; }
.summary-delivered { color: #168764; background: #eaf7f0; }
.summary-uncertain { color: #94621b; background: #fff5e4; }
.summary-paused { color: #53617e; background: #edf0f5; }
.record-link, .detail-links a { color: var(--console-brand); font-size: 12px; text-decoration: none; line-height: 1.8; }
.record-link:hover, .detail-links a:hover { text-decoration: underline; }
.mobile-label { display: none; }
.email-detail { padding: 22px; margin-top: 20px; overflow-wrap: anywhere; }
.detail-heading { padding-bottom: 18px; border-bottom: 1px solid #edf0f6; }
.detail-heading p { margin: 8px 0 0; color: var(--console-muted); font-size: 12px; line-height: 1.8; }
.detail-links { display: flex; flex: none; flex-wrap: wrap; gap: 10px 16px; }
.recipient-list { display: grid; gap: 16px; padding: 20px 0 0; margin: 0; list-style: none; }
.email-recipient { min-width: 0; padding: 18px; border: 1px solid var(--console-line); border-radius: 9px; background: #fafbfe; }
.recipient-heading { align-items: center; flex-wrap: wrap; margin: 0 0 14px; }
.recipient-heading strong { font-size: 14px; overflow-wrap: anywhere; }
.recipient-heading .recipient-status { flex: none; padding: 4px 9px; border-radius: 5px; color: #5365c5; background: #eef1ff; font-size: 11px; line-height: 1.6; }
.recipient-heading .recipient-status-delivered { color: #168764; background: #e8f7f0; }
.recipient-heading .recipient-status-uncertain, .recipient-heading .recipient-status-submitting { color: #94621b; background: #fff3df; }
.recipient-heading .recipient-status-not_submitted { color: #b34957; background: #fff0f1; }
.recipient-heading .recipient-status-paused { color: #53617e; background: #edf0f5; }
.recipient-subject { margin: 0 0 6px; color: var(--console-text); font-size: 14px; font-weight: 600; line-height: 1.7; }
.recipient-evidence { margin: 0 0 12px; color: var(--console-muted); font-size: 12px; }
.email-content { padding: 16px; border: 1px solid #e9edf5; border-radius: 8px; margin: 0 0 12px; color: #46536a; background: #fff; font-size: 13px; line-height: 1.9; white-space: pre-wrap; }
.email-recipient > p:not([class]) { color: var(--console-muted); font-size: 12px; }
.email-recipient > .el-button { max-width: 100%; margin: 5px 8px 0 0; white-space: normal; height: auto; }
.record-link:focus-visible, .detail-links a:focus-visible { outline: 2px solid var(--console-brand); outline-offset: 3px; }
@media (max-width: 1100px) {
  .list-columns { display: none; }
  .email-record { grid-template-columns: 1fr 1fr; gap: 14px 20px; }
  .record-heading { display: flex; align-items: center; gap: 10px; }
  .record-day { text-align: right; }
  .record-summary { grid-column: 1 / -1; grid-row: 3; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .record-link { justify-self: end; }
  .record-address { grid-column: 1; grid-row: 2; }
  .mobile-label { display: inline; margin-right: 8px; color: var(--console-muted); font-size: 12px; }
}
@media (max-width: 760px) {
  .records-heading, .detail-heading { flex-direction: column; gap: 13px; }
  .panel-heading, .email-record, .email-detail { padding: 17px; }
  .email-record { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .record-day { text-align: left; }
  .record-address, .record-summary { grid-column: auto; grid-row: auto; }
  .record-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .record-link { justify-self: start; }
  .email-recipient { padding: 14px; }
  .recipient-heading { gap: 10px; }
}
</style>
