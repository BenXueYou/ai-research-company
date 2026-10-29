<template>
  <section class="identity-layout">
    <div class="intro-panel">
      <p class="eyebrow">安全访问 · 真实身份</p>
      <h1>从可信连接，<br>开启每一次机会。</h1>
      <p>使用平台账号或组织分配的登录邮箱访问工作空间。首次登录，请先设置属于自己的密码。</p>
      <div class="security-note">◇ 账号由授权管理员交付，不开放自助注册。</div>
    </div>
    <el-form
      class="business-form identity-card"
      label-position="top"
      @submit.prevent="emit('submit')"
    >
      <p class="eyebrow">WELCOME BACK</p>
      <h2>登录工作空间</h2>
      <p class="hint">平台使用 super_admin，其他账号使用登录邮箱</p>
      <el-form-item label="登录账号" for="email">
        <el-input
          id="email"
          v-model="email"
          :type="email === 'super_admin' ? 'text' : 'email'"
          autocomplete="username"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-form-item label="密码" for="login-password">
        <el-input
          id="login-password"
          v-model="loginPassword"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
        />
      </el-form-item>
      <p class="hint">忘记密码？请联系授权管理员。临时密码有效期为72小时。</p>
      <div class="form-actions login-actions">
        <el-button
          type="primary" native-type="submit"
          :disabled="busy"
        >{{ busy ? '正在登录…' : '登录' }}</el-button>
      </div>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

defineProps<{ busy: boolean }>();
const emit = defineEmits<{ submit: [] }>();
const email = defineModel<string>('email', { required: true });
const loginPassword = defineModel<string>('loginPassword', { required: true });
</script>
