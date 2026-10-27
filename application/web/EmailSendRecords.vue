<template>
  <section class="email-send-records">
    <h3>邮件发送记录</h3>
    <p>仅显示本企业系统发送记录；受理不等于送达。</p>
    <el-button :disabled="busy" @click="load">刷新记录</el-button>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-empty v-if="!batches.length" description="暂无发送记录" />
    <article v-for="batch in batches" :key="batch.id" class="email-send-record">
      <strong>{{ batch.channel }} · {{ batch.count }} 封 · {{ batch.usageDay }}</strong>
      <p>受理 {{ batch.accepted }}，待确认 {{ batch.uncertain }}，跨日暂停 {{ batch.paused }}；回复地址 {{ batch.replyTo }}</p>
      <el-button :disabled="busy" @click="detail(batch.id)">查看逐收件人结果</el-button>
      <ul v-if="selectedBatchId === batch.id">
        <li v-for="recipient in recipients" :key="recipient.id">
          {{ recipient.email }} · {{ recipient.status }} · {{ recipient.subject }} · {{ recipient.detail || '无补充信息' }}
        </li>
      </ul>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElEmpty } from 'element-plus';

interface Batch {
  id: string;
  channel: string;
  count: number;
  usageDay: string;
  accepted: number;
  uncertain: number;
  paused: number;
  replyTo: string;
}
interface Recipient { id: string; email: string; status: string; subject: string; detail: string | null }
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const batches = ref<Batch[]>([]);
const recipients = ref<Recipient[]>([]);
const selectedBatchId = ref('');
const busy = ref(false);
const error = ref('');
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
onMounted(() => { void load(); });
</script>
