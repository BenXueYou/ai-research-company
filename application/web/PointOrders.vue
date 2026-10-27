<template>
  <section class="workspace-card point-orders">
    <h2>直属点数订单</h2>
    <p>为直属下级建单，核实线下足额收款后确认预留，再一次完整划拨。</p>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-alert v-if="notice" type="success" :title="notice" :closable="false" />
    <p v-if="snapshot">库存 {{ snapshot.inventory.balance }}，已预留 {{ snapshot.inventory.reserved }}，当前平均成本 {{ snapshot.inventory.average_cost }}，最低加价率 {{ snapshot.pricing.minimum_markup }}</p>
    <el-form label-position="top" @submit.prevent="createOrder">
      <h3>创建订单</h3>
      <el-form-item label="直属买方" for="order-buyer">
        <select id="order-buyer" v-model="buyerId" required :disabled="busy">
          <option value="">请选择</option>
          <option v-for="child in snapshot?.children ?? []" :key="child.id" :value="child.id">{{ child.name }}（{{ child.kind }}）</option>
        </select>
      </el-form-item>
      <el-form-item label="点数数量" for="order-quantity">
        <el-input id="order-quantity" v-model="quantity" required :disabled="busy" />
      </el-form-item>
      <el-form-item label="每点售价（人民币）" for="order-price">
        <el-input id="order-price" v-model="unitPrice" required :disabled="busy" />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :disabled="busy || !buyerId">建单</el-button>
    </el-form>
    <div v-for="order in snapshot?.orders ?? []" :key="order.id" class="workspace-card">
      <h3>{{ order.buyerName }} · {{ order.status === 'transferred' ? '已划拨' : order.status === 'refunded' ? '已整单退款' : order.status === 'reserved' ? '已收款并预留' : '待收款' }}</h3>
      <p v-if="!order.buyerActive && order.status === 'reserved'">买方组织已停用，划拨暂停；预留继续保留。</p>
      <p>数量 {{ order.quantity }} × 单价 {{ order.unitPrice }} = {{ order.amount }} 元</p>
      <template v-if="order.status === 'unpaid'">
        <el-button :disabled="busy" @click="selectReprice(order)">调整数量或售价</el-button>
        <el-button :disabled="busy" @click="selectConfirm(order)">确认足额收款</el-button>
      </template>
      <p v-else>收款凭证：{{ order.receiptReference }}</p>
      <el-button v-if="order.status === 'reserved'" :disabled="busy || !order.buyerActive" @click="transfer(order)">完整划拨</el-button>
      <el-button v-if="order.status === 'reserved'" :disabled="busy" @click="selectRefund(order)">确认线下整单退款</el-button>
      <p v-if="order.status === 'transferred'">历史销售成本 {{ order.salesCost }} 元，毛利 {{ order.grossProfit }} 元</p>
      <p v-if="order.status === 'refunded'">退款 {{ order.refundAmount }} 元；依据：{{ order.refundEvidence }}</p>
    </div>
    <el-form v-if="selected && mode === 'reprice'" label-position="top" @submit.prevent="reprice">
      <h3>调整订单 · {{ selected.buyerName }}</h3>
      <el-form-item label="点数数量" for="reprice-quantity"><el-input id="reprice-quantity" v-model="editQuantity" required /></el-form-item>
      <el-form-item label="每点售价" for="reprice-price"><el-input id="reprice-price" v-model="editPrice" required /></el-form-item>
      <el-button native-type="submit" :disabled="busy">保存调整</el-button>
      <el-button @click="selected = null">取消</el-button>
    </el-form>
    <el-form v-if="selected && mode === 'confirm'" label-position="top" @submit.prevent="confirm">
      <h3>确认足额收款 · {{ selected.buyerName }} · {{ selected.amount }} 元</h3>
      <el-form-item label="唯一线下收款凭证" for="receipt-reference"><el-input id="receipt-reference" v-model="receiptReference" required /></el-form-item>
      <p>库存不足时系统拒绝确认，线下款仍可能已到账，须人工核对。</p>
      <el-button native-type="submit" :disabled="busy">确认并预留</el-button>
      <el-button @click="selected = null">取消</el-button>
    </el-form>
    <el-form v-if="selected && mode === 'refund'" label-position="top" @submit.prevent="refund">
      <h3>确认线下整单退款 · {{ selected.buyerName }} · {{ selected.amount }} 元</h3>
      <p>请先核实整单款项已在线下退回。提交后订单关闭并释放 {{ selected.quantity }} 点预留。</p>
      <el-form-item label="线下退款完成依据" for="refund-evidence"><el-input id="refund-evidence" v-model="refundEvidence" required :disabled="busy" /></el-form-item>
      <el-button native-type="submit" :disabled="busy || !refundEvidence.trim()">确认已退款并释放预留</el-button>
      <el-button :disabled="busy" @click="selected = null">取消</el-button>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

type Order = { id: string; buyerId: string; buyerName: string; buyerActive: boolean; quantity: string; unitPrice: string; amount: string; status: string; receiptReference: string | null; salesCost: string | null; grossProfit: string | null; refundAmount: string | null; refundEvidence: string | null };
type Snapshot = { children: { id: string; name: string; kind: string }[]; inventory: { balance: string; reserved: string; average_cost: string }; pricing: { minimum_markup: string }; orders: Order[] };
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<any> }>();
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
async function load() { snapshot.value = await props.request('point-orders') as Snapshot; }
async function run(path: string, body: Record<string, unknown>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const key = `${path}:${JSON.stringify(body)}`;
    const requestId = pending.get(key) ?? crypto.randomUUID();
    pending.set(key, requestId);
    await props.request(path, { requestId, ...body });
    pending.delete(key);
    await load();
    selected.value = null;
    notice.value = '订单操作已完成';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '请求失败';
  } finally { busy.value = false; }
}
async function createOrder() { await run('point-orders', { buyerId: buyerId.value, quantity: quantity.value, unitPrice: unitPrice.value }); }
function selectReprice(order: Order) { selected.value = order; mode.value = 'reprice'; editQuantity.value = order.quantity; editPrice.value = order.unitPrice; }
function selectConfirm(order: Order) { selected.value = order; mode.value = 'confirm'; receiptReference.value = ''; }
function selectRefund(order: Order) { selected.value = order; mode.value = 'refund'; refundEvidence.value = ''; }
async function reprice() { if (selected.value) await run('point-orders/reprice', { orderId: selected.value.id, quantity: editQuantity.value, unitPrice: editPrice.value }); }
async function confirm() { if (selected.value) await run('point-orders/confirm', { orderId: selected.value.id, receiptReference: receiptReference.value }); }
async function transfer(order: Order) { await run('point-orders/transfer', { orderId: order.id }); }
async function refund() { if (selected.value) await run('point-orders/refund', { orderId: selected.value.id, refundEvidence: refundEvidence.value }); }
onMounted(() => { load().catch(failure => { error.value = failure instanceof Error ? failure.message : '加载订单失败'; }); });
</script>
