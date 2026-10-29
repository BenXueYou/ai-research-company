<template>
  <section class="email-composer">
    <h3>写本次邮件</h3>
    <p class="hint">企业邮箱优先；个人邮箱须明确选择。邮件仅使用公共模板预设附件。</p>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <p v-if="status" role="status">{{ status }}</p>
    <div v-for="contact in contacts" :key="contact.id" class="email-contact">
      <div>
        <strong>来源 {{ contact.mailsouId }}</strong>
        <small>企业邮箱 {{ contact.email || '无' }} · 个人邮箱 {{ contact.personalEmail || '无' }}</small>
        <small v-if="contact.unsubscribed">本条联系人已标记退订，默认不选</small>
        <small v-if="contact.ownershipStatus === 'pending'">原返回企业：{{ contact.returnedCompanyName }}</small>
      </div>
      <template v-if="contact.ownershipStatus === 'pending' && !contact.ownershipReason">
        <el-input v-model="ownershipReasons[contact.id]" placeholder="逐条填写归属确认说明" />
        <el-button :disabled="busy" @click="confirmOwnership(contact)">确认该联系人归属</el-button>
      </template>
      <template v-else>
        <small v-if="contact.ownershipReason">归属已说明：{{ contact.ownershipReason }}</small>
        <el-select v-model="emailKinds[contact.id]" :disabled="busy" placeholder="不选此联系人" @change="preview = null">
          <el-option label="不选此联系人" value="none" />
          <el-option v-if="contact.email" :label="`企业邮箱 ${contact.email}`" value="company" />
          <el-option v-if="contact.personalEmail" :label="`个人邮箱 ${contact.personalEmail}`" value="personal" />
        </el-select>
        <el-input
          v-if="emailKinds[contact.id] !== 'none'"
          v-model="contactNames[contact.id]"
          placeholder="本次联系人称呼（模板变量 contactName）"
          @input="preview = null"
        />
        <el-checkbox
          v-if="contact.unsubscribed && emailKinds[contact.id] !== 'none'"
          v-model="unsubscribeConfirmations[contact.id]"
          @change="preview = null"
        >我已看到此条退订记录，仍选择该联系人</el-checkbox>
      </template>
      <el-button :disabled="busy" @click="markUnsubscribed(contact)">
        {{ contact.unsubscribed ? '取消本条退订标记' : '标记本条联系人退订' }}
      </el-button>
    </div>
    <div v-for="group in duplicateGroups" :key="group.key" class="search-summary">
      <strong>同邮箱 {{ group.key }}：请选择变量来源</strong>
      <el-select v-model="variableSources[group.key]" placeholder="请选择来源" @change="preview = null">
        <el-option
          v-for="item in group.items"
          :key="item.id"
          :label="`${item.mailsouId} · ${contactNames[item.id] || '称呼未填'}`"
          :value="item.id"
        />
      </el-select>
    </div>
    <el-form class="business-form" label-position="top" @submit.prevent="save">
      <el-form-item label="公共模板">
        <el-select v-model="templateId" placeholder="选择公共模板" @change="copyTemplate">
          <el-option
            v-for="item in templates"
            :key="item.id"
            :label="`${item.name} · v${item.version}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <p v-if="chosenTemplate" class="hint">
        已复制版本 v{{ chosenTemplate.version }}；预设附件：{{ chosenTemplate.attachments.map(item => item.fileName).join('、') || '无' }}。
        可用变量：<code v-pre>{{companyName}}</code>、<code v-pre>{{contactName}}</code>。
      </p>
      <el-form-item label="本次主题">
        <el-input v-model="subject" :disabled="busy" @input="preview = null" />
      </el-form-item>
      <el-form-item label="本次正文">
        <el-input v-model="content" type="textarea" :rows="7" :disabled="busy" @input="preview = null" />
      </el-form-item>
      <div class="form-actions">
        <el-button type="primary" native-type="submit" :disabled="busy || !chosenTemplate">保存本次草稿</el-button>
        <el-button :disabled="busy || !chosenTemplate" @click="makePreview">保存并预览本次邮件</el-button>
      </div>
    </el-form>
    <div v-if="preview" class="email-preview">
      <h4>本次预览 · {{ preview.recipients.length }} 个去重邮箱</h4>
      <p>模板 {{ preview.templateId }} · 版本 {{ preview.templateVersion }} · 预览 {{ preview.previewId }}</p>
      <p>预设附件：{{ preview.attachments.map(item => item.fileName).join('、') || '无' }}</p>
      <div v-for="recipient in preview.recipients" :key="recipient.emailKey">
        <strong>{{ recipient.email }} · 变量来源 {{ recipient.mailsouId }}</strong>
        <p v-if="recipient.unsubscribedContactIds.length">包含已确认提示的退订联系人</p>
        <p>主题：{{ recipient.subject }}</p>
        <pre>{{ recipient.content }}</pre>
      </div>
      <el-button :disabled="busy || confirmedPreviewId === preview.previewId" @click="confirmPreview">
        {{ confirmedPreviewId === preview.previewId ? '本次快照已确认' : '确认本次内容与收件人（不发送）' }}
      </el-button>
      <div v-if="confirmedPreviewId === preview.previewId" class="email-send-confirmation">
        <el-select v-model="channelId" placeholder="选择本批发送渠道">
          <el-option
            v-if="smtpChannel?.verificationState === 'available'"
            :label="`国内 SMTP · ${smtpChannel.replyTo}`"
            :value="smtpChannel.id"
          />
          <el-option
            v-if="umailChannel?.verificationState === 'available' && umailResource?.resourceStatus === 'available'"
            :label="`U-Mail 域名 · ${umailChannel.replyAddress}`"
            :value="umailChannel.id"
          />
        </el-select>
        <p>本批 {{ preview.recipients.length }} 个去重邮箱；今日额度 {{ quota?.dailyLimit ?? '加载中' }}，已用 {{ quota?.used ?? 0 }}，预占 {{ quota?.reserved ?? 0 }}。</p>
        <el-checkbox v-model="confirmUnsubscribeNotice">已核对本批退订提示</el-checkbox>
        <el-checkbox v-model="confirmQuota">确认使用本企业今日额度</el-checkbox>
        <el-button
          :disabled="busy || !channelId || !confirmUnsubscribeNotice || !confirmQuota || !!batchId"
          @click="sendBatch"
        >{{ batchId ? '本次已入队' : '确认并执行本次单轮发送' }}</el-button>
        <p v-if="batchId" role="status">批次 {{ batchId }} 已记录，请在邮件发送记录查看逐收件人结果。</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElAlert, ElButton, ElCheckbox, ElForm, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';

