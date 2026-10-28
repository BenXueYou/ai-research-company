<template>
  <section class="email-send-records">
    <h3>邮件发送记录</h3>
    <p>仅显示本企业系统发送记录；受理不等于送达。</p>
    <el-button :disabled="busy" @click="load">刷新记录</el-button>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-empty v-if="!batches.length" description="暂无发送记录" />
    <article v-for="batch in batches" :key="batch.id" class="email-send-record">
      <strong>{{ batch.channel }} · {{ batch.count }} 封 · {{ batch.usageDay }}</strong>
      <p>受理 {{ batch.accepted }}，有证据送达 {{ batch.delivered }}，待确认 {{ batch.uncertain }}，跨日暂停 {{ batch.paused }}；回复地址 {{ batch.replyTo }}</p>
      <el-button :disabled="busy" @click="detail(batch.id)">查看逐收件人结果</el-button>
      <ul v-if="selectedBatchId === batch.id">
        <li v-for="recipient in recipients" :key="recipient.id">
          {{ recipient.email }} · {{ statusLabel(recipient.status) }} · {{ recipient.subject }} · {{ recipient.detail || '无补充信息' }}
          <span v-if="recipient.parentRecipientId">（人工重发，额度日期 {{ recipient.usageDay }}）</span>
          <span v-if="recipient.status === 'paused'">（原额度日期 {{ recipient.usageDay }}，原日预占已释放）</span>
          <el-button v-if="recipient.status === 'paused'" :disabled="busy"
            @click="reconfirm(recipient.id, recipient.email, batch.id)">重新确认今日额度</el-button>
          <el-button v-if="recipient.status === 'queued' && recipient.reconfirmedUsageDay"
            :disabled="busy" @click="executeReconfirmed(recipient.id, batch.id)">执行已重确认收件人</el-button>
          <el-button v-if="['submitting', 'uncertain', 'accepted'].includes(recipient.status)" :disabled="busy"
            @click="reconcile(recipient.id, batch.id)">核对渠道证据</el-button>
          <el-button v-if="recipient.status === 'uncertain' && recipient.checkedAt" :disabled="busy"
            @click="retry(recipient.id, batch.id)">决定重发</el-button>
        </li>
      </ul>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElEmpty, ElMessageBox } from 'element-plus';

interface Batch {
  id: string;
  channel: string;
  count: number;
  usageDay: string;
  accepted: number;
  delivered: number;
  uncertain: number;
  paused: number;
  replyTo: string;
}
interface Recipient {
  id: string; email: string; status: string; subject: string; detail: string | null;
  checkedAt: string | null; parentRecipientId: string | null; usageDay: string;
  reconfirmedUsageDay: string | null;
}
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const batches = ref<Batch[]>([]);
const recipients = ref<Recipient[]>([]);
const selectedBatchId = ref('');
const busy = ref(false);
const error = ref('');
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
async function load() {
  busy.value = true;
  error.value = '';
  try {
    batches.value = (await props.request('email-batches') as { batches: Batch[] }).batches;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '加载发送记录失败';
  } finally {
    busy.value = false;
  }
}
async function detail(batchId: string) {
  busy.value = true;
  error.value = '';
  try {
    recipients.value = (await props.request('email-batches/detail', { batchId }) as { recipients: Recipient[] }).recipients;
    selectedBatchId.value = batchId;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '加载收件人结果失败';
  } finally {
    busy.value = false;
  }
}
async function reconcile(recipientId: string, batchId: string) {
  busy.value = true;
  error.value = '';
  try {
    await props.request('email-recipients/reconcile', { recipientId });
    await detail(batchId);
    await load();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '渠道证据核对失败';
  } finally {
    busy.value = false;
  }
}
async function retry(recipientId: string, batchId: string) {
  try {
    await ElMessageBox.confirm('渠道核对后结果仍不明确。再次发送可能让收件人收到重复邮件，并将重新占用今日额度。确定重发吗？',
      '可能重复发送', { confirmButtonText: '明确重发', cancelButtonText: '取消', type: 'warning' });
  } catch { return; }
  busy.value = true;
  error.value = '';
  try {
    await props.request('email-recipients/retry', { recipientId, confirmPossibleDuplicate: true });
    await detail(batchId);
    await load();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '重发失败';
  } finally {
    busy.value = false;
  }
}
async function reconfirm(recipientId: string, email: string, batchId: string) {
  busy.value = true;
  error.value = '';
  try {
    const quota = await props.request('email-quota') as { day: string; remaining: number };
    await ElMessageBox.confirm(
      `收件邮箱 ${email} 将按 ${quota.day} 的企业共享额度重新预占 1 封，当前剩余 ${quota.remaining} 封。请确认退订提示和本次发送。`,
      '跨日重新确认', { confirmButtonText: '确认今日额度', cancelButtonText: '取消', type: 'warning' });
    await props.request('email-recipients/reconfirm', {
      recipientId,
      confirmUnsubscribeNotice: true,
      confirmQuota: true
    });
    await detail(batchId);
    await load();
  } catch (failure) {
    if (failure !== 'cancel') error.value = failure instanceof Error ? failure.message : '跨日重新确认失败';
  } finally {
    busy.value = false;
  }
}
async function executeReconfirmed(recipientId: string, batchId: string) {
  busy.value = true;
  error.value = '';
  try {
    await props.request('email-recipients/execute', { recipientId });
    await detail(batchId);
    await load();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '执行收件人失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => { void load(); });
</script>
