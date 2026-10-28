<template>
  <section class="email-records" aria-label="本企业邮件发送记录">
    <h1>邮件发送记录</h1>
    <p>本企业共享发送记录；受理不等于送达。核对渠道证据不会重发邮件，重发、重新确认与执行需主动操作。</p>
    <el-button :disabled="busy || reading" @click="refresh">刷新记录</el-button>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <div v-if="pending" role="status">
      <p>请求结果尚未确认：{{ pending.label }}。请查看原批次最新结果后再决定后续操作。</p>
      <p>批次 {{ pending.batchId }} · 收件人 {{ pending.body.recipientId }}</p>
      <el-button :disabled="busy || reading" @click="verifyPending">查看原批次核实结果</el-button>
    </div>
    <p v-if="reading" role="status">正在读取发送记录…</p>
    <el-empty v-else-if="!batches.length && !error" description="暂无发送记录" />
    <article v-for="batch in batches" :key="batch.id" class="email-record">
      <strong>{{ batch.channel }} · {{ batch.count }} 封 · {{ batch.usageDay }}</strong>
      <p>受理 {{ batch.accepted }}，有证据送达 {{ batch.delivered }}，待确认 {{ batch.uncertain }}，跨日暂停 {{ batch.paused }}；回复地址 {{ batch.replyTo }}</p>
      <RouterLink :to="{ path: '/terminal/emails', query: { batchId: batch.id } }">查看逐收件人结果</RouterLink>
    </article>
    <section v-if="selectedBatch" aria-label="发送批次详情" class="email-detail">
      <h2>发送批次详情</h2>
      <p>批次 {{ selectedBatch.id }} · {{ selectedBatch.channel }} · 回复地址 {{ selectedBatch.replyTo }}</p>
      <RouterLink :to="{ path: '/terminal/profiles', query: { id: selectedBatch.profileId } }">查看企业档案</RouterLink>
      <RouterLink to="/terminal/emails">返回发送记录</RouterLink>
      <ul>
        <li v-for="recipient in recipients" :key="recipient.id" class="email-recipient">
          <p>{{ recipient.email }} · {{ statusLabel(recipient.status) }} · {{ recipient.subject }} · {{ recipient.detail || '无补充信息' }}</p>
          <p class="email-content">{{ recipient.content }}</p>
          <p v-if="recipient.parentRecipientId">人工重发，额度日期 {{ recipient.usageDay }}</p>
          <p v-if="recipient.status === 'paused'">原额度日期 {{ recipient.usageDay }}，原日预占已释放</p>
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
.email-record { margin-top: 20px; border-top: 1px solid #e5e7f1; padding-top: 16px; }
.email-detail { margin-top: 28px; overflow-wrap: anywhere; }
.email-detail a { margin-right: 20px; }
.email-recipient { margin-top: 20px; }
.email-content { white-space: pre-wrap; }
</style>
