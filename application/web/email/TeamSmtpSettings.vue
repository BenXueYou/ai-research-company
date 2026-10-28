<template>
  <section class="smtp-section">
    <div class="page-heading">
      <p class="eyebrow">团队发信 / 国内 SMTP</p>
      <h2>国内邮箱渠道</h2>
      <p>每个企业最多一套。回复由团队在原邮箱查看，系统不自动收信。</p>
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
    <div v-if="channel" class="workspace-card smtp-status">
      <h3>当前团队配置</h3>
      <dl>
        <dt>SMTP 服务</dt><dd>{{ channel.host }}:{{ channel.port }}（{{ securityLabel(channel.security) }}）</dd>
        <dt>发信账号</dt><dd>{{ channel.username }}</dd>
        <dt>回复邮箱</dt><dd data-testid="smtp-reply-to">{{ channel.replyTo }}</dd>
        <dt>默认渠道</dt><dd>{{ channel.defaultChannel ? '是' : '否' }}</dd>
        <dt>验证结果</dt><dd :class="verificationClass(channel.verificationState)">{{ verificationLabel(channel.verificationState) }} · {{ channel.verificationDetail }}</dd>
      </dl>
      <p class="hint">授权凭据已安全保存，不提供回显。真实连接、DNS 与回复实收由正式联调验证。</p>
    </div>
    <el-form
      v-if="canMaintain"
      class="identity-card smtp-form"
      label-position="top"
      @submit.prevent="save"
    >
      <h3>{{ channel ? '更新团队 SMTP 设置' : '配置团队 SMTP 设置' }}</h3>
      <el-form-item label="SMTP 服务地址" for="smtp-host">
        <el-input
          id="smtp-host"
          v-model="host"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="端口" for="smtp-port">
        <el-input
          id="smtp-port"
          v-model="port"
          inputmode="numeric"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="加密方式" for="smtp-security">
        <select
          id="smtp-security"
          v-model="security"
          required
          :disabled="busy"
        >
          <option value="tls">TLS</option>
          <option value="starttls">STARTTLS</option>
        </select>
      </el-form-item>
      <el-form-item label="SMTP 账号" for="smtp-username">
        <el-input
          id="smtp-username"
          v-model="username"
          autocomplete="off"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="授权凭据" for="smtp-credential">
        <el-input
          id="smtp-credential"
          v-model="credential"
          type="password"
          autocomplete="new-password"
          required
          :disabled="busy"
        />
        <p class="hint">更新设置时须重新填写；保存后不再显示。</p>
      </el-form-item>
      <el-form-item label="团队回复邮箱" for="smtp-reply-to">
        <el-input
          id="smtp-reply-to"
          v-model="replyTo"
          type="email"
          autocomplete="off"
          required
          :disabled="busy"
        />
      </el-form-item>
      <label class="default-choice">
        <input v-model="defaultChannel" type="checkbox" :disabled="busy">
        设为团队默认渠道
      </label>
      <el-button class="primary-button" native-type="submit" :disabled="busy">
        {{ busy ? '正在验证并保存…' : '验证设置并保存' }}
      </el-button>
    </el-form>
    <div v-else class="workspace-card read-only-note">
      <p>业务员可查看团队渠道状态，但不能维护设置。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  onMounted,
  ref,
  shallowRef
} from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

interface SmtpChannel {
  id: string;
  host: string;
  port: number;
  security: string;
  username: string;
  replyTo: string;
  verificationState: 'available' | 'unavailable' | 'not_live_verified';
  verificationDetail: string;
  defaultChannel: boolean;
}
const props = defineProps<{
  canMaintain: boolean;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const channel = shallowRef<SmtpChannel | null>(null);
const host = ref('');
const port = ref('465');
const security = ref('tls');
const username = ref('');
const credential = ref('');
const replyTo = ref('');
const defaultChannel = ref(false);
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const error = ref('');
const notice = ref('');
function securityLabel(value: string) {
  return value === 'starttls' ? 'STARTTLS' : 'TLS';
}
function verificationLabel(value: SmtpChannel['verificationState']) {
  if (value === 'available')
    return '受控验证可用';
  if (value === 'unavailable')
    return '受控验证不可用';
  return '尚未真实联调';
}
function verificationClass(value: SmtpChannel['verificationState']) {
  return `verification-${value.replaceAll('_', '-')}`;
}
function applyChannel(value: SmtpChannel | null) {
  channel.value = value;
  if (!value)
    return;
  host.value = value.host;
  port.value = String(value.port);
  security.value = value.security;
  username.value = value.username;
  replyTo.value = value.replyTo;
  defaultChannel.value = value.defaultChannel;
}
async function refresh() {
  try {
    const result = await props.request('sending-channels/smtp') as { channel: SmtpChannel | null };
    applyChannel(result.channel);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '团队渠道状态加载失败';
  }
}
async function save() {
  if (busy.value)
    return;
  error.value = '';
  notice.value = '';
  if (!/^\d+$/u.test(port.value) || !credential.value) {
    error.value = '请填写有效端口和授权凭据';
    return;
  }
  busy.value = true;
  try {
    const result = await props.request('sending-channels/smtp', {
      host: host.value,
      port: port.value,
      security: security.value,
      username: username.value,
      credential: credential.value,
      replyTo: replyTo.value,
      defaultChannel: defaultChannel.value,
      requestId: requestId.value
    }) as { channel: SmtpChannel };
    applyChannel(result.channel);
    credential.value = '';
    requestId.value = crypto.randomUUID();
    notice.value = result.channel.verificationState === 'available'
      ? '团队 SMTP 设置已保存，受控适配器验证可用'
      : '团队 SMTP 设置已保存；请查看当前验证结果';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '保存失败，请使用当前表单重试';
  } finally {
    busy.value = false;
  }
}
onMounted(refresh);
</script>

<style scoped>
.smtp-section { margin-top: 32px; }
.smtp-status,
.read-only-note { margin-bottom: 24px; }
.smtp-form { max-width: 680px; }
.smtp-status dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; }
.smtp-status dt { color: #717a96; }
.smtp-status dd { margin: 0; overflow-wrap: anywhere; }
.default-choice { display: flex; gap: 8px; align-items: center; }
.verification-available { color: #397565; }
.verification-unavailable { color: #a13d49; }
.verification-not-live-verified { color: #8a641d; }
select { width: 100%; padding: 12px; border: 1px solid #dcdfe6; border-radius: 8px; background: white; }
</style>
