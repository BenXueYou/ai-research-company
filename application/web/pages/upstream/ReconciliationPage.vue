<template>
  <section class="reconciliation-page">
    <header class="reconciliation-heading">
      <p class="reconciliation-kicker">平台运营 · 结果确认</p>
      <h1>上游与对账</h1>
      <p>先处理结果待确认查询，再查看共享账号的额度和最近快照。</p>
    </header>
    <div class="reconciliation-primary">
      <DetailReconciliation :request="request" />
    </div>
    <div class="reconciliation-overview">
      <UpstreamMonitor :request="request" />
    </div>
  </section>
</template>

<script setup lang="ts">
import DetailReconciliation from './components/DetailReconciliation.vue';
import UpstreamMonitor from './components/UpstreamMonitor.vue';

defineOptions({ name: 'ReconciliationPage' });
defineProps<{ request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }>();
</script>

<style scoped>
.reconciliation-page {
  --reconciliation-accent: #4356e0;
  --reconciliation-ink: #1c2333;
  --reconciliation-muted: #738095;
  --reconciliation-line: #e3e7f0;
  min-width: 0;
  display: grid;
  max-width: 1160px;
  gap: 22px;
  margin: 0 auto;
  color: var(--reconciliation-ink);
}

.reconciliation-primary,
.reconciliation-overview {
  min-width: 0;
}

.reconciliation-heading {
  padding: 4px 2px 0;
}

.reconciliation-kicker {
  margin: 0 0 9px;
  color: var(--reconciliation-accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
}

.reconciliation-heading h1 {
  margin: 0 0 8px;
  color: var(--reconciliation-ink);
  font-size: 24px;
  line-height: 1.35;
}

.reconciliation-heading > p:last-child {
  margin: 0;
  color: var(--reconciliation-muted);
  font-size: 13px;
}

.reconciliation-primary :deep(.workspace-card),
.reconciliation-overview :deep(.workspace-card) {
  margin: 0;
  border: 1px solid var(--reconciliation-line);
  border-radius: 12px;
  box-shadow: 0 2px 5px #19234605;
}

.reconciliation-primary :deep(.workspace-card) {
  padding: 28px;
}

.reconciliation-primary :deep(h2),
.reconciliation-overview :deep(h2) {
  margin-top: 0;
  color: var(--reconciliation-ink);
}

.reconciliation-primary :deep(.table-scroll) {
  margin-top: 18px;
  border: 1px solid var(--reconciliation-line);
  border-radius: 9px;
}

.reconciliation-primary :deep(table) {
  min-width: 980px;
}

.reconciliation-primary :deep(th) {
  color: #667085;
  background: #f7f8fc;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .2px;
  white-space: nowrap;
}

.reconciliation-primary :deep(td) {
  color: #354052;
  font-size: 12px;
  vertical-align: top;
}

.reconciliation-primary :deep(tbody tr:hover) {
  background: #fafbff;
}

.reconciliation-primary :deep(.el-button--primary),
.reconciliation-primary :deep(button[type='submit']) {
  border-color: var(--reconciliation-accent);
  background: var(--reconciliation-accent);
}

.reconciliation-overview :deep(.workspace-card) {
  padding: 22px 26px;
}

@media (max-width: 760px) {
  .reconciliation-page {
    gap: 18px;
  }

  .reconciliation-heading h1 {
    font-size: 22px;
  }

  .reconciliation-primary :deep(.workspace-card),
  .reconciliation-overview :deep(.workspace-card) {
    padding: 20px 16px;
  }
}
</style>
