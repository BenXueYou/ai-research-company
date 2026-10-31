<template>
  <section v-if="items.length" aria-label="选择企业档案">
    <el-alert
      type="warning"
      title="名称相同不代表同一家企业，请逐项核对并选择。不同来源的企业暂不能自动识别为同一家。"
      :closable="false"
    />
    <div v-for="item in items" :key="item.sourceRecordId" class="association-row">
      <strong>{{ names[item.sourceRecordId] || '企业' }}</strong>
      <el-select
        v-model="choices[item.sourceRecordId]"
        :disabled="busy || pending"
        :aria-label="`为 ${names[item.sourceRecordId] || '企业'} 选择档案`"
        placeholder="请选择"
        @change="requestIds[item.sourceRecordId] = ''"
      >
        <el-option label="作为另一家入库" value="new" />
        <el-option
          v-for="candidate in item.candidates"
          :key="candidate.profileId"
          :label="`${candidate.name} · ${candidate.countryCode3 || '国家未知'} · ${candidate.profileId}`"
          :value="candidate.profileId"
        />
      </el-select>
      <el-button
        :disabled="busy || pending || !choices[item.sourceRecordId]"
        @click="resolve(item)"
      >确认选择</el-button>
      <el-alert
        v-if="errors[item.sourceRecordId]"
        type="error"
        :title="errors[item.sourceRecordId]"
        :closable="false"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElOption,
  ElSelect
} from 'element-plus';
import type { CompanyRequest } from '../../../api/companyProfiles';
import { resolveProfileImport, type ProfileImportResult } from '../../../api/companyProfileImports';

const props = defineProps<{
  request: CompanyRequest;
  items: ProfileImportResult[];
  names: Record<string, string>;
  busy: boolean;
}>();
const emit = defineEmits<{ resolved: [item: ProfileImportResult]; pending: [value: boolean] }>();
const choices = ref<Record<string, string>>({});
const requestIds = ref<Record<string, string>>({});
const errors = ref<Record<string, string>>({});
const pending = ref(false);
async function resolve(item: ProfileImportResult) {
  if (pending.value || props.busy) return;
  pending.value = true;
  emit('pending', true);
  errors.value[item.sourceRecordId] = '';
  requestIds.value[item.sourceRecordId] ||= crypto.randomUUID();
  try {
    const response = await resolveProfileImport(props.request, requestIds.value[item.sourceRecordId],
      item.sourceKind, item.sourceRecordId, choices.value[item.sourceRecordId]);
    const result = response.items[0];
    if (!result || result.status === 'rejected' || result.status === 'needs_resolution') {
      requestIds.value[item.sourceRecordId] = '';
      errors.value[item.sourceRecordId] = '该来源或档案已不可用，请刷新后重试。';
      return;
    }
    emit('resolved', result);
  } catch (error) {
    errors.value[item.sourceRecordId] = error instanceof Error ? error.message : '保存失败，请重试';
  } finally {
    pending.value = false;
    emit('pending', false);
  }
}
</script>

<style scoped>
.association-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 12px; }
.association-row > strong { overflow-wrap: anywhere; }
</style>
