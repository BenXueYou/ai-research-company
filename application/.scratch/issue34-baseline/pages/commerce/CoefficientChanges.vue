<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue';
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput } from 'element-plus';

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
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  snapshot.value = await props.request('coefficient') as Snapshot;
}
async function announce() {
  if (busy.value) return;
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
    notice.value = '已发布系数调整通知';
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '通知发布失败';
  } finally {
    busy.value = false;
  }
}
async function activate(id: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await props.request('coefficient/activate', { id });
    notice.value = '系数已生效，覆盖核验已留存';
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '生效失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  clock = setInterval(() => { now.value = Date.now(); }, 1000);
  refresh().catch(failure => { error.value = failure instanceof Error ? failure.message : '系数信息加载失败'; });
});
onUnmounted(() => { if (clock) clearInterval(clock); });
</script>

<template>
  <section class="procurement-panel" aria-labelledby="coefficient-title">
    <h2 id="coefficient-title">换算系数通知与生效</h2>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert v-if="notice" :title="notice" type="success" :closable="false" />
    <p v-if="snapshot">当前 X={{ snapshot.current }}。已有余额不重算；已确认查询按原锁定 X 结算。</p>
    <ElForm label-position="top" @submit.prevent="announce">
      <ElFormItem label="拟生效系数 X" for="coefficient-value">
        <ElInput id="coefficient-value" v-model="form.coefficient" required />
      </ElFormItem>
      <ElFormItem label="告知生效时间" for="coefficient-time">
        <input id="coefficient-time" v-model="form.effectiveAt" type="datetime-local" step="1" required />
      </ElFormItem>
      <ElFormItem label="调整通知" for="coefficient-notice">
        <ElInput id="coefficient-notice" v-model="form.notice" required />
      </ElFormItem>
      <ElButton native-type="submit" :disabled="busy">发布通知</ElButton>
    </ElForm>
    <div v-for="change in snapshot?.changes ?? []" :key="change.id">
      <h3>{{ change.previousCoefficient }} → {{ change.proposedCoefficient }}</h3>
      <p>通知：{{ change.notice }}；告知于 {{ change.announcedAt }}；计划生效 {{ change.effectiveAt }}</p>
      <p v-if="change.activatedAt">实际生效：{{ change.activatedAt }}；核验上游余额 {{ change.coverage?.upstreamBalance }}，覆盖需求 {{ change.coverage?.requiredUpstreamPoints }}，在途已扣 {{ change.coverage?.inTransitChargedUpstreamPoints }}。</p>
      <ElButton v-else :disabled="busy || new Date(change.effectiveAt).getTime() > now" @click="activate(change.id)">核验覆盖并生效</ElButton>
    </div>
    <ElButton :disabled="busy" @click="refresh">刷新系数通知</ElButton>
  </section>
</template>
