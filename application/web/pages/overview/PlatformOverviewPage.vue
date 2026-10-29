<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  shallowRef
} from 'vue';
import { ElButton } from 'element-plus';
import {
  readOrderOverview,
  readQuerySummary,
  readUpstreamSnapshot,
  type OrderOverview,
  type OverviewRequest,
  type QuerySummary,
  type UpstreamSnapshot
} from '../../api/platformOverview';

const props = defineProps<{ request: OverviewRequest }>();
type LoadState<T> = { loading: boolean; data: T | null; error: string };
const orders = shallowRef<LoadState<OrderOverview>>({ loading: true, data: null, error: '' });
const upstream = shallowRef<LoadState<UpstreamSnapshot>>({ loading: true, data: null, error: '' });
const queries = shallowRef<Record<string, LoadState<QuerySummary[]>>>({
  details: { loading: true, data: null, error: '' },
  contacts: { loading: true, data: null, error: '' },
  products: { loading: true, data: null, error: '' }
});
const queryKinds = [
  { kind: 'details', label: '企业详情' },
  { kind: 'contacts', label: '联系人' },
  { kind: 'products', label: '产品名单' }
] as const;
const busy = shallowRef(false);
let alive = true;
const reservedCount = computed(() => orders.value.data?.orders.filter(order =>
  order.status === 'reserved'
).length);
const unpaidCount = computed(() => orders.value.data?.orders.filter(order =>
  order.status === 'unpaid'
).length);
const awaitingStockCount = computed(() => orders.value.data?.orders.filter(order =>
  order.status === 'awaiting_stock'
).length);
const unknownOrderState = computed(() => orders.value.data?.orders.some(order =>
  !['unpaid', 'awaiting_stock', 'reserved', 'transferred', 'refunded'].includes(order.status)
));
function pendingCount(rows: QuerySummary[]) {
  return rows.filter(row =>
    row.state === 'pending'
  ).length;
}
async function capture<T>(read: () => Promise<T>): Promise<LoadState<T>> {
  try {
    return { loading: false, data: await read(), error: '' };
  } catch (failure) {
    return { loading: false, data: null, error: failure instanceof Error ? failure.message : '读取失败，请稍后重试' };
  }
}
async function load() {
  if (busy.value) return;
  busy.value = true;
  orders.value = { loading: true, data: null, error: '' };
  upstream.value = { loading: true, data: null, error: '' };
  for (const { kind } of queryKinds) queries.value = { ...queries.value, [kind]: { loading: true, data: null, error: '' } };
  await Promise.allSettled([
    capture(() => readOrderOverview(props.request)).then(result => {
      if (alive) orders.value = result;
    }),
    capture(() => readUpstreamSnapshot(props.request)).then(result => {
      if (alive) upstream.value = result;
    }),
    ...queryKinds.map(async ({ kind }) => {
      const result = await capture(() => readQuerySummary(props.request, kind));
      if (alive) queries.value = { ...queries.value, [kind]: result };
    })
  ]);
  if (alive) busy.value = false;
}
onMounted(load);
onUnmounted(() => { alive = false; });
</script>

