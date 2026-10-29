<script setup lang="ts">
import {
  onMounted,
  reactive,
  ref,
  shallowRef
} from 'vue';
import { useFormLeave } from '../../../router/formLeave';
import { HttpError } from '../../../api/http';
import {
  ElOption,
  ElSelect,
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

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
const unknown = ref(false);
let cleanForm = JSON.stringify(pricing);
useFormLeave({
  state: () => busy.value ? 'submitting' : unknown.value ? 'unknown' : JSON.stringify(pricing) !== cleanForm ? 'dirty' : 'clean',
  retainUnknown: true,
  discard: () => {
    Object.assign(pricing, JSON.parse(cleanForm));
    pending = undefined;
  }
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
    unknown.value = false;
    cleanForm = JSON.stringify(pricing);
    notice.value = '计价设置已保存';
    await refresh().catch(failure => { error.value = failure instanceof Error ? failure.message : '计价设置加载失败'; });
  } catch (failure) {
    unknown.value = !(failure instanceof HttpError) || failure.status >= 500;
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
    <ElAlert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <ElAlert
      v-if="notice"
      :title="notice"
      type="success"
      :closable="false"
    />
    <p v-if="unknown" role="alert">计价保存结果尚未确认。可刷新查看当前配置，或重试原请求核实；离开不会自动重试。</p>
    <template v-if="snapshot">
      <p class="settings-summary">币种 {{ snapshot.currency }} · 当前最低加价率 {{ snapshot.pricing.minimum_markup }}。</p>
      <p class="settings-hint">未配置接口单价时，对应计费查询不可执行；留空接口路径不会新增或修改接口单价。</p>
      <ElForm
        class="business-form settings-form"
        :disabled="busy || unknown"
        label-position="top"
        @submit.prevent="submit"
      >
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
          <el-select :empty-values="[null, undefined]"
            id="settings-pricing-evidence-type"
            v-model="pricing.evidenceType"
            :disabled="busy || unknown"
          >
            <el-option value="supplier_verified" label="已核实供应商商务依据" />
            <el-option value="controlled_test" label="受控测试价格（生产环境禁止）" />
          </el-select>
        </ElFormItem>
        <div class="form-actions">
          <ElButton type="primary" native-type="submit" :disabled="busy">保存计价设置</ElButton>
        </div>
      </ElForm>
      <ElButton v-if="unknown" :disabled="busy" @click="submit">重试原计价请求</ElButton>
      <h3>已配置接口单价</h3>
      <p v-if="!snapshot.prices.length">接口单价未配置，付费查询不可执行。</p>
      <div
        v-if="snapshot.prices.length"
        class="settings-table-scroll"
        tabindex="0"
        aria-label="已配置接口单价"
      >
        <table>
          <thead><tr><th scope="col">接口路径</th><th scope="col">上游单价 / 计费单位</th><th scope="col">本页最大计费量</th><th scope="col">依据与版本</th></tr></thead>
          <tbody>
            <tr v-for="item in snapshot.prices" :key="item.interface_path">
              <td class="price-path">{{ item.interface_path }}</td>
              <td>{{ item.upstream_unit_price }} 上游点数</td>
              <td>{{ item.maximum_billable_units }}</td>
              <td>依据 {{ item.evidence }}；<span class="price-version">版本 {{ item.version }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
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
</style>
