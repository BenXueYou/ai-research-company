<script setup lang="ts">
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
    <button
      type="button"
      class="copy-reference"
      :aria-label="`复制编号 ${value}`"
      @click="copy"
    >复制</button>
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

.copy-reference {
  flex: none;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  color: var(--el-color-primary);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.copy-reference:hover {
  background: var(--el-color-primary-light-9);
}

.copy-feedback:empty {
  display: none;
}
</style>
