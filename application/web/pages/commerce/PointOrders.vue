<template>
  <section class="workspace-card point-orders order-page">
    <header class="order-page-header">
      <div>
        <p class="eyebrow">POINTS &amp; LEDGER</p>
        <h1>直属点数订单</h1>
      </div>
      <div class="order-header-mark" aria-hidden="true">⊙</div>
    </header>
    <p>为直属下级建单并核实线下足额收款；库存充足时整单预留，不足时登记待补库存，补足后按原数量售价完整划拨。</p>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-alert v-if="notice" type="success" :title="notice" :closable="false" />
    <div v-if="unknown" role="status">
      <p>本次订单操作结果尚未确认。请先刷新订单核实；如需重试，将使用原操作信息，不会重复履约。</p>
      <p>{{ unknownLabel }}</p>
      <el-button :disabled="busy" @click="retryUnknown">重试原操作</el-button>
      <el-button :disabled="busy" @click="acknowledgeUnknown">已核实，结束本次核对</el-button>
    </div>
    <el-button :disabled="busy" @click="refreshOrders">刷新订单</el-button>
    <div v-if="snapshot" class="inventory-strip">
      <div><span>库存</span><strong>{{ snapshot.inventory.balance }}</strong><small>点</small></div>
      <div><span>已预留</span><strong>{{ snapshot.inventory.reserved }}</strong><small>点</small></div>
      <div><span>当前平均成本</span><strong>{{ snapshot.inventory.average_cost }}</strong><small>元/点</small></div>
      <div><span>最低加价率</span><strong>{{ snapshot.pricing.minimum_markup }}</strong></div>
    </div>
    <el-form class="order-create-form" label-position="top" @submit.prevent="createOrder">
      <h3>创建订单</h3>
      <el-form-item label="直属买方" for="order-buyer">
        <select
          id="order-buyer"
          v-model="buyerId"
          required
          :disabled="busy || !!unknown"
        >
          <option value="">请选择</option>
          <option v-for="child in snapshot?.children ?? []" :key="child.id" :value="child.id">{{ child.name }}（{{
            child.kind }}）</option>
        </select>
      </el-form-item>
      <el-form-item label="点数数量" for="order-quantity">
        <el-input
          id="order-quantity"
          v-model="quantity"
          required
          :disabled="busy || !!unknown"
        />
      </el-form-item>
      <el-form-item label="每点售价（人民币）" for="order-price">
        <el-input
          id="order-price"
          v-model="unitPrice"
          required
          :disabled="busy || !!unknown"
        />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :disabled="busy || !!unknown || !buyerId">建单</el-button>
    </el-form>
    <div v-for="order in snapshot?.orders ?? []" :key="order.id" class="workspace-card order-card">
      <div class="order-card-heading">
        <h3>{{ order.buyerName }} · <span class="order-status" :class="`status-${order.status}`">{{ order.status === 'transferred' ? '已划拨' : order.status === 'refunded' ? '已整单退款' :
          order.status === 'reserved' ? '已收款并预留' : order.status === 'awaiting_stock' ? '已收款待补库存' : '待收款' }}</span></h3>
      </div>
      <p v-if="lifecycle" class="order-reference">订单编号：{{ order.id }}</p>
      <p v-if="!order.buyerActive && order.status === 'reserved'">买方组织已停用，划拨暂停；预留继续保留。</p>
      <p v-if="order.status === 'awaiting_stock'">本单尚未预留，买方尚未到账。补足库存后整单预留，再完整划拨；按原数量售价履约，不退款。</p>
      <p v-if="!order.buyerActive && order.status === 'awaiting_stock'">买方组织已停用，补库预留与划拨暂停，收款记录保留。</p>
      <p>数量 {{ order.quantity }} × 单价 {{ order.unitPrice }} = {{ order.amount }} 元</p>
      <template v-if="order.status === 'unpaid'">
        <el-button :disabled="busy || !!unknown" @click="selectReprice(order)">调整数量或售价</el-button>
        <el-button :disabled="busy || !!unknown" @click="selectConfirm(order)">确认足额收款</el-button>
      </template>
      <p v-else>收款凭证：{{ order.receiptReference }}</p>
      <el-button v-if="order.status === 'reserved'" :disabled="busy || !!unknown || !order.buyerActive"
        @click="transfer(order)">完整划拨</el-button>
      <el-button
        v-if="order.status === 'awaiting_stock'"
        :disabled="busy || !!unknown || !order.buyerActive"
        @click="reserve(order)"
      >补库后整单预留</el-button>
      <el-button
        v-if="order.status === 'reserved' && !order.shortageReceipt"
        :disabled="busy || !!unknown"
        @click="selectRefund(order)"
      >确认线下整单退款</el-button>
      <p v-if="order.status === 'reserved' && order.shortageReceipt">本单由缺库存收款转入履约，按原数量售价完整划拨，不支持退款。</p>
      <p v-if="order.status === 'transferred'">历史销售成本 {{ order.salesCost }} 元，毛利 {{ order.grossProfit }} 元</p>
      <p v-if="order.status === 'refunded'">退款 {{ order.refundAmount }} 元；依据：{{ order.refundEvidence }}</p>
    </div>
    <p v-if="lifecycle && selected" class="order-reference">当前操作订单：{{ selected.id }}</p>
    <el-form v-if="selected && mode === 'reprice'" label-position="top" @submit.prevent="reprice">
      <h3>调整订单 · {{ selected.buyerName }}</h3>
      <el-form-item label="点数数量" for="reprice-quantity">
        <el-input
          id="reprice-quantity"
          v-model="editQuantity"
          :disabled="lifecycle && (busy || !!unknown)"
          required
        />
      </el-form-item>
      <el-form-item label="每点售价" for="reprice-price">
        <el-input
          id="reprice-price"
          v-model="editPrice"
          :disabled="lifecycle && (busy || !!unknown)"
          required
        />
      </el-form-item>
      <el-button native-type="submit" :disabled="busy || !!unknown">保存调整</el-button>
      <el-button :disabled="lifecycle && (busy || !!unknown)" @click="selected = null">取消</el-button>
    </el-form>
    <el-form v-if="selected && mode === 'confirm'" label-position="top" @submit.prevent="confirm">
      <h3>确认足额收款 · {{ selected.buyerName }} · {{ selected.amount }} 元</h3>
      <el-form-item label="唯一线下收款凭证" for="receipt-reference">
        <el-input
          id="receipt-reference"
          v-model="receiptReference"
          :disabled="lifecycle && (busy || !!unknown)"
          required
        />
      </el-form-item>
      <p>仅在核实足额款已到账后确认。库存充足则整单预留；不足则登记待补库存，锁定数量售价，不退款。</p>
      <el-button native-type="submit" :disabled="busy || !!unknown">登记足额收款</el-button>
      <el-button :disabled="lifecycle && (busy || !!unknown)" @click="selected = null">取消</el-button>
    </el-form>
    <el-form v-if="selected && mode === 'refund'" label-position="top" @submit.prevent="refund">
      <h3>确认线下整单退款 · {{ selected.buyerName }} · {{ selected.amount }} 元</h3>
      <p>请先核实整单款项已在线下退回。提交后订单关闭并释放 {{ selected.quantity }} 点预留。</p>
      <el-form-item label="线下退款完成依据" for="refund-evidence">
        <el-input
          id="refund-evidence"
          v-model="refundEvidence"
          required
          :disabled="busy || !!unknown"
        />
      </el-form-item>
      <el-button native-type="submit" :disabled="busy || !!unknown || !refundEvidence.trim()">确认已退款并释放预留</el-button>
      <el-button :disabled="busy || !!unknown" @click="selected = null">取消</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
  shallowRef
} from 'vue';
import type { FormLeaveState } from '../../router/formLeave';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

