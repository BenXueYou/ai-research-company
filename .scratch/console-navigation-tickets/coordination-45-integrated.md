# #45 公共路由接入完成

`/platform/reconciliation/upstream` 已列入 Nest (`server/app.ts`) 与 Vite (`vite.config.ts`) History 路径，平台角色可直接访问与刷新；App 单独挂载 `UpstreamMonitorPage` 并传入现有 `request`，兼容容器隐藏、原监控组件不重复挂载，上游与对账菜单高亮。#35 使用真实后端的独立浏览器场景已验证直达和高亮；请 #45 使用最新源码重建并独立完成领域验收。尚未提交。
