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
      <el-button :disabled="busy" @click="load">{{ busy ? '正在读取…' : '刷新概览' }}</el-button>
    </div>
    <div class="overview-grid">
      <section class="workspace-card" aria-label="平台点数库存">
        <h2>平台点数库存</h2>
        <p v-if="orders.loading" role="status">正在读取库存…</p>
        <p v-else-if="orders.error" role="alert">库存读取失败：{{ orders.error }}</p>
        <template v-else-if="orders.data?.inventory">
          <p>库存余额：{{ orders.data.inventory.balance }} 内部点</p>
          <p>查询冻结：{{ orders.data.inventory.frozen }} 内部点</p>
          <p>销售预留：{{ orders.data.inventory.reserved }} 内部点</p>
        </template>
        <p v-else role="status">暂无平台库存数据。</p>
        <RouterLink to="/platform/ledger/procurement">查看采购与费用</RouterLink>
      </section>
      <section class="workspace-card" aria-label="上游账户历史快照">
        <h2>上游账户历史快照</h2>
        <p v-if="upstream.loading" role="status">正在读取快照…</p>
        <p v-else-if="upstream.error" role="alert">上游快照读取失败：{{ upstream.error }}</p>
        <template v-else-if="upstream.data">
          <p v-if="!upstream.data.configured">尚未配置腾道账号。</p>
          <template v-if="upstream.data.snapshot">
            <p>上游剩余点数：{{ upstream.data.snapshot.balance }} 上游点</p>
            <p>上游有效期：{{ upstream.data.snapshot.expiresIn }}</p>
            <p>快照获取时间：{{ upstream.data.snapshot.fetchedAt }}</p>
          </template>
          <p v-else>尚无上游账户快照。</p>
          <p>历史快照不代表实时余额。需要最新状态时，请进入上游账号监控主动更新。</p>
        </template>
        <RouterLink to="/platform/reconciliation/upstream">查看上游账号监控</RouterLink>
      </section>
      <section class="workspace-card" aria-label="待履约点数订单">
        <h2>待履约点数订单</h2>
        <p v-if="orders.loading" role="status">正在读取订单…</p>
        <p v-else-if="orders.error" role="alert">订单待办读取失败：{{ orders.error }}</p>
        <template v-else-if="orders.data">
          <p>已收款待补库存：{{ awaitingStockCount }} 笔</p>
          <p>已收款并预留：{{ reservedCount }} 笔</p>
          <p>待收款：{{ unpaidCount }} 笔</p>
          <p v-if="unknownOrderState" role="alert">部分订单状态暂无法汇总，请进入订单页面核实。</p>
        </template>
        <RouterLink to="/platform/ledger">处理点数订单</RouterLink>
      </section>
      <section class="workspace-card" aria-label="需人工核对的查询">
        <h2>需人工核对的查询</h2>
        <div v-for="item in queryKinds" :key="item.kind">
          <p v-if="queries[item.kind].loading" role="status">{{ item.label }}：正在读取…</p>
          <p v-else-if="queries[item.kind].error" role="alert">{{ item.label }}读取失败：{{ queries[item.kind].error }}</p>
          <p v-else-if="queries[item.kind].data">{{ item.label }}待核对：{{ pendingCount(queries[item.kind].data!) }} 次</p>
        </div>
        <RouterLink to="/platform/reconciliation">处理查询核对</RouterLink>
      </section>
    </div>
    <section class="workspace-card" aria-label="快捷入口">
      <h2>快捷入口</h2>
      <nav class="overview-shortcuts" aria-label="概览快捷入口">
        <RouterLink to="/platform/organizations?view=new">直属开户</RouterLink>
        <RouterLink to="/platform/ledger">点数订单</RouterLink>
        <RouterLink to="/platform/ledger/procurement">平台采购</RouterLink>
        <RouterLink to="/platform/reconciliation">异常对账</RouterLink>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.overview-grid .workspace-card { margin: 0; }
.overview-shortcuts { display: flex; flex-wrap: wrap; gap: 24px; }
@media (max-width: 760px) {
  .overview-grid { grid-template-columns: 1fr; }
  .overview-heading { align-items: flex-start; }
}
</style>