interface Contact {
  id: string;
  mailsouId: string;
  returnedCompanyName: string;
  ownershipStatus: 'matched' | 'pending';
  ownershipReason: string | null;
  email: string | null;
  personalEmail: string | null;
  unsubscribed: boolean;
}
interface Template {
  id: string;
  name: string;
  version: number;
  subject: string;
  content: string;
  attachments: Array<{ id: string; fileName: string }>;
}
interface Preview {
  previewId: string;
  templateId: string;
  templateVersion: number;
  attachments: Array<{ id: string; fileName: string }>;
  recipients: Array<{
    email: string;
    emailKey: string;
    mailsouId: string;
    subject: string;
    content: string;
    unsubscribedContactIds: string[];
  }>;
}
interface Quota { dailyLimit: number; used: number; reserved: number }
interface SmtpChannel { id: string; replyTo: string; verificationState: string }
interface UMailChannel { id: string; replyAddress: string; verificationState: string; defaultChannel: boolean }
interface UMailResource { resourceStatus: string }
const props = defineProps<{
  profile: { id: string; name: string };
  contacts: Contact[];
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const emit = defineEmits<{ updated: [] }>();
const templates = ref<Template[]>([]);
const templateId = ref('');
const subject = ref('');
const content = ref('');
const draftId = ref('');
const preview = ref<Preview | null>(null);
const confirmedPreviewId = ref('');
const batchId = ref('');
const channelId = ref('');
const smtpChannel = ref<SmtpChannel | null>(null);
const umailChannel = ref<UMailChannel | null>(null);
const umailResource = ref<UMailResource | null>(null);
const quota = ref<Quota | null>(null);
const confirmUnsubscribeNotice = ref(false);
const confirmQuota = ref(false);
const busy = ref(false);
const error = ref('');
const status = ref('');
const emailKinds = reactive<Record<string, 'none' | 'company' | 'personal'>>({});
const contactNames = reactive<Record<string, string>>({});
const ownershipReasons = reactive<Record<string, string>>({});
const unsubscribeConfirmations = reactive<Record<string, boolean>>({});
const variableSources = reactive<Record<string, string>>({});
const chosenTemplate = computed(() => templates.value.find(item => item.id === templateId.value));
const selected = computed(() => props.contacts.filter(item => emailKinds[item.id] && emailKinds[item.id] !== 'none'));
const duplicateGroups = computed(() => {
  const groups = new Map<string, Contact[]>();
  for (const item of selected.value) {
    const email = emailKinds[item.id] === 'company' ? item.email : item.personalEmail;
    if (!email) continue;
    const key = email.toLowerCase();
    groups.set(key, [...groups.get(key) ?? [], item]);
  }
  return [...groups].filter(([_key, items]) => items.length > 1).map(([key, items]) => ({ key, items }));
});
watch(() => props.contacts, items => {
  for (const item of items) {
    if (!(item.id in emailKinds)) emailKinds[item.id] = item.ownershipStatus === 'matched' && !item.unsubscribed && item.email ? 'company' : 'none';
  }
}, { immediate: true });
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
function confirmOwnership(contact: Contact) {
  void run(async () => {
    await props.request('company-contacts/confirm-ownership', {
      contactId: contact.id,
      reason: ownershipReasons[contact.id]
    });
    status.value = `已记录 ${contact.mailsouId} 的归属确认说明`;
    emit('updated');
  });
}
function markUnsubscribed(contact: Contact) {
  void run(async () => {
    await props.request('company-contacts/unsubscribed', { contactId: contact.id, unsubscribed: !contact.unsubscribed });
    emailKinds[contact.id] = 'none';
    unsubscribeConfirmations[contact.id] = false;
    preview.value = null;
    emit('updated');
  });
}
function copyTemplate() {
  subject.value = chosenTemplate.value?.subject ?? '';
  content.value = chosenTemplate.value?.content ?? '';
  draftId.value = '';
  preview.value = null;
}
async function persist() {
  if (!chosenTemplate.value) throw new Error('先选择公共模板');
  const selections = selected.value.map(item => {
    const email = emailKinds[item.id] === 'company' ? item.email : item.personalEmail;
    const key = email?.toLowerCase() ?? '';
    const group = duplicateGroups.value.find(entry => entry.key === key);
    return {
      contactId: item.id,
      emailKind: emailKinds[item.id],
      variables: { contactName: contactNames[item.id] ?? '' },
      ...(group ? { variableSourceContactId: variableSources[key] } : {}),
      confirmUnsubscribed: unsubscribeConfirmations[item.id] === true
    };
  });
  const body: Record<string, unknown> = {
    profileId: props.profile.id,
    templateId: chosenTemplate.value.id,
    templateVersion: chosenTemplate.value.version,
    subject: subject.value,
    content: content.value,
    selections
  };
  if (draftId.value) body.draftId = draftId.value;
  const saved = await props.request('email-drafts', body) as { draftId: string };
  draftId.value = saved.draftId;
  preview.value = null;
  status.value = '本次草稿已保存，公共模板未改变';
}
function save() {
  void run(persist);
}
function makePreview() {
  void run(async () => {
    await persist();
    preview.value = await props.request('email-drafts/preview', { draftId: draftId.value }) as Preview;
    batchId.value = '';
    confirmedPreviewId.value = '';
    confirmUnsubscribeNotice.value = false;
    confirmQuota.value = false;
    status.value = '预览快照已保存；未发送邮件、未扣查询点数';
  });
}
function confirmPreview() {
  if (!preview.value) return;
  const previewId = preview.value.previewId;
  void run(async () => {
    await props.request('email-previews/confirm', { previewId });
    confirmedPreviewId.value = previewId;
    const [channelResult, umailResult, quotaResult] = await Promise.all([
      props.request('sending-channels/smtp'),
      props.request('sending-channels/umail'),
      props.request('email-quota')
    ]);
    smtpChannel.value = (channelResult as { channel: SmtpChannel | null }).channel;
    const umail = umailResult as { channel: UMailChannel | null; resource: UMailResource | null };
    umailChannel.value = umail.channel;
    umailResource.value = umail.resource;
    channelId.value = umailChannel.value?.defaultChannel &&
      umailChannel.value.verificationState === 'available' && umailResource.value?.resourceStatus === 'available'
      ? umailChannel.value.id
      : smtpChannel.value?.verificationState === 'available' ? smtpChannel.value.id : '';
    quota.value = quotaResult as Quota;
    status.value = '本次内容与收件人已确认；尚未发送或占用日额度';
  });
}
function sendBatch() {
  if (!preview.value) return;
  void run(async () => {
    const result = await props.request('email-batches/confirm', {
      previewId: preview.value!.previewId,
      channelId: channelId.value,
      confirmUnsubscribeNotice: confirmUnsubscribeNotice.value,
      confirmQuota: confirmQuota.value
    }) as { batchId: string };
    batchId.value = result.batchId;
    const execution = await props.request('email-batches/execute', { batchId: result.batchId }) as {
      recipients: Array<{ status: string }>;
    };
    quota.value = await props.request('email-quota') as Quota;
    const unresolved = execution.recipients.filter(recipient =>
      ['uncertain', 'submitting'].includes(recipient.status)
    ).length;
    status.value = unresolved
      ? `本次已执行，${unresolved} 个收件人结果待确认，预占保留；请在邮件发送记录核实，请勿重复发送`
      : `本次已执行，${execution.recipients.length} 个收件人结果已记录；受理不代表送达`;
  });
}
onMounted(() => {
  void props.request('public-templates').then(result => {
    templates.value = (result as { templates: Template[] }).templates;
  }).catch(failure => {
    error.value = failure instanceof Error ? failure.message : '公共模板加载失败';
  });
});
</script>

<style scoped>
.email-composer {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--console-line);
  border-radius: 12px;
  margin-top: 22px;
  color: var(--console-text);
  background: #fff;
  box-shadow: 0 2px 5px #19234605;
}
.email-composer h3 { margin: 0 0 6px; font-size: 17px; }
.email-composer > .hint { margin: 0 0 21px; color: var(--console-muted); font-size: 13px; line-height: 1.7; }
.email-composer > [role='status'] { padding: 11px 13px; border-radius: 8px; color: #237453; background: #edf8f2; }
.email-contact {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(160px, .9fr) auto;
  align-items: center;
  gap: 10px 16px;
  min-width: 0;
  padding: 16px 0;
  border-top: 1px solid #edf0f6;
}
.email-contact > div { min-width: 0; }
.email-contact strong { display: block; margin-bottom: 4px; color: #34415b; font-size: 13px; }
.email-contact small { display: block; color: var(--console-muted); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.search-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid #e9d9b9;
  border-radius: 8px;
  margin: 14px 0;
  color: #805b22;
  background: #fff9ee;
}
.email-composer > .el-form { padding-top: 20px; border-top: 1px solid #edf0f6; margin-top: 18px; }
.email-preview { padding: 20px; border: 1px solid #dfe5f5; border-radius: 10px; margin-top: 22px; background: #f8faff; }
.email-preview h4 { margin: 0 0 8px; color: #344ab5; font-size: 15px; }
.email-preview > p { color: var(--console-muted); font-size: 12px; overflow-wrap: anywhere; }
.email-preview > div:not(.email-send-confirmation) { padding: 15px; border: 1px solid #e7ebf5; border-radius: 8px; margin: 12px 0; background: #fff; }
.email-preview strong { overflow-wrap: anywhere; }
.email-preview pre { max-width: 100%; padding: 12px; border-radius: 8px; background: #f5f7fc; white-space: pre-wrap; overflow-wrap: anywhere; }
.email-send-confirmation { padding: 18px; border: 1px solid #d8e0f6; border-radius: 9px; margin-top: 18px; background: #fff; }
.email-send-confirmation > p { color: #56637b; font-size: 13px; line-height: 1.7; }
@media (max-width: 760px) {
  .email-composer { padding: 18px 15px; }
  .email-contact { grid-template-columns: minmax(0, 1fr); }
  .email-preview { padding: 16px; }
  .email-send-confirmation { padding: 15px; }
}
</style>
