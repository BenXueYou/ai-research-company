<template>
  <section class="umail-section">
    <div class="page-heading">
      <p class="eyebrow">平台配置 / U-Mail</p>
      <h2>企业隔离资源</h2>
      <p>平台统一采购并承担第一阶段费用；资源隔离实证留待 T32 正式联调。</p>
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
    <el-form class="identity-card umail-form" label-position="top" @submit.prevent="save">
      <el-form-item label="终端企业" for="umail-organization">
        <select
          id="umail-organization"
          v-model="organizationId"
          required
          :disabled="busy"
        >
          <option value="" disabled>请选择企业</option>
          <option v-for="item in organizations" :key="item.organizationId" :value="item.organizationId">
            {{ item.name }} · {{ statusLabel(item.resourceStatus) }}
          </option>
        </select>
      </el-form-item>
      <el-form-item label="U-Mail 隔离资源标识" for="umail-resource-id">
        <el-input
          id="umail-resource-id"
          v-model="resourceId"
          required
          :disabled="busy"
        />
      </el-form-item>
      <el-button class="primary-button" native-type="submit" :disabled="busy">
        {{ busy ? '正在核验并保存…' : '核验资源并保存' }}
      </el-button>
    </el-form>
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

interface OrganizationResource {
  organizationId: string;
  name: string;
  resourceStatus: string | null;
}
const props = defineProps<{
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}>();
const organizations = shallowRef<OrganizationResource[]>([]);
const organizationId = ref('');
const resourceId = ref('');
const requestId = ref(crypto.randomUUID());
const busy = ref(false);
const error = ref('');
const notice = ref('');
function statusLabel(value: string | null) {
  if (value === 'available') return '受控验证可用';
  if (value === 'unavailable') return '受控验证不可用';
  return value ? '尚未真实联调' : '未配置';
}
async function refresh() {
  const result = await props.request('umail/resources') as { organizations: OrganizationResource[] };
  organizations.value = result.organizations;
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await props.request('umail/resources', {
      organizationId: organizationId.value,
      resourceId: resourceId.value,
      requestId: requestId.value
    });
    requestId.value = crypto.randomUUID();
    resourceId.value = '';
    notice.value = '企业 U-Mail 资源已保存；第一阶段费用由平台承担';
    await refresh();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '资源保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try { await refresh(); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '企业资源加载失败'; }
});
</script>

<style scoped>
.umail-section { margin-top: 32px; }
.umail-form { max-width: 680px; }
select { width: 100%; padding: 12px; border: 1px solid #dcdfe6; border-radius: 8px; background: white; }
</style>
