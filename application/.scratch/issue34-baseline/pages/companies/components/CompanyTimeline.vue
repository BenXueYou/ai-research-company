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
      <el-form-item v-if="form.type === 'whatsapp' && !editingId" label="附件（可选）">
        <input type="file" :disabled="busy" @change="selectRecordFile" />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :loading="busy">{{ editingId ? '保存修改' : '登记记录' }}</el-button>
      <el-button v-if="editingId" :disabled="busy" @click="reset">取消编辑</el-button>
    </el-form>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-alert v-if="notice" type="success" :title="notice" :closable="false" />
    <section class="attachment-panel">
      <h4>档案附件</h4>
      <p class="hint">支持图片、PDF、Office 文档和压缩包，单文件最多 20MB；本企业最多 50 个。</p>
      <input type="file" :disabled="busy" @change="uploadProfileFile" />
      <div v-for="attachment in profileAttachments" :key="attachment.id" class="attachment-row">
        <span>{{ attachment.fileName }} · {{ formatSize(attachment.sizeBytes) }}<span v-if="attachment.expired"> · 已到期</span></span>
        <el-button :disabled="busy" @click="download(attachment)">下载</el-button>
        <el-button v-if="canDelete" :disabled="busy" @click="removeAttachment(attachment)">删除</el-button>
        <el-button v-if="canDelete && attachment.expired" :disabled="busy" @click="cleanExpired(attachment)">清理到期文件</el-button>
      </div>
    </section>
    <section v-if="expiredDeletedAttachments.length" class="attachment-panel">
      <h4>已删除的到期文件</h4>
      <div v-for="attachment in expiredDeletedAttachments" :key="attachment.id" class="attachment-row">
        <span>{{ attachment.fileName }} · {{ formatSize(attachment.sizeBytes) }}</span>
        <el-button :disabled="busy" @click="cleanExpired(attachment)">清理到期文件</el-button>
      </div>
    </section>
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
        <label class="record-upload">添加附件 <input type="file" :disabled="busy" @change="event => uploadRecordFile(event, record.id)" /></label>
        <div v-for="attachment in recordAttachments(record.id)" :key="attachment.id" class="attachment-row">
          <span>{{ attachment.fileName }} · {{ formatSize(attachment.sizeBytes) }}<span v-if="attachment.expired"> · 已到期</span></span>
          <el-button :disabled="busy" @click="download(attachment)">下载</el-button>
          <el-button v-if="canDelete" :disabled="busy" @click="removeAttachment(attachment)">删除</el-button>
          <el-button v-if="canDelete && attachment.expired" :disabled="busy" @click="cleanExpired(attachment)">清理到期文件</el-button>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
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
interface Attachment {
  id: string;
  communicationId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expired: boolean;
  deleted: boolean;
}
const props = defineProps<{
  profileId: string;
  currentAccountId: string;
  canDelete: boolean;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const labels: Record<RecordType, string> = { reply: '回复摘要', note: '备注', whatsapp: 'WhatsApp', email: '邮件' };
const records = ref<Entry[]>([]);
const attachments = ref<Attachment[]>([]);
const selectedRecordFile = ref<File | null>(null);
const profileAttachments = computed(() => attachments.value.filter(item => item.communicationId === null && !item.deleted));
const expiredDeletedAttachments = computed(() => attachments.value.filter(item => item.deleted && item.expired));
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
  selectedRecordFile.value = null;
}
function formatSize(bytes: number) { return `${(bytes / 1024).toFixed(1)} KB`; }
function recordAttachments(recordId: string) { return attachments.value.filter(item => item.communicationId === recordId && !item.deleted); }
function selectRecordFile(event: Event) {
  selectedRecordFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('读取附件失败'));
    reader.readAsDataURL(file);
  });
}
async function loadAttachments() {
  const result = await props.request('company-attachments/list', { profileId: props.profileId }) as { attachments: Attachment[] };
  attachments.value = result.attachments;
}
async function uploadFile(file: File, communicationId?: string) {
  if (file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('单文件须在 1 字节至 20MB 之间');
  await props.request('company-attachments/upload', {
    profileId: props.profileId,
    ...(communicationId ? { communicationId } : {}),
    fileName: file.name,
    mimeType: file.type,
    contentBase64: await fileBase64(file)
  });
  await loadAttachments();
}
async function uploadProfileFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || busy.value) return;
  busy.value = true;
  error.value = '';
  try { await uploadFile(file); notice.value = '档案附件已保存'; }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '上传失败'; }
  finally { busy.value = false; input.value = ''; }
}
async function uploadRecordFile(event: Event, recordId: string) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || busy.value) return;
  busy.value = true;
  error.value = '';
  try { await uploadFile(file, recordId); notice.value = '记录附件已保存'; }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '上传失败'; }
  finally { busy.value = false; input.value = ''; }
}
async function download(attachment: Attachment) {
  error.value = '';
  try {
    const result = await props.request('company-attachments/download', {
      profileId: props.profileId, attachmentId: attachment.id
    }) as { fileName: string; mimeType: string; contentBase64: string };
    const binary = atob(result.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.fileName;
    link.click();
    URL.revokeObjectURL(url);
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '下载失败'; }
}
async function removeAttachment(attachment: Attachment) {
  if (busy.value || !window.confirm('确认删除这个附件？')) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('company-attachments/delete', { profileId: props.profileId, attachmentId: attachment.id });
    await loadAttachments();
    notice.value = '附件已删除';
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '删除失败'; }
  finally { busy.value = false; }
}
async function cleanExpired(attachment: Attachment) {
  if (busy.value || !window.confirm('确认清理这个到期文件？清理后无法下载。')) return;
  busy.value = true;
  error.value = '';
  try {
    await props.request('company-attachments/clean-expired', { profileId: props.profileId, attachmentId: attachment.id });
    await loadAttachments();
    notice.value = '到期文件已清理';
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '清理失败'; }
  finally { busy.value = false; }
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
    await loadAttachments();
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
    const saved = await props.request(editingId.value ? 'company-timeline/edit' : 'company-timeline/create',
      editingId.value ? { ...payload, recordId: editingId.value } : payload);
    if (!editingId.value && form.type === 'whatsapp' && selectedRecordFile.value) {
      const recordId = (saved as { id: string }).id;
      try { await uploadFile(selectedRecordFile.value, recordId); }
      catch (failure) {
        error.value = `记录已保存，但附件上传失败：${failure instanceof Error ? failure.message : '请在记录中重试'}`;
      }
    }
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
.attachment-panel { border-top: 1px solid #ddd; margin-top: 1rem; padding-top: 1rem; }
.attachment-row { display: flex; align-items: center; gap: .5rem; margin: .25rem 0; }
.record-upload { display: inline-block; margin: .5rem; }
</style>