type Order = { id: string; buyerId: string; buyerName: string; buyerActive: boolean; quantity: string; unitPrice: string; amount: string; status: string; shortageReceipt: boolean; receiptReference: string | null; salesCost: string | null; grossProfit: string | null; refundAmount: string | null; refundEvidence: string | null };
type Snapshot = { children: { id: string; name: string; kind: string }[]; inventory: { balance: string; reserved: string; average_cost: string }; pricing: { minimum_markup: string }; orders: Order[] };
const props = defineProps<{
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  platformLifecycle?: boolean;
  distributionLifecycle?: boolean;
}>();
const lifecycle = computed(() => props.platformLifecycle || props.distributionLifecycle);
const snapshot = shallowRef<Snapshot>();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const buyerId = ref('');
const quantity = ref('');
const unitPrice = ref('');
const selected = shallowRef<Order | null>(null);
const mode = ref<'reprice' | 'confirm' | 'refund'>('confirm');
const editQuantity = ref('');
const editPrice = ref('');
const receiptReference = ref('');
const refundEvidence = ref('');
const pending = new Map<string, string>();
const unknown = shallowRef<{ path: string; body: Record<string, unknown> }>();
const unknownLabel = computed(() => {
  if (!unknown.value) return '';
  const { path, body } = unknown.value;
  const labels: Record<string, string> = {
    'point-orders': '建单',
    'point-orders/reprice': '调整数量或售价',
    'point-orders/confirm': '登记足额收款',
    'point-orders/reserve': '补库后整单预留',
    'point-orders/transfer': '完整划拨',
    'point-orders/refund': '确认整单退款'
  };
  const target = path === 'point-orders'
    ? snapshot.value?.children.find(child =>
      child.id === body.buyerId
    )?.name
    : snapshot.value?.orders.find(order =>
      order.id === body.orderId
    )?.buyerName;
  return `${labels[path]} · ${target ?? '请核对原买方'}${body.orderId ? ` · 订单 ${body.orderId}` : ''}`;
});
let savedCreate = JSON.stringify(['', '', '']);
function leaveState(): FormLeaveState {
  if (busy.value) return 'submitting';
  if (unknown.value) return 'unknown';
  return selected.value || JSON.stringify([buyerId.value, quantity.value, unitPrice.value]) !== savedCreate ? 'dirty' : 'clean';
}
function discardDraft() {
  buyerId.value = '';
  quantity.value = '';
  unitPrice.value = '';
  savedCreate = JSON.stringify(['', '', '']);
  selected.value = null;
  editQuantity.value = '';
  editPrice.value = '';
  receiptReference.value = '';
  refundEvidence.value = '';
}
defineExpose({ leaveState, discardDraft });
async function load() { snapshot.value = await props.request('point-orders') as Snapshot; }
async function refreshOrders() {
  if (busy.value) return;
  try {
    await load();
    error.value = '';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '加载订单失败';
  }
}
async function retryUnknown() {
  if (!unknown.value || busy.value) return;
  await run(unknown.value.path, unknown.value.body, true);
}
function acknowledgeUnknown() {
  if (busy.value || !unknown.value) return;
  if (!window.confirm('确认已核实本次订单操作结果？结束核对不会取消、退款或重发原操作。')) return;
  unknown.value = undefined;
  selected.value = null;
  error.value = '';
}
async function run(path: string, body: Record<string, unknown>, retry = false) {
  if (lifecycle.value && (busy.value || (unknown.value && !retry))) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  let completed = false;
  try {
    const key = `${path}:${JSON.stringify(body)}`;
    const requestId = pending.get(key) ?? crypto.randomUUID();
    pending.set(key, requestId);
    await props.request(path, { requestId, ...body });
    completed = true;
    pending.delete(key);
    if (lifecycle.value) {
      unknown.value = undefined;
      if (path === 'point-orders') savedCreate = JSON.stringify([buyerId.value, quantity.value, unitPrice.value]);
      selected.value = null;
      notice.value = '订单操作已完成';
    }
    await load();
    selected.value = null;
    notice.value = '订单操作已完成';
  } catch (failure) {
    if (lifecycle.value && !completed && (failure instanceof TypeError || failure instanceof SyntaxError)) {
      unknown.value = { path, body: { ...body } };
    }
    error.value = lifecycle.value && completed
      ? '订单操作已完成，列表读取失败，请刷新订单核实。'
      : failure instanceof Error ? failure.message : '请求失败';
  } finally { busy.value = false; }
}
async function createOrder() { await run('point-orders', { buyerId: buyerId.value, quantity: quantity.value, unitPrice: unitPrice.value }); }
function selectReprice(order: Order) { selected.value = order; mode.value = 'reprice'; editQuantity.value = order.quantity; editPrice.value = order.unitPrice; }
function selectConfirm(order: Order) { selected.value = order; mode.value = 'confirm'; receiptReference.value = ''; }
function selectRefund(order: Order) { selected.value = order; mode.value = 'refund'; refundEvidence.value = ''; }
async function reprice() { if (selected.value) await run('point-orders/reprice', { orderId: selected.value.id, quantity: editQuantity.value, unitPrice: editPrice.value }); }
async function confirm() { if (selected.value) await run('point-orders/confirm', { orderId: selected.value.id, receiptReference: receiptReference.value }); }
async function transfer(order: Order) { await run('point-orders/transfer', { orderId: order.id }); }
async function reserve(order: Order) {
  await run('point-orders/reserve', { orderId: order.id });
}
async function refund() { if (selected.value) await run('point-orders/refund', { orderId: selected.value.id, refundEvidence: refundEvidence.value }); }
onMounted(() => { load().catch(failure => { error.value = failure instanceof Error ? failure.message : '加载订单失败'; }); });
</script>

