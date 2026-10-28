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
    <div v-if="batches.length" class="records-list">
      <article v-for="batch in batches" :key="batch.id" class="email-record">
        <div class="record-heading">
          <strong>{{ batch.channel }} · {{ batch.count }} 封</strong>
          <span>{{ usageDayLabel(batch.usageDay) }}</span>
        </div>
        <p class="record-address">回复地址 {{ batch.replyTo }}</p>
        <p class="record-summary">受理 {{ batch.accepted }}，有证据送达 {{ batch.delivered }}，待确认 {{ batch.uncertain }}，跨日暂停 {{ batch.paused }}</p>
        <RouterLink :to="{ path: '/terminal/emails', query: { batchId: batch.id } }">查看逐收件人结果</RouterLink>
      </article>
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
        <li v-for="recipient in recipients" :key="recipient.id" class="email-recipient" :data-status="recipient.status">
          <p class="recipient-heading"><strong>{{ recipient.email }}</strong><span class="recipient-status" :class="`recipient-status-${recipient.status}`">{{ statusLabel(recipient.status) }}</span></p>
          <p class="recipient-subject">{{ recipient.subject }} · {{ recipient.detail || '无补充信息' }}</p>
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
.records-heading, .record-heading, .detail-heading, .recipient-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.records-heading { margin-bottom: 22px; }
.records-heading h1 { margin: 0 0 7px; font-size: 24px; line-height: 1.4; }
.records-heading p { max-width: 700px; margin: 0; color: var(--console-muted); font-size: 13px; line-height: 1.8; }
.records-heading :deep(.el-button) { flex: none; margin-top: 3px; border-radius: 8px; }
.pending-card {
  padding: 16px 18px;
  margin-bottom: 18px;
  border: 1px solid #e9d9b9;
  border-radius: 10px;
  color: #805b22;
  background: #fff9ee;
}
.pending-card p { margin: 0 0 8px; overflow-wrap: anywhere; }
.records-loading { padding: 14px 0; color: var(--console-muted); }
.records-empty { border: 1px solid var(--console-line); border-radius: 12px; background: #fff; }
.records-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.email-record, .email-detail {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--console-line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 5px #19234605;
  overflow-wrap: anywhere;
}
.email-record { border-left: 3px solid var(--console-brand); }
.record-heading strong { font-size: 16px; line-height: 1.5; }
.record-heading span { flex: none; padding: 4px 8px; border-radius: 5px; color: #5365c5; background: #eef1ff; font-size: 11px; }
.record-address { margin: 13px 0 17px; color: var(--console-muted); font-size: 12px; }
.record-summary { padding: 12px 0; margin: 0 0 13px; border-top: 1px solid #edf0f6; border-bottom: 1px solid #edf0f6; color: #46536a; font-size: 13px; line-height: 1.7; }
.email-record a, .detail-links a { color: var(--console-brand); font-size: 13px; text-decoration: none; }
.email-record a:hover, .detail-links a:hover { text-decoration: underline; }
.email-detail { margin-top: 20px; }
.detail-heading { padding-bottom: 16px; border-bottom: 1px solid #edf0f6; }
.detail-heading h2 { margin: 0 0 7px; font-size: 18px; }
.detail-heading p { margin: 0; color: var(--console-muted); font-size: 12px; line-height: 1.7; }
.detail-links { display: flex; flex: none; gap: 16px; }
.recipient-list { display: grid; gap: 12px; padding: 18px 0 0; margin: 0; list-style: none; }
.email-recipient { padding: 18px; border: 1px solid #edf0f6; border-radius: 9px; background: #fafbfe; }
.recipient-heading { align-items: center; flex-wrap: wrap; margin: 0 0 8px; }
.recipient-heading strong { font-size: 14px; overflow-wrap: anywhere; }
.recipient-heading span { flex: none; padding: 3px 8px; border-radius: 5px; color: #5365c5; background: #eef1ff; font-size: 11px; }
.email-recipient[data-status='delivered'] .recipient-heading span { color: #168764; background: #eaf7f0; }
.email-recipient[data-status='uncertain'] .recipient-heading span,
.email-recipient[data-status='paused'] .recipient-heading span { color: #a8731e; background: #fff5e4; }
.email-recipient[data-status='not_submitted'] .recipient-heading span { color: #b54b55; background: #fff0f1; }
.recipient-heading .recipient-status-delivered { color: #168764; background: #e8f7f0; }
.recipient-heading .recipient-status-uncertain, .recipient-heading .recipient-status-submitting { color: #9b691d; background: #fff3df; }
.recipient-heading .recipient-status-not_submitted { color: #b34957; background: #fff0f1; }
.recipient-heading .recipient-status-paused { color: #53617e; background: #edf0f5; }
.recipient-subject { margin: 0 0 10px; color: #56637b; font-size: 13px; }
.email-content { padding: 14px; border: 1px solid #e9edf5; border-radius: 8px; margin: 0 0 12px; background: #fff; white-space: pre-wrap; }
.email-recipient > .el-button { margin: 5px 8px 0 0; }
.email-record a:focus-visible, .detail-links a:focus-visible { outline: 2px solid var(--console-brand); outline-offset: 3px; }
@media (max-width: 760px) {
  .records-heading, .detail-heading { flex-direction: column; gap: 13px; }
  .records-list { grid-template-columns: minmax(0, 1fr); }
  .email-record, .email-detail { padding: 17px; }
  .detail-links { flex-wrap: wrap; }
}
</style>
