<script setup lang="ts">
import CoefficientChanges from './CoefficientChanges.vue';
import PricingSettings from './components/PricingSettings.vue';
import { RouterLink } from 'vue-router';

type SettingsRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

defineOptions({ name: 'PlatformSettingsPage' });

defineProps<{ request: SettingsRequest }>();
</script>

<template>
  <div class="platform-settings-page">
    <header class="settings-heading">
      <div>
        <h1>计价与换算系数</h1>
        <p>维护接口单价、最低加价率和换算系数；既有余额及已确认查询按原规则保留。</p>
      </div>
    </header>
    <nav class="settings-navigation" aria-label="平台设置">
      <span aria-current="page">计价配置</span>
      <RouterLink to="/platform/settings/umail">U-Mail 企业资源</RouterLink>
      <RouterLink to="/platform/settings/email-quota">企业邮件日额度</RouterLink>
    </nav>
    <PricingSettings :request="request" />
    <CoefficientChanges :request="request" />
  </div>
</template>

<style scoped>
.platform-settings-page {
  --settings-accent: #4356e0;
  --settings-line: #e6e9f0;
  --settings-muted: #738095;
  width: 100%;
  min-width: 0;
  color: #1c2333;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif;
}
.settings-heading h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.4; letter-spacing: -.4px; }
.settings-heading p { margin: 0; color: var(--settings-muted); font-size: 13px; line-height: 1.8; }
.settings-navigation { display: flex; gap: 26px; margin: 22px 0; border-bottom: 1px solid var(--settings-line); overflow-x: auto; }
.settings-navigation > * { flex: none; padding: 12px 2px; border-bottom: 2px solid transparent; color: var(--settings-muted); font-size: 13px; text-decoration: none; }
.settings-navigation [aria-current] { border-bottom-color: var(--settings-accent); color: var(--settings-accent); font-weight: 600; }
.settings-navigation a:hover { color: var(--settings-accent); }
.settings-navigation a:focus-visible { outline: 2px solid var(--settings-accent); outline-offset: -2px; }
.platform-settings-page :deep(.pricing-settings),
.platform-settings-page :deep(.coefficient-settings) {
  box-sizing: border-box;
  min-width: 0;
  margin: 0 0 22px;
  padding: 24px;
  border: 1px solid var(--settings-line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 5px #19234603;
  overflow-wrap: anywhere;
}
.platform-settings-page :deep(h2) { margin: 0 0 18px; font-size: 16px; font-weight: 650; }
.platform-settings-page :deep(h3) { margin: 24px 0 14px; font-size: 14px; }
.platform-settings-page :deep(p) { font-size: 13px; line-height: 1.8; }
.platform-settings-page :deep(.settings-summary) { margin: 0 0 14px; padding: 12px 16px; border: 1px solid #e2e7fd; border-radius: 8px; color: #5365a2; background: #f3f5ff; font-variant-numeric: tabular-nums; }
.platform-settings-page :deep(.settings-hint) { margin-bottom: 20px; color: var(--settings-muted); }
.platform-settings-page :deep(.el-alert) { margin-bottom: 14px; }
.platform-settings-page :deep(.settings-form) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; margin-top: 20px; }
.platform-settings-page :deep(.el-form-item) { min-width: 0; margin-bottom: 22px; }
.platform-settings-page :deep(.el-form-item__label) { height: auto; margin-bottom: 8px; color: #647087; font-size: 12px; line-height: 1.6; }
.platform-settings-page :deep(.el-input__wrapper) { min-height: 40px; border-radius: 8px; box-shadow: 0 0 0 1px #dfe4ee inset; }
.platform-settings-page :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--settings-accent) inset; }
.platform-settings-page :deep(select),
.platform-settings-page :deep(input[type='datetime-local']) { box-sizing: border-box; width: 100%; min-width: 0; min-height: 42px; padding: 8px 12px; border: 1px solid #dfe4ee; border-radius: 8px; color: #1c2333; background: #fff; font: inherit; font-size: 13px; }
.platform-settings-page :deep(select:focus-visible),
.platform-settings-page :deep(input[type='datetime-local']:focus-visible) { outline: 2px solid #4356e040; outline-offset: 2px; border-color: var(--settings-accent); }
.platform-settings-page :deep(select:disabled),
.platform-settings-page :deep(input[type='datetime-local']:disabled) { color: #a8abb2; background: #f5f7fa; cursor: not-allowed; }
.platform-settings-page :deep(.settings-form > .el-button) { grid-column: 1 / -1; justify-self: start; margin: 0 0 8px; }
.platform-settings-page :deep(.el-button) { min-height: 38px; padding: 9px 16px; border-radius: 8px; font-size: 13px; }
.platform-settings-page :deep(.settings-primary:not(:disabled)) { border-color: var(--settings-accent); color: #fff; background: var(--settings-accent); }
.platform-settings-page :deep(.settings-primary:not(:disabled):hover) { background: #3343c9; }
.platform-settings-page :deep(.settings-table-scroll) { max-width: 100%; margin-bottom: 20px; overflow-x: auto; border: 1px solid var(--settings-line); border-radius: 8px; }
.platform-settings-page :deep(table) { width: 100%; border-collapse: collapse; font-size: 12px; }
.platform-settings-page :deep(th) { color: #738095; background: #f8f9fc; font-weight: 500; white-space: nowrap; }
.platform-settings-page :deep(th),
.platform-settings-page :deep(td) { padding: 13px 16px; border-bottom: 1px solid #edf0f6; text-align: left; vertical-align: top; line-height: 1.7; }
.platform-settings-page :deep(tbody tr:last-child td) { border-bottom: 0; }
.platform-settings-page :deep(.price-version) { display: block; margin-top: 4px; color: #738095; font-size: 11px; overflow-wrap: anywhere; }
.platform-settings-page :deep(.price-path) { font-family: Consolas, monospace; color: #4356e0; }
.platform-settings-page :deep(.coefficient-history) { padding: 18px 20px; margin-bottom: 14px; border: 1px solid var(--settings-line); border-left: 3px solid #c7cff8; border-radius: 8px; background: #fafbff; }
.platform-settings-page :deep(.coefficient-history h3) { margin: 0 0 10px; color: #4356e0; font-size: 18px; font-variant-numeric: tabular-nums; }
.platform-settings-page :deep(.coefficient-history p) { margin: 8px 0 14px; color: #647087; }
@media (max-width: 760px) {
  .settings-heading h1 { font-size: 21px; }
  .settings-navigation { gap: 20px; }
  .platform-settings-page :deep(.pricing-settings),
  .platform-settings-page :deep(.coefficient-settings) { padding: 18px 16px; }
  .platform-settings-page :deep(.settings-form) { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .platform-settings-page :deep(.coefficient-history) { padding: 16px; }
}
</style>
