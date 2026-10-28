<template>
  <section class="workspace-card" aria-label="腾道共享账号监控">
    <h2>腾道共享账号</h2>
    <p>账户状态由平台主动查询。页面读取最近一次快照，不自动发起上游调用。</p>
    <el-button :disabled="busy || !overview?.configured" @click="refresh">更新上游状态</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="overview">
      <p v-if="!overview.configured">尚未配置正式腾道账号。</p>
      <template v-if="overview.snapshot">
        <p>上游剩余点数：{{ overview.snapshot.balance }}</p>
        <p>上游有效期：{{ overview.snapshot.expiresIn }}</p>
        <p>最近获取：{{ overview.snapshot.fetchedAt }}</p>
        <p>Trace ID：{{ overview.snapshot.traceId ?? '未返回' }}</p>
      </template>
      <p v-else>尚无上游账户快照。</p>
      <template v-if="overview.usage && overview.limits">
        <p>本分钟调用：{{ overview.usage.minute }} / {{ overview.limits.minute }}</p>
        <p>今日数据类调用：{{ overview.usage.dataToday }} / {{ overview.limits.dataToday }}</p>
        <p>今日业务类调用：{{ overview.usage.businessToday }} / {{ overview.limits.businessToday }}</p>
        <p>免费数据查询也计入数据类调用次数；次数与点数余额分别限制。</p>
      </template>
      <p v-if="overview.usageUnavailable">当前调用计数暂不可读取；历史账户快照仍可查看。</p>
      <h3>最近账户查询记录</h3>
      <ul>
        <li v-for="(event, index) in overview.events" :key="index">
          {{ event.happenedAt }} · {{ event.endpoint }} · {{ event.result }}
          <span v-if="event.category">（{{ categoryLabel(event.category) }}）</span>
          · {{ event.durationMs }} ms · {{ event.traceId ?? '无 Trace ID' }}
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { ElButton } from 'element-plus';

interface Overview {
  configured: boolean;
  snapshot: { balance: string; expiresIn: string; fetchedAt: string; traceId: string | null } | null;
  usage: { minute: number; dataToday: number; businessToday: number } | null;
  usageUnavailable: boolean;
  limits: { minute: number; dataToday: number; businessToday: number } | null;
  events: Array<{ endpoint: string; result: string; category: string | null; traceId: string | null; durationMs: number; happenedAt: string }>;
}
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const overview = shallowRef<Overview | null>(null);
const busy = shallowRef(false);
const error = shallowRef('');
function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    points_exhausted: '上游点数不足',
    daily_calls_exhausted: '今日调用次数耗尽',
    rate_limited: '调用频率受限',
    account_unavailable: '账号到期或不可用',
    upstream_unavailable: '上游服务异常'
  };
  return labels[value] ?? value;
}
async function load() {
  try {
    overview.value = await props.request('upstream-monitor') as Overview;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '监控状态读取失败';
  }
}
async function refresh() {
  busy.value = true;
  error.value = '';
  try {
    overview.value = await props.request('upstream-monitor/refresh', {}) as Overview;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '账户状态更新失败';
    await load();
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