<template>
  <section class="workspace overview-page" aria-label="平台运营概览">
    <div class="overview-heading">
      <div><h1>运营概览</h1><p>查看库存、上游账户快照和待处理事项。</p></div>
      <el-button class="overview-refresh" :disabled="busy" @click="load"><span aria-hidden="true">↻</span>{{ busy ? '正在读取…' : '刷新概览' }}</el-button>
    </div>
    <div class="overview-grid">
      <section class="workspace-card" aria-label="平台点数库存">
        <div class="card-heading"><span class="card-icon" aria-hidden="true">▤</span><h2>平台点数库存</h2><span class="unit-tag">内部点</span></div>
        <p v-if="orders.loading" role="status">正在读取库存…</p>
        <p v-else-if="orders.error" role="alert">库存读取失败：{{ orders.error }}</p>
        <template v-else-if="orders.data?.inventory">
          <p class="primary-metric"><span>库存余额：</span><strong>{{ orders.data.inventory.balance }}</strong> <span class="metric-unit">内部点</span></p>
          <div class="stock-details">
            <p><span>查询冻结：</span><strong>{{ orders.data.inventory.frozen }}</strong> 内部点</p>
            <p><span>销售预留：</span><strong>{{ orders.data.inventory.reserved }}</strong> 内部点</p>
          </div>
        </template>
        <p v-else role="status">暂无平台库存数据。</p>
        <RouterLink to="/platform/ledger/procurement">查看采购与费用</RouterLink>
      </section>
      <section class="workspace-card" aria-label="上游账户历史快照">
        <div class="card-heading"><span class="card-icon" aria-hidden="true">◷</span><h2>上游账户历史快照</h2><span class="unit-tag">上游点</span></div>
        <p v-if="upstream.loading" role="status">正在读取快照…</p>
        <p v-else-if="upstream.error" role="alert">上游快照读取失败：{{ upstream.error }}</p>
        <template v-else-if="upstream.data">
          <p v-if="!upstream.data.configured">尚未配置腾道账号。</p>
          <template v-if="upstream.data.snapshot">
            <p class="primary-metric"><span>上游剩余点数：</span><strong>{{ upstream.data.snapshot.balance }}</strong> <span class="metric-unit">上游点</span></p>
            <div class="snapshot-details">
              <p>上游有效期：<strong>{{ upstream.data.snapshot.expiresIn }}</strong></p>
              <p>快照获取时间：<span>{{ upstream.data.snapshot.fetchedAt }}</span></p>
            </div>
          </template>
          <p v-else>尚无上游账户快照。</p>
          <p class="snapshot-note">历史快照不代表实时余额。需要最新状态时，请进入上游账号监控主动更新。</p>
        </template>
        <RouterLink to="/platform/reconciliation/upstream">查看上游账号监控</RouterLink>
      </section>
      <section class="workspace-card" aria-label="待履约点数订单">
        <div class="card-heading"><span class="card-icon" aria-hidden="true">▥</span><h2>待履约点数订单</h2><span class="unit-tag">订单待办</span></div>
        <p v-if="orders.loading" role="status">正在读取订单…</p>
        <p v-else-if="orders.error" role="alert">订单待办读取失败：{{ orders.error }}</p>
        <template v-else-if="orders.data">
          <div class="todo-list">
            <p class="todo-row"><span><i class="status-dot status-amber" />已收款待补库存：</span><span><strong>{{ awaitingStockCount }}</strong> 笔</span></p>
            <p class="todo-row"><span><i class="status-dot" />已收款并预留：</span><span><strong>{{ reservedCount }}</strong> 笔</span></p>
            <p class="todo-row"><span><i class="status-dot status-muted" />待收款：</span><span><strong>{{ unpaidCount }}</strong> 笔</span></p>
          </div>
          <p v-if="unknownOrderState" role="alert">部分订单状态暂无法汇总，请进入订单页面核实。</p>
        </template>
        <RouterLink to="/platform/ledger">处理点数订单</RouterLink>
      </section>
      <section class="workspace-card" aria-label="需人工核对的查询">
        <div class="card-heading"><span class="card-icon" aria-hidden="true">⌕</span><h2>需人工核对的查询</h2><span class="unit-tag">查询待办</span></div>
        <div v-for="item in queryKinds" :key="item.kind" class="query-item">
          <p v-if="queries[item.kind].loading" role="status">{{ item.label }}：正在读取…</p>
          <p v-else-if="queries[item.kind].error" role="alert">{{ item.label }}读取失败：{{ queries[item.kind].error }}</p>
          <p v-else-if="queries[item.kind].data" class="todo-row"><span><i class="status-dot" />{{ item.label }}待核对：</span><span><strong>{{ pendingCount(queries[item.kind].data!) }}</strong> 次</span></p>
        </div>
        <RouterLink to="/platform/reconciliation">处理查询核对</RouterLink>
      </section>
    </div>
    <section class="workspace-card shortcut-panel" aria-label="快捷入口">
      <h2>快捷入口</h2>
      <nav class="overview-shortcuts" aria-label="概览快捷入口">
        <RouterLink to="/platform/organizations?view=new"><span class="shortcut-icon" aria-hidden="true">＋</span><span>直属开户</span><span class="shortcut-arrow" aria-hidden="true">↗</span></RouterLink>
        <RouterLink to="/platform/ledger"><span class="shortcut-icon" aria-hidden="true">▥</span><span>点数订单</span><span class="shortcut-arrow" aria-hidden="true">↗</span></RouterLink>
        <RouterLink to="/platform/ledger/procurement"><span class="shortcut-icon" aria-hidden="true">▤</span><span>平台采购</span><span class="shortcut-arrow" aria-hidden="true">↗</span></RouterLink>
        <RouterLink to="/platform/reconciliation"><span class="shortcut-icon" aria-hidden="true">⌕</span><span>异常对账</span><span class="shortcut-arrow" aria-hidden="true">↗</span></RouterLink>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.overview-page { max-width: 1440px; margin: 0 auto; color: #1c2333; }
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 2px 0 26px; }
.overview-heading h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; line-height: 1.4; letter-spacing: -.4px; }
.overview-heading p { margin: 0; color: #738095; font-size: 13px; line-height: 1.7; }
.overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.overview-page .workspace-card { min-width: 0; padding: 24px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #19234603; }
.overview-grid .workspace-card { display: flex; flex-direction: column; margin: 0; }
.card-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
.overview-page h2 { margin: 0; font-size: 15px; line-height: 1.5; font-weight: 650; }
.card-icon, .shortcut-icon { display: inline-grid; flex: none; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #4356e0; background: #eef1ff; font: 21px/1 'Segoe UI', sans-serif; }
.unit-tag { margin-left: auto; padding: 3px 8px; border-radius: 5px; color: #738095; background: #f5f7fb; font-size: 11px; white-space: nowrap; }
.overview-page p { line-height: 1.7; }
.primary-metric { margin: 0 0 22px; color: #738095; font-size: 12px; }
.primary-metric > span:first-child { display: block; margin-bottom: 7px; }
.primary-metric strong { color: #4356e0; font: 600 34px/1.35 'Segoe UI', Consolas, monospace; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-unit { margin-left: 7px; color: #738095; font-size: 12px; white-space: nowrap; }
.stock-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding-top: 16px; border-top: 1px solid #edf0f5; }
.stock-details p { margin: 0; color: #738095; font-size: 12px; overflow-wrap: anywhere; }
.stock-details p > span { display: block; margin-bottom: 5px; }
.stock-details strong { color: #35415b; font: 600 18px/1.5 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums; }
.snapshot-details { display: grid; gap: 6px; padding-top: 16px; border-top: 1px solid #edf0f5; }
.snapshot-details p { margin: 0; color: #738095; font-size: 12px; overflow-wrap: anywhere; }
.snapshot-details strong { color: #465064; font-weight: 500; }
.snapshot-note { padding: 10px 12px; border: 1px solid #e2e7fd; border-radius: 8px; color: #6372a4; background: #f3f5ff; font-size: 12px; }
.todo-list { margin-top: -6px; }
.todo-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; padding: 12px 0; border-bottom: 1px solid #edf0f5; color: #647087; font-size: 13px; }
.todo-row > span:first-child { display: flex; align-items: center; min-width: 0; }
.todo-row > span:last-child { flex-shrink: 0; color: #8a95a6; font-size: 12px; }
.todo-row strong { margin-right: 4px; color: #26334d; font: 600 23px/1.25 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums; }
.status-dot { flex: none; width: 6px; height: 6px; margin-right: 10px; border-radius: 50%; background: #4356e0; }
.status-amber { background: #b97912; }
.status-muted { background: #a0a8b8; }
.overview-grid .workspace-card > a { align-self: flex-start; margin-top: auto; padding-top: 20px; color: #4356e0; text-decoration: none; font-size: 12px; font-weight: 500; }
.overview-grid .workspace-card > a::after { content: ' →'; margin-left: 5px; }
.overview-grid .workspace-card > a:hover { text-decoration: underline; }
.overview-page [role='alert'] { padding: 10px 12px; border-radius: 8px; background: #fff3f1; color: #b33c36; font-size: 13px; overflow-wrap: anywhere; }
.overview-page [role='status'] { color: #738095; font-size: 13px; }
.overview-page .shortcut-panel { margin-top: 20px; }
.overview-shortcuts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
.overview-shortcuts a { display: flex; align-items: center; gap: 12px; min-height: 74px; padding: 16px; border: 1px solid #e6e9f0; border-radius: 9px; color: #465064; background: #fff; text-decoration: none; font-size: 13px; font-weight: 500; transition: border-color .15s, background .15s; }
.overview-shortcuts a:hover { border-color: #b5bff6; background: #f4f6ff; color: #4356e0; }
.shortcut-arrow { margin-left: auto; color: #9ca6ba; font-size: 17px; }
.overview-page a:focus-visible { outline: 3px solid #b5bff6; outline-offset: 3px; }
@media (max-width: 1050px) {
  .overview-shortcuts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .overview-grid { grid-template-columns: 1fr; }
  .overview-heading { align-items: flex-start; margin-bottom: 20px; }
  .overview-heading h1 { font-size: 22px; }
  .overview-page .workspace-card { padding: 18px; }
  .card-heading { gap: 8px; margin-bottom: 18px; }
  .primary-metric strong { font-size: 30px; }
  .overview-shortcuts { gap: 10px; }
  .overview-shortcuts a { gap: 8px; min-height: 66px; padding: 12px; }
  .shortcut-arrow { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .overview-shortcuts a { transition: none; }
}
</style>
