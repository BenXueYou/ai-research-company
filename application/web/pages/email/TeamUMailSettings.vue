<template>
  <section class="umail-section">
    <div class="page-heading">
      <p class="eyebrow">团队发信 / U-Mail</p>
      <h2>域名渠道</h2>
      <p>每企业最多一套。企业配合域名验证，回复由团队在原邮箱查看。</p>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      :closable="false"
    />
    <el-alert
      v-if="notice"
      role="status"
      type="success"
      :title="notice"
      :closable="false"
    />
    <div v-if="resource" class="workspace-card umail-status">
      <h3>平台资源</h3>
      <p>{{ statusLabel(resource.resourceStatus) }} · {{ resource.verificationDetail }}</p>
      <p class="hint">第一阶段服务费用由平台承担。</p>
    </div>
    <div v-else class="workspace-card umail-status">
      <p>平台尚未为本企业配置 U-Mail 隔离资源。</p>
    </div>
    <div v-if="channel" class="workspace-card umail-status">
      <h3>当前域名渠道</h3>
      <dl>
        <dt>发信域名</dt><dd>{{ channel.domain }}</dd>
        <dt>发信地址</dt><dd>{{ channel.senderAddress }}</dd>
        <dt>回复地址</dt><dd data-testid="umail-reply-address">{{ channel.replyAddress }}</dd>
        <dt>默认渠道</dt><dd>{{ channel.defaultChannel ? '是' : '否' }}</dd>
        <dt>域名状态</dt><dd>{{ domainLabel(channel.domainStatus) }}</dd>
        <dt>账号状态</dt><dd>{{ statusLabel(channel.accountStatus) }}</dd>
      </dl>
      <p class="hint">{{ channel.verificationDetail }}</p>
    </div>
    <el-form
      v-if="canMaintain && resource"
      class="identity-card umail-form"
      label-position="top"
      @submit.prevent="save"
    >
      <h3>{{ channel ? '更新域名渠道' : '配置域名渠道' }}</h3>
      <el-form-item label="发信域名" for="umail-domain">
        <el-input
          id="umail-domain"
          v-model="domain"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="域名发信地址" for="umail-sender-address">
        <el-input
          id="umail-sender-address"
          v-model="senderAddress"
          type="email"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="团队回复地址" for="umail-reply-address">
        <el-input
          id="umail-reply-address"
          v-model="replyAddress"
          type="email"
          required
          :disabled="busy"
        />
      </el-form-item>
      <label class="default-choice">
        <input v-model="defaultChannel" type="checkbox" :disabled="busy">
        设为团队默认渠道
      </label>
      <el-button class="primary-button" native-type="submit" :disabled="busy">
        {{ busy ? '正在核验并保存…' : '核验域名渠道并保存' }}
      </el-button>
    </el-form>
    <div v-else-if="!canMaintain" class="workspace-card">
      <p>业务员可查看本企业渠道状态，但不能维护设置。</p>
    </div>
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

interface Resource {
  resourceStatus: string;
  verificationDetail: string;
}
interface Channel {
  domain: string;
  senderAddress: string;
  replyAddress: string;
  defaultChannel: boolean;
  domainStatus: string;
  accountStatus: string;
  verificationDetail: string;
}
const props = defineProps<{
  canMaintain: boolean;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const resource = shallowRef<Resource | null>(null);
const channel = shallowRef<Channel | null>(null);
const domain = ref('');
const senderAddress = ref('');
const replyAddress = ref('');
const defaultChannel = ref(false);
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const error = ref('');
const notice = ref('');
function statusLabel(value: string) {
  if (value === 'available') return '受控验证可用';
  if (value === 'unavailable') return '受控验证不可用';
  return '尚未真实联调';
}
function domainLabel(value: string) {
  if (value === 'verified') return '已通过受控验证';
  if (value === 'pending') return '待验证';
  if (value === 'failed') return '验证失败';
  return '尚未真实联调';
}
function apply(result: { resource: Resource | null; channel: Channel | null }) {
  resource.value = result.resource;
  channel.value = result.channel;
  if (!result.channel) return;
  domain.value = result.channel.domain;
  senderAddress.value = result.channel.senderAddress;
  replyAddress.value = result.channel.replyAddress;
  defaultChannel.value = result.channel.defaultChannel;
}
async function refresh() {
  apply(await props.request('sending-channels/umail') as { resource: Resource | null; channel: Channel | null });
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await props.request('sending-channels/umail', {
      domain: domain.value,
      senderAddress: senderAddress.value,
      replyAddress: replyAddress.value,
      defaultChannel: defaultChannel.value,
      requestId: requestId.value
    }) as { resource: Resource; channel: Channel };
    apply(result);
    requestId.value = crypto.randomUUID();
    notice.value = 'U-Mail 域名渠道已保存；请查看受控核验状态';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '域名渠道保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try { await refresh(); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '域名渠道加载失败'; }
});
</script>

<style scoped>
.umail-section { margin-top: 32px; }
.umail-status { margin-bottom: 24px; }
.umail-form { max-width: 680px; }
.umail-status dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; }
.umail-status dt { color: #717a96; }
.umail-status dd { margin: 0; overflow-wrap: anywhere; }
.default-choice { display: flex; gap: 8px; align-items: center; }
</style>
