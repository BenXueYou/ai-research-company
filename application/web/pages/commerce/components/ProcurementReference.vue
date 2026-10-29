<script setup lang="ts">
import { ElButton } from 'element-plus';
import { ref } from 'vue';

const props = defineProps<{ value: string }>();
const feedback = ref('');
async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    feedback.value = '已复制';
  } catch {
    feedback.value = '复制失败，请选中编号手动复制';
  }
}
</script>

<template>
  <div class="reference-value">
    <span>{{ value }}</span>
    <el-button
      native-type="button"
      class="copy-reference"
      :aria-label="`复制编号 ${value}`"
      @click="copy"
    >复制</el-button>
    <span class="copy-feedback" role="status">{{ feedback }}</span>
  </div>
</template>

<style scoped>
.reference-value {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 4px;
  color: var(--console-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.copy-feedback:empty {
  display: none;
}
</style>
