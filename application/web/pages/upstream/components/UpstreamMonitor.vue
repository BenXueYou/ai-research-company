<template>
  <section class="workspace-card upstream-monitor" aria-label="腾道共享账号监控">
    <header class="monitor-heading">
      <div>
        <p class="section-kicker">上游服务</p>
        <h2>腾道共享账号</h2>
        <p class="monitor-description">账户状态由平台主动查询。页面读取最近一次快照，不自动发起上游调用。</p>
      </div>
      <div class="monitor-actions">
        <RouterLink v-if="!props.standalone" to="/platform/reconciliation/upstream">查看上游监控页面</RouterLink>
        <el-button :disabled="busy || !overview?.configured" @click="refresh">更新上游状态</el-button>
      </div>
    </header>
    <p v-if="error" class="monitor-alert" role="alert">{{ error }}</p>
    <template v-if="overview">
      <p v-if="!overview.configured" class="monitor-note">尚未配置正式腾道账号。</p>
      <template v-if="overview.snapshot">
        <div class="snapshot-grid">
          <p class="snapshot-balance">上游剩余点数：<strong>{{ overview.snapshot.balance }}</strong></p>
          <p class="snapshot-expiry">上游有效期：<strong>{{ overview.snapshot.expiresIn }}</strong></p>
        </div>
        <div class="snapshot-meta">
          <p>最近获取：{{ overview.snapshot.fetchedAt }}</p>
          <p>Trace ID：{{ overview.snapshot.traceId ?? '未返回' }}</p>
        </div>
      </template>
      <p v-else class="monitor-empty">尚无上游账户快照。</p>
      <template v-if="overview.usage && overview.limits">
        <div class="usage-grid">
          <p>本分钟调用：<strong>{{ overview.usage.minute }} <small>/ {{ overview.limits.minute }}</small></strong></p>
          <p>今日数据类调用：<strong>{{ overview.usage.dataToday }} <small>/ {{ overview.limits.dataToday }}</small></strong></p>
          <p>今日业务类调用：<strong>{{ overview.usage.businessToday }} <small>/ {{ overview.limits.businessToday }}</small></strong></p>
        </div>
        <p class="usage-hint">免费数据查询也计入数据类调用次数；次数与点数余额分别限制。</p>
      </template>
      <p v-if="overview.usageUnavailable" class="monitor-note">当前调用计数暂不可读取；历史账户快照仍可查看。</p>
      <div class="events-heading">
        <h3>最近账户查询记录</h3>
        <span>{{ overview.events.length }} 条记录</span>
      </div>
      <div
        v-if="overview.events.length"
        class="events-scroll"
        tabindex="0"
        role="region"
        aria-label="账户查询记录表格"
      >
        <table>
          <thead><tr><th>查询时间</th><th>接口</th><th>结果</th><th>耗时</th><th>Trace ID</th></tr></thead>
          <tbody>
            <tr v-for="(event, index) in overview.events" :key="index">
              <td>{{ event.happenedAt }}</td>
              <td>{{ event.endpoint }}</td>
              <td><span class="event-result" :class="{ 'event-failed': event.result === 'failed' }">{{ event.result }}</span><span v-if="event.category" class="event-category">（{{ categoryLabel(event.category) }}）</span></td>
              <td>{{ event.durationMs }} ms</td>
              <td>{{ event.traceId ?? '无 Trace ID' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="monitor-empty">暂无账户查询记录，主动更新上游状态后可查看记录。</p>
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
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown>; standalone?: boolean }>();
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

<style scoped>
.upstream-monitor { min-width: 0; padding: 26px; }
.monitor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.section-kicker { margin: 0 0 6px; color: var(--console-brand); font-size: 11px; font-weight: 600; letter-spacing: 1.5px; }
.monitor-heading h2 { margin: 0 0 8px; font-size: 17px; }
.monitor-description { max-width: 620px; margin: 0; font-size: 12px; line-height: 1.8; }
.monitor-actions { display: flex; flex: none; align-items: center; gap: 14px; }
.monitor-actions a { color: var(--console-brand); font-size: 12px; text-decoration: none; }
.monitor-actions a:hover { text-decoration: underline; }
.snapshot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; }
.snapshot-grid p { margin: 0; padding: 20px; border: 1px solid var(--console-line); border-radius: 10px; font-size: 12px; background: #f8f9fc; }
.snapshot-grid strong { display: block; margin-top: 10px; color: var(--console-text); font: 600 22px/1.4 'Segoe UI', 'Microsoft YaHei', sans-serif; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.snapshot-grid .snapshot-balance { border-color: #e1e5fb; background: #f3f5ff; }
.snapshot-balance strong { color: var(--console-brand); font-size: 30px; }
.snapshot-meta { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 12px 0 22px; }
.snapshot-meta p { margin: 0; font-size: 11px; overflow-wrap: anywhere; }
.usage-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 22px; }
.usage-grid p { margin: 0; padding: 18px; border: 1px solid var(--console-line); border-radius: 9px; font-size: 12px; }
.usage-grid strong { display: block; margin-top: 8px; color: var(--console-text); font-size: 23px; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-grid small { color: var(--console-muted); font-size: 13px; font-weight: 400; }
.usage-hint { margin: 10px 0 0; font-size: 11px; }
.events-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 24px 0 12px; padding-top: 22px; border-top: 1px solid var(--console-line); }
.events-heading h3 { margin: 0; font-size: 14px; }
.events-heading span { color: var(--console-muted); font-size: 11px; }
.events-scroll { max-width: 100%; overflow: auto; border: 1px solid var(--console-line); border-radius: 8px; }
table { width: 100%; min-width: 720px; border-collapse: collapse; text-align: left; font-size: 12px; }
th, td { padding: 13px 15px; border-bottom: 1px solid #edf0f6; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--console-muted); background: #f8f9fc; font-weight: 500; white-space: nowrap; }
td { max-width: 280px; color: #465064; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: #fafbff; }
.event-result { display: inline-block; padding: 3px 8px; border-radius: 5px; color: #168764; background: #eaf7f0; }
.event-failed { color: #b97912; background: #fff5e4; }
.event-category { display: block; margin-top: 6px; font-size: 11px; }
.monitor-empty { margin: 18px 0 0; padding: 28px 16px; border: 1px dashed var(--console-line); border-radius: 9px; background: #fafbfe; text-align: center; font-size: 12px; }
.monitor-note, .monitor-alert { padding: 12px 15px; border: 1px solid #f0dfbd; border-radius: 8px; background: #fff9ed; font-size: 12px; }
.upstream-monitor .monitor-alert { color: var(--console-danger); border-color: #f0d2d6; background: #fff4f4; }
@media (max-width: 1100px) {
  .monitor-heading { flex-direction: column; gap: 16px; }
}
@media (max-width: 600px) {
  .upstream-monitor { padding: 18px 16px; }
  .snapshot-grid, .usage-grid { grid-template-columns: 1fr; gap: 10px; }
  .monitor-actions { width: 100%; justify-content: space-between; flex-wrap: wrap; }
  .snapshot-meta { flex-direction: column; }
  .usage-grid p { padding: 14px 16px; }
}
</style>
