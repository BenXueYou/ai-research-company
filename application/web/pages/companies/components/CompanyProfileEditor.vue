<template>
  <section class="profile-editor">
    <h4>本企业档案补充</h4>
    <p class="hint">以下为团队人工维护信息；源数据与操作记录独立保存。</p>
    <el-form class="business-form" v-if="!profile.deletedAt" label-position="top" @submit.prevent="save">
      <el-form-item label="主营产品"><el-input v-model="mainProducts" :disabled="busy" maxlength="2000" /></el-form-item>
      <el-form-item label="采购需求"><el-input v-model="purchasingNeeds" :disabled="busy" maxlength="2000" /></el-form-item>
      <el-form-item label="合作意向"><el-input v-model="cooperationIntent" :disabled="busy" maxlength="2000" /></el-form-item>
      <el-form-item label="下次跟进时间"><el-date-picker v-model="nextFollowUpAt" type="datetime" value-format="YYYY-MM-DDTHH:mm" format="YYYY-MM-DD HH:mm" :clearable="false" :disabled="busy" /></el-form-item>
      <el-form-item label="客户状态">
        <el-select :empty-values="[null, undefined]" v-model="customerStatus" :disabled="busy">
          <el-option value="lead" label="线索" /><el-option value="following" label="跟进中" />
          <el-option value="replied" label="已回复" /><el-option value="invalid" label="无效" />
        </el-select>
      </el-form-item>
      <el-form-item label="星级"><el-select :empty-values="[null, undefined]" v-model="starRating" :disabled="busy">
        <el-option value="" label="未设置" /><el-option v-for="star in 5" :key="star" :value="String(star)" :label="(star) + ' 星'" />
      </el-select></el-form-item>
      <el-form-item label="标签（英文逗号分隔）"><el-input v-model="tags" :disabled="busy" /></el-form-item>
      <div class="form-actions">
        <el-button type="primary" native-type="submit" :loading="busy">保存补充</el-button>
      </div>
    </el-form>
    <el-button v-if="canDelete && !profile.deletedAt" :disabled="busy" @click="setDeleted(true)">软删除档案</el-button>
    <el-button v-if="canDelete && profile.deletedAt" :disabled="busy" @click="setDeleted(false)">恢复档案</el-button>
    <el-button :disabled="busy" @click="loadHistory">查看操作记录</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-for="(entry, index) in history" :key="index" class="profile-history">
      {{ entry.createdAt }} · {{ entry.actorId }} · {{ { update: '修改', delete: '软删除', restore: '恢复' }[entry.event] }}
      <details><summary>查看修改前后</summary><pre>{{ JSON.stringify(entry.beforeValue, null, 2) }}</pre><pre>{{ JSON.stringify(entry.afterValue, null, 2) }}</pre></details>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElDatePicker, ElOption, ElSelect, ElButton, ElForm, ElFormItem, ElInput } from 'element-plus';

interface Profile {
  id: string;
  mainProducts: string;
  purchasingNeeds: string;
  cooperationIntent: string;
  nextFollowUpAt: string | null;
  customerStatus: string;
  starRating: number | null;
  tags: string[];
  deletedAt: string | null;
}
interface HistoryEntry {
  event: 'update' | 'delete' | 'restore';
  actorId: string;
  createdAt: string;
  beforeValue: Record<string, unknown>;
  afterValue: Record<string, unknown>;
}
const props = defineProps<{
  profile: Profile;
  canDelete: boolean;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const emit = defineEmits<{ changed: [] }>();
const mainProducts = ref('');
const purchasingNeeds = ref('');
const cooperationIntent = ref('');
const nextFollowUpAt = ref('');
const customerStatus = ref('lead');
const starRating = ref('');
const tags = ref('');
const history = ref<HistoryEntry[]>([]);
const busy = ref(false);
const error = ref('');
const notice = ref('');
function localDateTime(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
watch(() => props.profile, profile => {
  mainProducts.value = profile.mainProducts;
  purchasingNeeds.value = profile.purchasingNeeds;
  cooperationIntent.value = profile.cooperationIntent;
  nextFollowUpAt.value = profile.nextFollowUpAt ? localDateTime(profile.nextFollowUpAt) : '';
  customerStatus.value = profile.customerStatus;
  starRating.value = profile.starRating === null ? '' : String(profile.starRating);
  tags.value = profile.tags.join(',');
}, { immediate: true });
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try { await action(); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '档案操作失败'; }
  finally { busy.value = false; }
}
function save() {
  void run(async () => {
    const parsedTags = tags.value ? tags.value.split(',').map(tag => tag.trim()) : [];
    await props.request('company-profiles/update', {
      profileId: props.profile.id,
      mainProducts: mainProducts.value,
      purchasingNeeds: purchasingNeeds.value,
      cooperationIntent: cooperationIntent.value,
      nextFollowUpAt: nextFollowUpAt.value ? new Date(nextFollowUpAt.value).toISOString() : null,
      customerStatus: customerStatus.value,
      starRating: starRating.value ? Number(starRating.value) : null,
      tags: parsedTags
    });
    notice.value = '档案补充已保存';
    emit('changed');
  });
}
function setDeleted(deleted: boolean) {
  if (!window.confirm(deleted ? '确认软删除此档案？关联历史仍会保留。' : '确认恢复此档案？')) return;
  void run(async () => {
    await props.request(deleted ? 'company-profiles/delete' : 'company-profiles/restore', { profileId: props.profile.id });
    emit('changed');
  });
}
function loadHistory() {
  void run(async () => {
    history.value = await props.request('company-profiles/history', { profileId: props.profile.id }) as HistoryEntry[];
  });
}
</script>