<style scoped>
.order-page { max-width: 1180px; margin: 0 auto; padding: 28px; background: #fff; border: 1px solid #e6e9f0; border-radius: 14px; box-shadow: 0 8px 24px #19234608; }
.order-page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 20px; border-bottom: 1px solid #edf0f6; }
.eyebrow { margin: 0 0 7px; color: #8794b2; font-size: 11px; letter-spacing: 1.8px; }
.order-page h1 { margin: 0; color: #1c2333; font-size: 25px; line-height: 1.35; letter-spacing: -.4px; }
.order-page > p:not(.eyebrow) { color: #738095; }
.order-header-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; color: #4356e0; background: #eef1ff; font-size: 24px; }
.order-create-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: end; gap: 16px; margin-top: 22px; padding: 22px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fbfcff; }
.order-create-form h3 { color: #27324a; font-size: 16px; }
.order-create-form :deep(.el-input__wrapper), .order-page select { border-radius: 8px; box-shadow: 0 0 0 1px #dfe4ee inset; }
.order-card { margin-top: 16px; padding: 20px; border: 1px solid #e6e9f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 8px #19234605; }
.order-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.order-card h3 { margin: 0; color: #26324a; font-size: 16px; }
.order-status { display: inline-block; padding: 4px 9px; border-radius: 5px; color: #5365c5; background: #eef1ff; font-size: 11px; }
.status-transferred { color: #1c9063; background: #eaf7f0; }
.status-refunded { color: #8a6670; background: #f7eef1; }
.status-reserved, .status-awaiting_stock { color: #a8731e; background: #fff5e4; }
.inventory-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 20px; border: 1px solid #e6e9f0; border-radius: 10px; }
.inventory-strip > div { min-width: 0; padding: 18px 20px; }
.inventory-strip > div + div { border-left: 1px solid #edf0f6; }
.inventory-strip span { display: block; margin-bottom: 6px; color: #738095; font-size: 12px; }
.inventory-strip strong { color: #4356e0; font: 600 23px/1.4 'Segoe UI', Consolas, monospace; overflow-wrap: anywhere; }
.inventory-strip small { margin-left: 6px; color: #8994a8; font-size: 11px; }
.order-create-form h3 { grid-column: 1 / -1; margin: 0; }
.order-create-form :deep(.el-form-item) { min-width: 0; margin: 0; }
.order-create-form > .el-button { min-height: 40px; }
.order-create-form select { width: 100%; min-height: 40px; padding: 8px 12px; border: 0; color: #26324a; background: #fff; font: inherit; }
.order-create-form select:focus-visible { outline: 2px solid #4356e0; outline-offset: 2px; }
.order-create-form :deep(.el-input__wrapper) { min-height: 40px; }
.order-page > .el-form:not(.order-create-form) { margin-top: 20px; padding: 22px; border: 1px solid #dfe4fd; border-radius: 12px; background: #f7f8ff; }
.order-reference { overflow-wrap: anywhere; color: #8994a8; font: 11px/1.5 Consolas, monospace; }
@media (max-width: 900px) { .order-create-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) {
  .order-page { padding: 18px 14px; }
  .order-card-heading { align-items: flex-start; }
  .inventory-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .inventory-strip > div { padding: 14px; }
  .inventory-strip > div:nth-child(3) { border-left: 0; }
  .inventory-strip > div:nth-child(n+3) { border-top: 1px solid #edf0f6; }
  .inventory-strip strong { font-size: 19px; }
  .order-create-form { grid-template-columns: minmax(0, 1fr); padding: 16px; }
  .order-card { padding: 16px; }
  .order-card :deep(.el-button) { margin: 6px 6px 0 0; max-width: 100%; height: auto; min-height: 34px; white-space: normal; }
}
</style>
