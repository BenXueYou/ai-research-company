<script setup lang="ts">
import { ref } from 'vue';
import type { Walkthrough } from '../walkthroughs';

defineProps<{ walkthrough: Walkthrough }>();
const preview = ref<HTMLDialogElement>();
</script>

<template>
  <div class="help-walkthrough">
    <figure class="help-figure">
      <button
        type="button"
        class="help-screenshot"
        :aria-label="`放大查看：${walkthrough.caption}`"
        @click="preview?.showModal()"
      >
        <img :src="walkthrough.image" :alt="walkthrough.caption" loading="lazy">
        <span class="help-zoom">点击放大查看</span>
      </button>
      <figcaption>{{ walkthrough.caption }}<span> · 示例数据</span></figcaption>
    </figure>
    <ol class="help-steps">
      <li v-for="step in walkthrough.steps" :key="step">{{ step }}</li>
    </ol>
    <dialog ref="preview" class="help-preview" :aria-label="walkthrough.caption">
      <div class="help-preview-heading">
        <strong>{{ walkthrough.caption }}</strong>
        <button type="button" autofocus @click="preview?.close()">关闭截图</button>
      </div>
      <img :src="walkthrough.image" :alt="walkthrough.caption" loading="lazy">
      <p>示例数据；具体状态与可用操作以当前页面为准。可按 Esc 关闭。</p>
    </dialog>
  </div>
</template>

<style scoped>
.help-walkthrough { width: 100%; min-width: 0; }
.help-figure { margin: 0 0 20px; }
.help-screenshot { position: relative; display: block; width: 100%; padding: 0; overflow: hidden; border: 1px solid var(--console-line); border-radius: 6px; background: #f5f7fb; cursor: zoom-in; }
.help-screenshot img { display: block; width: 100%; height: auto; }
.help-zoom { position: absolute; right: 10px; bottom: 10px; padding: 5px 10px; border-radius: 4px; color: #fff; background: #263a58; font-size: 12px; }
figcaption { margin-top: 8px; color: #4f5d73; font-size: 12px; line-height: 1.6; }
figcaption span { color: #66748a; }
.help-steps { display: grid; gap: 10px; margin: 0 0 20px; padding-left: 24px; color: #4f5d73; font-size: 14px; line-height: 1.8; }
.help-steps li { padding-left: 4px; }
.help-steps li::marker { color: var(--console-brand-deep); font-weight: 600; }
.help-preview { box-sizing: border-box; width: min(1320px, calc(100vw - 32px)); max-height: 90dvh; padding: 20px; border: 1px solid var(--console-line); border-radius: 10px; color: var(--console-text); background: var(--console-surface); }
.help-preview::backdrop { background: rgb(15 23 42 / 65%); }
.help-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.help-preview-heading button { flex-shrink: 0; padding: 8px 12px; border: 1px solid var(--console-line); border-radius: 4px; color: var(--console-brand-deep); background: var(--console-surface); cursor: pointer; }
.help-preview img { display: block; width: 100%; height: auto; }
.help-preview p { margin: 12px 0 0; color: #4f5d73; font-size: 13px; line-height: 1.6; }
button:focus-visible { outline: 3px solid var(--el-color-primary-light-5); outline-offset: 3px; }
@media (max-width: 479px) {
  .help-preview { padding: 12px; }
  .help-preview-heading { font-size: 14px; }
  .help-zoom { right: 6px; bottom: 6px; padding: 3px 6px; }
}
</style>
