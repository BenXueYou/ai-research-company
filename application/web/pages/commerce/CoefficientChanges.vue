<script setup lang="ts">
import {
  onMounted,
  onActivated,
  onDeactivated,
  onUnmounted,
  reactive,
  ref,
  shallowRef
} from 'vue';
import { useFormLeave } from '../../router/formLeave';
import { HttpError } from '../../api/http';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

type Change = {
  id: string;
  previousCoefficient: string;
  proposedCoefficient: string;
  effectiveAt: string;
  announcedAt: string;
  activatedAt: string | null;
  notice: string;
  coverage: Record<string, string> | null;
};
type Snapshot = { current: string; changes: Change[] };
const props = defineProps<{ request: (path: string, body?: Record<string, string>) => Promise<unknown> }>();
const snapshot = shallowRef<Snapshot>();
const form = reactive({ coefficient: '', effectiveAt: '', notice: '' });
const busy = ref(false);
const error = ref('');
const notice = ref('');
const requestId = ref(crypto.randomUUID());
const unknown = ref<'announce' | 'activate' | ''>('');
const activationId = ref('');
let cleanForm = JSON.stringify(form);
useFormLeave({
  state: () => busy.value ? 'submitting' : unknown.value ? 'unknown' : JSON.stringify(form) !== cleanForm ? 'dirty' : 'clean',
  retainUnknown: true,
  discard: () => {
    Object.assign(form, JSON.parse(cleanForm));
    requestId.value = crypto.randomUUID();
  }
});
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  snapshot.value = await props.request('coefficient') as Snapshot;
}
async function announce() {
  if (busy.value || unknown.value === 'activate') return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await props.request('coefficient/announcements', {
      requestId: requestId.value,
      coefficient: form.coefficient,
      effectiveAt: new Date(form.effectiveAt).toISOString(),
      notice: form.notice
    });
    requestId.value = crypto.randomUUID();
    unknown.value = '';
    cleanForm = JSON.stringify(form);
    notice.value = '已发布系数调整通知';
    await refresh().catch(failure => { error.value = failure instanceof Error ? failure.message : '系数信息加载失败'; });
  } catch (failure) {
    unknown.value = !(failure instanceof HttpError) || failure.status >= 500 ? 'announce' : '';
    error.value = failure instanceof Error ? failure.message : '通知发布失败';
  } finally {
    busy.value = false;
  }
}
async function activate(id: string) {
  if (busy.value || (unknown.value && (unknown.value !== 'activate' || activationId.value !== id))) return;
  activationId.value = id;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await props.request('coefficient/activate', { id });
    unknown.value = '';
    notice.value = '系数已生效，覆盖核验已留存';
    await refresh().catch(failure => { error.value = failure instanceof Error ? failure.message : '系数信息加载失败'; });
  } catch (failure) {
    unknown.value = !(failure instanceof HttpError) || failure.status >= 500 ? 'activate' : '';
    error.value = failure instanceof Error ? failure.message : '生效失败';
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
    error.value = failure instanceof Error ? failure.message : '系数信息加载失败';
  } finally {
    busy.value = false;
  }
}
function stopClock() {
  if (clock) clearInterval(clock);
  clock = undefined;
}
function startClock() {
  stopClock();
  now.value = Date.now();
  clock = setInterval(() => { now.value = Date.now(); }, 1000);
}
onMounted(() => { startClock(); void reload(); });
onActivated(startClock);
onDeactivated(stopClock);
onUnmounted(stopClock);
</script>

<template>
  <section class="coefficient-settings" aria-labelledby="coefficient-title">
    <h2 id="coefficient-title">换算系数通知与生效</h2>
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
    <p v-if="snapshot" class="settings-summary">当前 X={{ snapshot.current }}。已有余额不重算；已确认查询按原锁定 X 结算。</p>
    <p v-if="unknown" role="alert">系数操作结果尚未确认。可刷新查看通知，或重试原请求核实；离开不会自动重试。</p>
    <ElForm
      class="settings-form"
      :disabled="busy || !!unknown"
      label-position="top"
      @submit.prevent="announce"
    >
      <ElFormItem label="拟生效系数 X" for="coefficient-value">
        <ElInput id="coefficient-value" v-model="form.coefficient" required />
      </ElFormItem>
      <ElFormItem label="告知生效时间" for="coefficient-time">
        <input
          id="coefficient-time"
          v-model="form.effectiveAt"
          type="datetime-local"
          step="1"
          required
          :disabled="busy || !!unknown"
        />
      </ElFormItem>
      <ElFormItem label="调整通知" for="coefficient-notice">
        <ElInput id="coefficient-notice" v-model="form.notice" required />
      </ElFormItem>
      <ElButton class="settings-primary" native-type="submit" :disabled="busy">发布通知</ElButton>
    </ElForm>
    <ElButton v-if="unknown" :disabled="busy" @click="unknown === 'announce' ? announce() : activate(activationId)">重试原系数请求</ElButton>
    <h3>系数调整记录</h3>
    <p v-if="snapshot && !snapshot.changes.length" class="settings-hint">暂无系数调整记录。</p>
    <div v-for="change in snapshot?.changes ?? []" :key="change.id" class="coefficient-history">
      <h3>{{ change.previousCoefficient }} → {{ change.proposedCoefficient }}</h3>
      <p>通知：{{ change.notice }}；告知于 {{ change.announcedAt }}；计划生效 {{ change.effectiveAt }}</p>
      <p v-if="change.activatedAt">实际生效：{{ change.activatedAt }}；核验上游余额 {{ change.coverage?.upstreamBalance }}，覆盖需求 {{ change.coverage?.requiredUpstreamPoints }}，在途已扣 {{ change.coverage?.inTransitChargedUpstreamPoints }}。</p>
      <ElButton
        v-else
        :disabled="busy || !!unknown || new Date(change.effectiveAt).getTime() > now"
        @click="activate(change.id)"
      >核验覆盖并生效</ElButton>
    </div>
    <ElButton :disabled="busy" @click="reload">刷新系数通知</ElButton>
  </section>
</template>
