<script setup lang="ts">
import { onMounted, reactive, ref, shallowRef } from 'vue';
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput } from 'element-plus';

interface PricingSnapshot {
  currency: string;
  pricing: { coefficient: string; minimum_markup: string };
  prices: {
    interface_path: string;
    upstream_unit_price: string;
    maximum_billable_units: number;
    evidence: string;
    version: string;
  }[];
}
type SettingsRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

const props = defineProps<{ request: SettingsRequest }>();
const snapshot = shallowRef<PricingSnapshot>();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const pricing = reactive({
  minimumMarkup: '',
  interfacePath: '',
  upstreamUnitPrice: '',
  maximumBillableUnits: '',
  evidenceType: 'supplier_verified',
  evidence: ''
});
let pending: { payload: string; requestId: string } | undefined;

async function refresh() {
  snapshot.value = await props.request('procurement') as PricingSnapshot;
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const values: Record<string, string> = { evidence: pricing.evidence };
  if (pricing.minimumMarkup) values.minimumMarkup = pricing.minimumMarkup;
  if (pricing.interfacePath) {
    values.interfacePath = pricing.interfacePath;
    values.upstreamUnitPrice = pricing.upstreamUnitPrice;
    values.maximumBillableUnits = pricing.maximumBillableUnits;
    values.evidenceType = pricing.evidenceType;
  }
  const payload = JSON.stringify(values);
  if (!pending || pending.payload !== payload) {
    pending = { payload, requestId: crypto.randomUUID() };
  }
  try {
    await props.request('procurement/pricing', {
      ...values,
      requestId: pending.requestId
    });
    notice.value = '计价设置已保存';
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '计价设置保存失败';
  } finally {
    busy.value = false;
  }
}

async function reload() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '计价设置加载失败';
  } finally {
    busy.value = false;
  }
}

onMounted(reload);
</script>

<template>
  <section class="pricing-settings" aria-labelledby="pricing-settings-title">
    <h2 id="pricing-settings-title">接口单价与最低加价率</h2>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert v-if="notice" :title="notice" type="success" :closable="false" />
    <template v-if="snapshot">
      <p>币种 {{ snapshot.currency }} · 当前最低加价率 {{ snapshot.pricing.minimum_markup }}。</p>
      <p>未配置接口单价时，对应计费查询不可执行；留空接口路径不会新增或修改接口单价。</p>
      <ElForm label-position="top" @submit.prevent="submit">
        <ElFormItem label="最低加价率" for="settings-minimum-markup">
          <ElInput id="settings-minimum-markup" v-model="pricing.minimumMarkup" placeholder="留空保持当前值" />
        </ElFormItem>
        <ElFormItem label="接口路径" for="settings-price-path">
          <ElInput id="settings-price-path" v-model="pricing.interfacePath" />
        </ElFormItem>
        <ElFormItem label="上游接口单价（上游点数/计费单位）" for="settings-unit-price">
          <ElInput id="settings-unit-price" v-model="pricing.upstreamUnitPrice" />
        </ElFormItem>
        <ElFormItem label="已核实本页最大计费量" for="settings-billable-units">
          <ElInput id="settings-billable-units" v-model="pricing.maximumBillableUnits" />
        </ElFormItem>
        <ElFormItem label="计价核实依据" for="settings-pricing-evidence">
          <ElInput id="settings-pricing-evidence" v-model="pricing.evidence" required />
        </ElFormItem>
        <ElFormItem label="计价依据类型" for="settings-pricing-evidence-type">
          <select id="settings-pricing-evidence-type" v-model="pricing.evidenceType">
            <option value="supplier_verified">已核实供应商商务依据</option>
            <option value="controlled_test">受控测试价格（生产环境禁止）</option>
          </select>
        </ElFormItem>
        <ElButton native-type="submit" :disabled="busy">保存计价设置</ElButton>
      </ElForm>
      <h3>已配置接口单价</h3>
      <p v-if="!snapshot.prices.length">接口单价未配置，付费查询不可执行。</p>
      <ul>
        <li v-for="item in snapshot.prices" :key="item.interface_path">
          {{ item.interface_path }}：{{ item.upstream_unit_price }} 上游点数/计费单位；本页最大 {{ item.maximum_billable_units }}；版本 {{ item.version }}
        </li>
      </ul>
    </template>
    <ElButton :disabled="busy" @click="reload">刷新计价设置</ElButton>
  </section>
</template>

<style scoped>
.pricing-settings {
  width: 100%;
  margin-top: 24px;
  padding: 24px;
  border: 1px solid #d8e2e8;
  border-radius: 12px;
  background: #fff;
}

select {
  width: 100%;
  min-height: 36px;
  border: 1px solid #b5c5ce;
  border-radius: 4px;
}
</style>
