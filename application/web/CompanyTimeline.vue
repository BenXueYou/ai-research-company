<template>
  <section class="timeline-panel">
    <h3>跟进时间线</h3>
    <p class="hint">回复摘要、备注和 WhatsApp 沟通由成员手动登记。</p>
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="记录类型">
        <el-select v-model="form.type" :disabled="busy">
          <el-option label="回复摘要" value="reply" />
          <el-option label="备注" value="note" />
          <el-option label="WhatsApp" value="whatsapp" />
        </el-select>
      </el-form-item>
      <el-form-item label="发生时间">
        <el-input v-model="form.eventTime" type="datetime-local" :disabled="busy" />
      </el-form-item>
      <el-form-item v-if="form.type !== 'note'" label="联系人或号码">
        <el-input v-model="form.contactOrPhone" :disabled="busy" placeholder="号码将加密保存并脱敏显示" />
      </el-form-item>
      <el-form-item label="摘要">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="3"
          :maxlength="5000"
          :disabled="busy"
        />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :loading="busy">{{ editingId ? '保存修改' : '登记记录' }}</el-button>
      <el-button v-if="editingId" :disabled="busy" @click="reset">取消编辑</el-button>
    </el-form>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-alert v-if="notice" type="success" :title="notice" :closable="false" />
    <div class="timeline-filter">
      <label :for="`timeline-type-${profileId}`">筛选类型</label>
      <el-select
        :id="`timeline-type-${profileId}`"
        v-model="filter"
        :disabled="busy"
        @change="load"
      >
        <el-option label="全部" value="all" />
        <el-option label="邮件" value="email" />
        <el-option label="回复摘要" value="reply" />
        <el-option label="备注" value="note" />
        <el-option label="WhatsApp" value="whatsapp" />
      </el-select>
    </div>
    <el-empty v-if="!records.length" description="暂无该类型记录" />
    <article v-for="record in records" :key="record.id" class="timeline-entry">
      <strong>{{ labels[record.type] }} · {{ formatTime(record.eventTime) }}</strong>
      <span v-if="record.contactOrPhone">{{ record.contactOrPhone }}</span>
      <p>{{ record.content }}</p>
      <small>登记于 {{ formatTime(record.createdAt) }}</small>
      <div v-if="record.type !== 'email'">
        <el-button v-if="record.createdBy === currentAccountId" :disabled="busy" @click="edit(record)">编辑</el-button>
        <el-button v-if="canDelete" :disabled="busy" @click="remove(record)">删除</el-button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect
} from 'element-plus';
type RecordType = 'reply' | 'note' | 'whatsapp' | 'email';
interface Entry {
  id: string;
  type: RecordType;
  eventTime: string;
  contactOrPhone: string | null;
  content: string;
  createdBy: string;
  createdAt: string;
}
const props = defineProps<{
  profileId: string;
  currentAccountId: string;
  canDelete: boolean;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const labels: Record<RecordType, string> = { reply: '回复摘要', note: '备注', whatsapp: 'WhatsApp', email: '邮件' };
const records = ref<Entry[]>([]);
const filter = ref('all');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const editingId = ref('');
const form = reactive({
  type: 'reply' as Exclude<RecordType, 'email'>,
  eventTime: '',
  contactOrPhone: '',
  content: ''
});
function reset() {
  editingId.value = '';
  form.type = 'reply';
  form.eventTime = '';
  form.contactOrPhone = '';
  form.content = '';
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}
async function load() {
  try {
    const result = await props.request('company-timeline/list', {
      profileId: props.profileId,
      ...(filter.value === 'all' ? {} : { type: filter.value })
    }) as { records: Entry[] };
    records.value = result.records;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '加载时间线失败';
  }
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (!form.eventTime || !Number.isFinite(new Date(form.eventTime).getTime())) throw new Error('请选择有效的发生时间');
    const payload = {
      profileId: props.profileId,
      type: form.type,
      eventTime: new Date(form.eventTime).toISOString(),
      contactOrPhone: form.type === 'note' ? null : form.contactOrPhone,
      content: form.content
    };
    await props.request(editingId.value ? 'company-timeline/edit' : 'company-timeline/create',
      editingId.value ? { ...payload, recordId: editingId.value } : payload);
    notice.value = editingId.value ? '记录已更新' : '记录已登记';
    reset();
    await load();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
function edit(record: Entry) {
  if (record.type === 'email') return;
  editingId.value = record.id;
  form.type = record.type;
  const date = new Date(record.eventTime);
  form.eventTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  form.contactOrPhone = record.contactOrPhone?.startsWith('****') ? '' : record.contactOrPhone ?? '';
  form.content = record.content;
  notice.value = record.contactOrPhone?.startsWith('****') ? '号码已脱敏，编辑时请重新填写号码' : '';
}
async function remove(record: Entry) {
  if (busy.value || !window.confirm('确认删除这条人工记录？')) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('company-timeline/delete', { profileId: props.profileId, recordId: record.id });
    notice.value = '记录已删除';
    await load();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '删除失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => { void load(); });
</script>

<style scoped>
.timeline-panel { padding: 1rem 0; }
.timeline-filter { display: flex; align-items: center; gap: .75rem; margin: 1rem 0; }
.timeline-entry { border-top: 1px solid #ddd; padding: .75rem 0; }
.timeline-entry span, .timeline-entry small { display: block; }
</style>
