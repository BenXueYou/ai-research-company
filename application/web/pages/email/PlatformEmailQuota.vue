<template>
  <section>
    <h3>企业邮件日额度</h3>
    <p>默认每企业每日 2000 封；按北京时间零点计算。</p>
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="终端企业">
        <el-select v-model="organizationId" placeholder="选择终端企业">
          <el-option v-for="item in organizations" :key="item.organizationId" :label="item.name" :value="item.organizationId" />
        </el-select>
      </el-form-item>
      <el-form-item label="每日封数">
        <el-input v-model="dailyLimit" type="number" min="1" max="1000000" />
      </el-form-item>
      <el-button native-type="submit" :disabled="busy">保存日额度</el-button>
    </el-form>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';

interface Organization { organizationId: string; name: string }
const props = defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
const organizations = ref<Organization[]>([]);
const organizationId = ref('');
const dailyLimit = ref('2000');
const busy = ref(false);
const error = ref('');
const notice = ref('');
async function save() {
  busy.value = true;
  error.value = '';
  try {
    const count = Number(dailyLimit.value);
    if (!Number.isInteger(count) || count < 1 || count > 1000000) throw new Error('日额度须为 1 至 1000000 的整数');
    const selected = organizations.value.find(item => item.organizationId === organizationId.value);
    if (!selected) throw new Error('请选择终端企业');
    await props.request('email-quota/configure', { organizationId: selected.organizationId, dailyLimit: count });
    notice.value = `${selected.name} 的每日额度已设为 ${count} 封`;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void props.request('umail/resources').then(result => {
    organizations.value = (result as { organizations: Organization[] }).organizations;
  }).catch(failure => { error.value = failure instanceof Error ? failure.message : '加载企业失败'; });
});
</script>
